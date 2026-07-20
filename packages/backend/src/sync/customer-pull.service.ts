import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SitePlatform } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WooCommerceClient } from './woocommerce-client';
import { HttpProxyError } from '../http-proxy/http-proxy.error';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CustomerPullItemError,
  CustomerPullReport,
  WcCustomerRemote,
} from './sync.types';
import { SYNC_QUEUE_NAME, WC_CUSTOMERS_PAGE_SIZE } from './sync.types';
import { recomputeCustomerStats } from './customer-stats.util';

@Injectable()
export class CustomerPullService {
  private readonly logger = new Logger(CustomerPullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly woo: WooCommerceClient,
    @InjectQueue(SYNC_QUEUE_NAME) private readonly syncQueue: Queue,
  ) {}

  async enqueuePull(
    siteId: string,
    user?: AuthenticatedUser,
  ): Promise<{ id: string; status: string; queued: boolean }> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.isActive) {
      throw new BadRequestException('Site is inactive; enable it before pulling.');
    }
    if (site.platform === SitePlatform.NOPCOMMERCE_ASPNET) {
      throw new BadRequestException(
        'Customer pull is currently available only for WooCommerce sites.',
      );
    }

    const job = await this.prisma.syncJob.create({
      data: {
        siteId,
        direction: 'PULL',
        status: 'QUEUED',
        scope: 'CUSTOMER_PULL',
        createdByUserId: user?.id,
      },
    });
    await this.syncQueue.add('pull-customers', { syncJobId: job.id });
    return { id: job.id, status: job.status, queued: true };
  }

  async runPull(syncJobId: string): Promise<CustomerPullReport> {
    const claimed = await this.prisma.syncJob.updateMany({
      where: { id: syncJobId, status: 'QUEUED' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
    if (claimed.count === 0) {
      const fresh = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });
      if (!fresh) throw new NotFoundException('Sync job not found');
      throw new BadRequestException(`Sync job is in ${fresh.status} state; cannot run.`);
    }

    const job = await this.prisma.syncJob.findUnique({
      where: { id: syncJobId },
      include: { site: { select: { networkRoute: true, lastCustomerPullAt: true } } },
    });
    if (!job) throw new NotFoundException('Sync job not found');

    const siteId = job.siteId;
    const routeUsed = job.site?.networkRoute ?? 'DIRECT';
    const cursor = job.site?.lastCustomerPullAt ?? null;
    const startedAt = new Date();

    let pulled = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: CustomerPullItemError[] = [];
    let newestModified: Date | null = null;

    try {
      let page = 1;
      const maxPages = 1_000;
      while (page <= maxPages) {
        const customers = await this.woo.listCustomers(siteId, {
          modifiedAfter: cursor ?? undefined,
          page,
          perPage: WC_CUSTOMERS_PAGE_SIZE,
        });
        if (customers.length === 0) break;

        for (const remote of customers) {
          try {
            const res = await this.upsertCustomer(siteId, remote);
            pulled += 1;
            if (res.created) created += 1;
            else updated += 1;
            const mod = parseWcDate(remote.date_modified);
            if (mod && (!newestModified || mod > newestModified)) newestModified = mod;
          } catch (err) {
            failed += 1;
            const code =
              err instanceof HttpProxyError ? err.code : ((err as any)?.code ?? 'UNKNOWN');
            errors.push({
              remoteCustomerId: remote.id,
              message: (err as Error).message ?? 'Unknown error',
              code,
              statusCode: (err as any)?.statusCode,
            });
            this.logger.warn(
              `Customer pull failed for #${remote.id} on site ${siteId}: ${(err as Error).message}`,
            );
          }
        }

        if (customers.length < WC_CUSTOMERS_PAGE_SIZE) break;
        page += 1;
      }

      await recomputeCustomerStats(this.prisma, siteId);
    } catch (fatal) {
      this.logger.error(
        `Fatal error in customer pull job ${syncJobId}: ${(fatal as Error).message}`,
      );
      await this.markFailed(syncJobId, pulled, failed, errors, startedAt, routeUsed, newestModified, fatal as Error);
      throw fatal;
    }

    const finishedAt = new Date();
    const report: CustomerPullReport = {
      pulled,
      created,
      updated,
      failed,
      errors,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      routeUsed,
      newestDateModified: newestModified ? newestModified.toISOString() : null,
    };
    await this.finalize(syncJobId, report, finishedAt, newestModified);
    return report;
  }

  private async upsertCustomer(
    siteId: string,
    remote: WcCustomerRemote,
  ): Promise<{ created: boolean }> {
    const billing = remote.billing;
    const email = remote.email?.trim() || billing?.email?.trim() || null;
    const name =
      [remote.first_name, remote.last_name].filter(Boolean).join(' ').trim() ||
      [billing?.first_name, billing?.last_name].filter(Boolean).join(' ').trim() ||
      email ||
      'Unknown customer';
    const phone = billing?.phone ?? null;

    const existing = await this.prisma.customer.findUnique({
      where: { siteId_remoteCustomerId: { siteId, remoteCustomerId: remote.id } },
      select: { id: true },
    });

    const data = { name, email, phone };

    if (existing) {
      await this.prisma.customer.update({ where: { id: existing.id }, data });
      return { created: false };
    }

    await this.prisma.customer.create({
      data: {
        siteId,
        remoteCustomerId: remote.id,
        ...data,
      },
    });
    return { created: true };
  }

  private async finalize(
    syncJobId: string,
    report: CustomerPullReport,
    finishedAt: Date,
    newestModified: Date | null,
  ): Promise<void> {
    const status = report.failed === 0 ? 'success' : report.pulled === 0 ? 'failed' : 'partial';
    const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });

    await this.prisma
      .$transaction([
        this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: 'COMPLETED',
            totalItems: report.pulled + report.failed,
            pushedCount: report.pulled,
            failedCount: report.failed,
            report: report as unknown as Prisma.InputJsonValue,
            errors: report.errors as unknown as Prisma.InputJsonValue,
            finishedAt,
          },
        }),
        this.prisma.syncLog.create({
          data: {
            siteId: job?.siteId ?? '',
            syncType: 'customer_pull',
            status,
            details: { syncJobId, ...report } as unknown as Prisma.InputJsonValue,
          },
        }),
        ...(newestModified
          ? [
              this.prisma.siteConfig.update({
                where: { id: job?.siteId ?? '' },
                data: { lastCustomerPullAt: newestModified },
              }),
            ]
          : []),
      ])
      .catch(async (err) => {
        this.logger.warn(`Finalize transaction failed: ${(err as Error).message}`);
        await this.prisma.syncJob
          .update({
            where: { id: syncJobId },
            data: {
              status: 'COMPLETED',
              totalItems: report.pulled + report.failed,
              pushedCount: report.pulled,
              failedCount: report.failed,
              report: report as unknown as Prisma.InputJsonValue,
              finishedAt,
            },
          })
          .catch(() => undefined);
      });
  }

  private async markFailed(
    syncJobId: string,
    pulled: number,
    failed: number,
    errors: CustomerPullItemError[],
    startedAt: Date,
    routeUsed: string,
    newestModified: Date | null,
    cause: Error,
  ): Promise<void> {
    const report: CustomerPullReport = {
      pulled,
      created: 0,
      updated: 0,
      failed,
      errors,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      routeUsed,
      newestDateModified: newestModified ? newestModified.toISOString() : null,
    };
    try {
      const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });
      await this.prisma.$transaction([
        this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: 'FAILED',
            pushedCount: pulled,
            failedCount: failed,
            report: report as unknown as Prisma.InputJsonValue,
            errors: report.errors as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        }),
        this.prisma.syncLog.create({
          data: {
            siteId: job?.siteId ?? '',
            syncType: 'customer_pull',
            status: 'failed',
            details: {
              syncJobId,
              fatal: cause.message,
              ...report,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to mark customer pull job ${syncJobId} FAILED: ${(err as Error).message}. Original: ${cause.message}`,
      );
    }
  }
}

function parseWcDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
