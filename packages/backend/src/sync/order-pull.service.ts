import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WooCommerceClient } from './woocommerce-client';
import { HttpProxyError } from '../http-proxy/http-proxy.error';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  OrderPullItemError,
  OrderPullReport,
  WcOrderItemRemote,
  WcOrderRemote,
} from './sync.types';
import { SYNC_QUEUE_NAME, WC_ORDERS_PAGE_SIZE } from './sync.types';

/**
 * Phase 4: pulls WooCommerce orders from a site into the hub's `Order` /
 * `OrderItem` / `Customer` tables.
 *
 * Idempotency contract:
 *   - Orders are upserted by the `@@unique([siteId, remoteOrderId])` key, so
 *     re-running a pull never duplicates an order. A pull updates existing
 *     orders in place (status/total/line items can change on the store side).
 *   - Customers are upserted by `(siteId, remoteCustomerId)` when WC provides a
 *     non-zero `customer_id`; otherwise we fall back to matching by email
 *     within the same site, and finally leave the order unlinked.
 *   - `OrderItem` rows are replaced on each upsert (delete-then-recreate for
 *     that orderId) so line-item edits on the store are reflected exactly.
 *   - Line items are linked to the hub `Product` by matching the WC line `sku`
 *     against `Product.skuMaster`. Unmatched items keep `productId = null` but
 *     still store `siteSku` + `lineName` for reporting.
 *
 * Incremental cursor:
 *   - `SiteConfig.lastOrderPullAt` stores the most recent WC `date_modified`
 *     seen. The next pull passes it as `modified_after`, so only orders that
 *     changed since the last successful pull are fetched. The first pull
 *     (null cursor) fetches everything.
 *   - WC orders are requested `orderby=date_modified&order=asc`, so the cursor
 *     advances monotonically and we never skip an order modified mid-pull.
 *
 * Resilience mirrors SyncService.runPush: atomic QUEUED→PROCESSING claim,
 * per-order try/catch, a fatal try/catch that marks the job FAILED, and a
 * finalize transaction that writes SyncJob + SyncLog + lastOrderPullAt.
 */
@Injectable()
export class OrderPullService {
  private readonly logger = new Logger(OrderPullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly woo: WooCommerceClient,
    @InjectQueue(SYNC_QUEUE_NAME) private readonly syncQueue: Queue,
  ) {}

  // ─── Enqueue ──────────────────────────────────────────────────────────────

  async enqueuePull(
    siteId: string,
    user?: AuthenticatedUser,
  ): Promise<{ id: string; status: string; queued: boolean }> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.isActive) throw new BadRequestException('Site is inactive; enable it before pulling.');

    const job = await this.prisma.syncJob.create({
      data: {
        siteId,
        direction: 'PULL',
        status: 'QUEUED',
        scope: 'ORDER_PULL',
        createdByUserId: user?.id,
      },
    });
    await this.syncQueue.add('pull', { syncJobId: job.id });
    return { id: job.id, status: job.status, queued: true };
  }

  // ─── Run pull (called by the BullMQ processor) ─────────────────────────────

  async runPull(syncJobId: string): Promise<OrderPullReport> {
    // Atomic claim: only one worker can transition QUEUED → PROCESSING.
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
      include: { site: { select: { networkRoute: true, lastOrderPullAt: true } } },
    });
    if (!job) throw new NotFoundException('Sync job not found');

    const siteId = job.siteId;
    const routeUsed = job.site?.networkRoute ?? 'DIRECT';
    const cursor = job.site?.lastOrderPullAt ?? null;
    const startedAt = new Date();

    let pulled = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: OrderPullItemError[] = [];
    let newestModified: Date | null = null;

    try {
      // Paginate WC orders modified after the cursor, ascending by date_modified.
      let page = 1;
      // Guard against unbounded pagination (e.g. a misbehaving endpoint).
      const maxPages = 1_000;
      while (page <= maxPages) {
        const orders = await this.woo.listOrders(siteId, {
          modifiedAfter: cursor ?? undefined,
          page,
          perPage: WC_ORDERS_PAGE_SIZE,
        });
        if (orders.length === 0) break;

        for (const remote of orders) {
          try {
            const res = await this.upsertOrder(siteId, remote);
            pulled += 1;
            if (res.created) created += 1;
            else updated += 1;
            const mod = parseWcDate(remote.date_modified);
            if (mod && (!newestModified || mod > newestModified)) newestModified = mod;
          } catch (err) {
            failed += 1;
            const code = err instanceof HttpProxyError ? err.code : (err as any)?.code ?? 'UNKNOWN';
            errors.push({
              remoteOrderId: remote.id,
              orderNumber: remote.number ?? String(remote.id),
              message: (err as Error).message ?? 'Unknown error',
              code,
              statusCode: (err as any)?.statusCode,
            });
            this.logger.warn(
              `Pull failed for order #${remote.number ?? remote.id} on site ${siteId}: ${(err as Error).message}`,
            );
          }
        }

        // Last page reached when fewer than a full page is returned.
        if (orders.length < WC_ORDERS_PAGE_SIZE) break;
        page += 1;
      }
    } catch (fatal) {
      this.logger.error(`Fatal error in order pull job ${syncJobId}: ${(fatal as Error).message}`);
      await this.markFailed(syncJobId, pulled, failed, errors, startedAt, routeUsed, newestModified, fatal as Error);
      throw fatal;
    }

    const finishedAt = new Date();
    const report: OrderPullReport = {
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

  // ─── Upsert one order (transactional) ──────────────────────────────────────

  /**
   * Upserts an order by `(siteId, remoteOrderId)`. Replaces line items and
   * re-links the customer. Returns `{ created }` so the caller can tally.
   */
  private async upsertOrder(
    siteId: string,
    remote: WcOrderRemote,
  ): Promise<{ created: boolean }> {
    const existing = await this.prisma.order.findUnique({
      where: { siteId_remoteOrderId: { siteId, remoteOrderId: remote.id } },
      select: { id: true },
    });

    const customerId = await this.resolveCustomer(siteId, remote);
    const dateCreated = parseWcDate(remote.date_created);
    const dateModified = parseWcDate(remote.date_modified);
    const billing = remote.billing;
    const billingName = billing
      ? [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || null
      : null;

    const baseData = {
      orderNumber: remote.number ?? String(remote.id),
      status: remote.status ?? 'pending',
      totalAmount: new Prisma.Decimal(remote.total ?? '0'),
      remoteOrderId: remote.id,
      dateCreated,
      dateModified,
      currency: remote.currency ?? null,
      paymentMethod: remote.payment_method ?? null,
      discountTotal: new Prisma.Decimal(remote.discount_total ?? '0'),
      shippingTotal: new Prisma.Decimal(remote.total_shipping ?? '0'),
      billingName,
      billingEmail: billing?.email ?? null,
      billingPhone: billing?.phone ?? null,
    };

    if (existing) {
      // Replace line items: delete then recreate so edits propagate cleanly.
      await this.prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
        await tx.order.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
          },
        });
        await this.createLineItems(tx, existing.id, siteId, remote.line_items ?? []);
      });
      return { created: false };
    }

    // Create path: insert order + items together.
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          ...baseData,
          site: { connect: { id: siteId } },
          ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
        },
      });
      await this.createLineItems(tx, o.id, siteId, remote.line_items ?? []);
    });
    return { created: true };
  }

  // ─── Customer upsert ──────────────────────────────────────────────────────

  private async resolveCustomer(siteId: string, remote: WcOrderRemote): Promise<string | null> {
    const remoteCustomerId = remote.customer_id ?? 0;
    const billing = remote.billing;
    const email = billing?.email?.trim() || null;
    const name = billing
      ? [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || null
      : null;

    // 1. Match by (siteId, remoteCustomerId) when WC provides one.
    if (remoteCustomerId > 0) {
      const existing = await this.prisma.customer.findUnique({
        where: { siteId_remoteCustomerId: { siteId, remoteCustomerId } },
        select: { id: true },
      });
      if (existing) {
        // Refresh contact details if the order carries newer info.
        if (email || name || billing?.phone) {
          await this.prisma.customer.update({ where: { id: existing.id }, data: {
            email: email ?? undefined,
            name: name ?? undefined,
            phone: billing?.phone ?? undefined,
          } }).catch(() => undefined);
        }
        return existing.id;
      }
    }

    // 2. Fallback: match by email within the same site (guest checkout).
    if (email) {
      const byEmail = await this.prisma.customer.findFirst({
        where: { siteId, email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (byEmail) {
        if (remoteCustomerId > 0) {
          await this.prisma.customer.update({ where: { id: byEmail.id }, data: {
            remoteCustomerId,
          } }).catch(() => undefined);
        }
        return byEmail.id;
      }
    }

    // 3. Create a new customer record (only if we have anything to identify it).
    if (!name && !email && !billing?.phone && remoteCustomerId <= 0) return null;
    try {
      const created = await this.prisma.customer.create({
        data: {
          siteId,
          remoteCustomerId: remoteCustomerId > 0 ? remoteCustomerId : null,
          name: name ?? 'Unknown customer',
          email,
          phone: billing?.phone ?? null,
        },
      });
      return created.id;
    } catch (err) {
      // Race on the unique (siteId, remoteCustomerId) — re-read.
      if (remoteCustomerId > 0) {
        const again = await this.prisma.customer.findUnique({
          where: { siteId_remoteCustomerId: { siteId, remoteCustomerId } },
          select: { id: true },
        });
        if (again) return again.id;
      }
      this.logger.warn(`Could not upsert customer for site ${siteId}: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Line items ───────────────────────────────────────────────────────────

  private async createLineItems(
    tx: Prisma.TransactionClient,
    orderId: string,
    _siteId: string,
    items: WcOrderItemRemote[],
  ): Promise<void> {
    if (items.length === 0) return;
    // Resolve all SKUs in one pass to link line items to hub products.
    const skus = items.map((i) => i.sku).filter((s): s is string => !!s && s.length > 0);
    const productBySku = new Map<string, string>();
    if (skus.length > 0) {
      const products = await tx.product.findMany({
        where: { skuMaster: { in: skus } },
        select: { id: true, skuMaster: true },
      });
      for (const p of products) productBySku.set(p.skuMaster, p.id);
    }

    for (const item of items) {
      const productId = item.sku ? (productBySku.get(item.sku) ?? null) : null;
      await tx.orderItem.create({
        data: {
          orderId,
          productId,
          quantity: item.quantity ?? 1,
          unitPrice: new Prisma.Decimal(item.price ?? item.total ?? '0'),
          remoteLineId: String(item.id),
          siteSku: item.sku ?? null,
          lineName: item.name ?? null,
        },
      });
    }
  }

  // ─── Finalize ──────────────────────────────────────────────────────────────

  private async finalize(
    syncJobId: string,
    report: OrderPullReport,
    finishedAt: Date,
    newestModified: Date | null,
  ): Promise<void> {
    const status = report.failed === 0 ? 'success' : report.pulled === 0 ? 'failed' : 'partial';
    const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });

    await this.prisma.$transaction([
      this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'COMPLETED',
          totalItems: report.pulled + report.failed,
          pushedCount: report.pulled, // reuse pushedCount as "pulled" for PULL jobs
          failedCount: report.failed,
          report: report as unknown as Prisma.InputJsonValue,
          errors: report.errors as unknown as Prisma.InputJsonValue,
          finishedAt,
        },
      }),
      this.prisma.syncLog.create({
        data: {
          siteId: job?.siteId ?? '',
          syncType: 'order_pull',
          status,
          details: { syncJobId, ...report } as unknown as Prisma.InputJsonValue,
        },
      }),
      // Advance the incremental cursor only when we observed a newer modified date.
      ...(newestModified
        ? [this.prisma.siteConfig.update({
            where: { id: job?.siteId ?? '' },
            data: { lastOrderPullAt: newestModified },
          })]
        : []),
    ]).catch(async (err) => {
      this.logger.warn(`Finalize transaction failed: ${(err as Error).message}`);
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'COMPLETED',
          totalItems: report.pulled + report.failed,
          pushedCount: report.pulled,
          failedCount: report.failed,
          report: report as unknown as Prisma.InputJsonValue,
          finishedAt,
        },
      }).catch(() => undefined);
    });
  }

  private async markFailed(
    syncJobId: string,
    pulled: number,
    failed: number,
    errors: OrderPullItemError[],
    startedAt: Date,
    routeUsed: string,
    newestModified: Date | null,
    cause: Error,
  ): Promise<void> {
    const report: OrderPullReport = {
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
            syncType: 'order_pull',
            status: 'failed',
            details: { syncJobId, fatal: cause.message, ...report } as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to mark order pull job ${syncJobId} FAILED: ${(err as Error).message}. Original: ${cause.message}`,
      );
    }
  }
}

/** Parse a WC ISO-8601 date string ("2026-07-05T10:30:00") into a Date. */
function parseWcDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
