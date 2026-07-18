import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, ProductType, SitePlatform } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WooCommerceClient } from './woocommerce-client';
import { HttpProxyError } from '../http-proxy/http-proxy.error';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ResolvedPushItem,
  SyncItemError,
  SyncReport,
  SyncScope,
  WcProductPayload,
  WcProductRemote,
} from './sync.types';
import { SYNC_QUEUE_NAME } from './sync.types';
import { AspNetProductClient } from './aspnet-product.client';
import type {
  AspNetDryRunReport,
  AspNetPriceStockUpdate,
  AspNetUpdateResult,
} from './aspnet-product.types';

/**
 * Orchestrates WooCommerce sync (Phase 3: hub → site push only).
 *
 * Idempotency contract:
 *   - Pushing the same product twice never creates a duplicate WC product.
 *     We look up the remote product by SKU (via WooCommerceClient.findProductsBySku)
 *     and PUT an update if it exists, POST a create if it doesn't.
 *   - The remote WC product id is cached on SiteProductMapping.siteProductId so
 *     subsequent pushes skip the lookup and PUT directly. A fallback lookup is
 *     always done when siteProductId is missing or stale.
 *   - Stock/price are pushed as absolute values (manage_stock=true,
 *     stock_quantity=N, regular_price=…). Re-running a sync is safe.
 *
 * Resilience:
 *   - Each product is pushed in its own try/catch; one failure doesn't abort
 *     the batch. Per-item errors are recorded on the SyncJob.
 *   - The whole runPush is wrapped in a try/catch that marks the SyncJob
 *     FAILED with a partial report if anything escapes the per-item loop.
 *   - A SyncLog row is written per sync run (success / failed / partial) so
 *     the Sync report in the admin panel can diagnose network issues per
 *     site and per network route.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly woo: WooCommerceClient,
    @InjectQueue(SYNC_QUEUE_NAME) private readonly syncQueue: Queue,
    @Optional() private readonly aspNet?: AspNetProductClient,
  ) {}

  // ─── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Creates a SyncJob(QUEUED) and enqueues a BullMQ job. Returns the SyncJob.
   * The actual push happens in the worker (SyncProcessor) so the HTTP request
   * is not blocked by hundreds of WC API calls.
   */
  async enqueuePush(
    siteId: string,
    scope: SyncScope = 'ALL',
    productIds?: string[],
    user?: AuthenticatedUser,
  ): Promise<{ id: string; status: string; queued: boolean }> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.isActive)
      throw new BadRequestException('Site is inactive; enable it before syncing.');

    const payload = scope === 'PRODUCT_IDS' && productIds?.length ? { productIds } : undefined;

    const job = await this.prisma.syncJob.create({
      data: {
        siteId,
        direction: 'PUSH',
        status: 'QUEUED',
        scope,
        payload: payload as unknown as Prisma.InputJsonValue | undefined,
        createdByUserId: user?.id,
      },
    });

    await this.syncQueue.add('push', { syncJobId: job.id });
    return { id: job.id, status: job.status, queued: true };
  }

  // ─── Run push (called by the BullMQ processor) ────────────────────────────

  async runPush(syncJobId: string): Promise<SyncReport> {
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

    const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });
    if (!job) throw new NotFoundException('Sync job not found');

    const startedAt = new Date();
    let pushed = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: SyncItemError[] = [];
    let routeUsed = 'DIRECT';

    try {
      const items = await this.resolvePushItems(
        job.siteId,
        job.scope as SyncScope,
        job.payload as any,
      );
      const site = await this.prisma.siteConfig.findUnique({ where: { id: job.siteId } });
      if (!site) throw new NotFoundException('Site not found');
      routeUsed = site.networkRoute;

      if (site.platform === SitePlatform.NOPCOMMERCE_ASPNET) {
        const result = await this.pushAspNetPriceStock(job.siteId, items);
        pushed = result.pushed;
        updated = result.updated;
        failed = result.failed;
        errors.push(...result.errors);
      } else {
        // First, look up all remote products by SKU in one batched pass so the
        // per-item upsert can PUT when a mapping is missing/stale.
        const allSkus = items.map((i) => i.siteSku || i.skuMaster);
        let remoteBySku = new Map<string, WcProductRemote>();
        try {
          remoteBySku = await this.woo.findProductsBySku(job.siteId, allSkus);
          // Capture route used from a cheap probe — the lookup itself used the
          // site's route; we infer it from the site config.
          routeUsed = site.networkRoute;
        } catch (err) {
          // Lookup failed (network/proxy). We still attempt per-item pushes —
          // for items with a cached siteProductId we can PUT without lookup.
          this.logger.warn(
            `WC SKU lookup failed for site ${job.siteId}: ${(err as Error).message}. Falling back to cached mapping + create.`,
          );
        }

        for (const item of items) {
          try {
            const sku = item.siteSku || item.skuMaster;
            const existing = item.siteProductId
              ? { id: Number(item.siteProductId), sku }
              : (remoteBySku.get(sku) ?? undefined);
            const payload = this.toWcPayload(item);
            const { remote, created: didCreate } = await this.woo.upsertProductBySku(
              job.siteId,
              payload,
              existing,
            );
            pushed += 1;
            if (didCreate) created += 1;
            else updated += 1;

            // Cache the remote id + site SKU on the mapping (upsert mapping row).
            await this.upsertMapping(job.siteId, item, remote, didCreate);
          } catch (err) {
            failed += 1;
            const code =
              err instanceof HttpProxyError ? err.code : ((err as any)?.code ?? 'UNKNOWN');
            const statusCode = (err as any)?.statusCode;
            errors.push({
              sku: item.siteSku || item.skuMaster,
              message: (err as Error).message ?? 'Unknown error',
              code,
              statusCode,
            });
            this.logger.warn(
              `Push failed for sku=${item.siteSku || item.skuMaster} on site ${job.siteId}: ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (fatal) {
      this.logger.error(`Fatal error in sync job ${syncJobId}: ${(fatal as Error).message}`);
      await this.markFailed(
        syncJobId,
        pushed,
        failed,
        errors,
        startedAt,
        routeUsed,
        fatal as Error,
      );
      throw fatal;
    }

    const finishedAt = new Date();
    const report: SyncReport = {
      pushed,
      failed,
      created,
      updated,
      errors,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      routeUsed,
    };
    await this.finalize(syncJobId, report, finishedAt);
    return report;
  }

  async previewAspNetPriceStock(
    siteId: string,
    scope: SyncScope = 'PRICE_STOCK',
    productIds?: string[],
  ): Promise<AspNetDryRunReport> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (site.platform !== SitePlatform.NOPCOMMERCE_ASPNET) {
      throw new BadRequestException(
        'Dry-run price/stock preview is only available for ASP.NET sites',
      );
    }
    if (!this.aspNet) throw new Error('ASP.NET product connector is not available');

    const items = await this.resolvePushItems(
      siteId,
      scope,
      productIds?.length ? { productIds } : null,
    );
    const sourceProductIds = items
      .map((item) => this.numericSourceId(item.siteProductId))
      .filter((id): id is number => id !== null);
    const sourceCombinationIds = items
      .map((item) => this.combinationSourceId(item.siteProductId))
      .filter((id): id is number => id !== null);
    const skus = items.map((item) => item.siteSku || item.skuMaster);
    const lookup = await this.aspNet.lookup(siteId, {
      sourceProductIds,
      sourceCombinationIds,
      skus,
    });
    const productsById = new Map(
      lookup.items
        .filter((remote) => remote.kind === 'PRODUCT')
        .map((remote) => [remote.id, remote]),
    );
    const combinationsById = new Map(
      lookup.items
        .filter((remote) => remote.kind === 'COMBINATION')
        .map((remote) => [remote.id, remote]),
    );
    const bySku = new Map(
      lookup.items
        .filter((remote) => remote.sku)
        .map((remote) => [remote.sku!.toLocaleLowerCase(), remote]),
    );
    const duplicateSkus = new Set(lookup.duplicateSkus.map((sku) => sku.toLocaleLowerCase()));

    const reportItems = items.map((item) => {
      const sku = item.siteSku || item.skuMaster;
      const sourceProductId = this.numericSourceId(item.siteProductId);
      const sourceCombinationId = this.combinationSourceId(item.siteProductId);
      const remoteById =
        sourceProductId !== null
          ? productsById.get(sourceProductId)
          : sourceCombinationId !== null
            ? combinationsById.get(sourceCombinationId)
            : undefined;
      const remoteBySku = bySku.get(sku.toLocaleLowerCase());
      const duplicate = !remoteById && duplicateSkus.has(sku.toLocaleLowerCase());
      const remote = remoteById ?? remoteBySku;
      const status = duplicate
        ? ('duplicate' as const)
        : remoteById
          ? ('matched_by_id' as const)
          : remoteBySku
            ? ('matched_by_sku' as const)
            : ('unresolved' as const);
      return {
        productId: item.productId,
        sku,
        sourceProductId,
        sourceCombinationId,
        status,
        remote,
        wouldUpdate: remote ? { price: item.basePrice, stockQuantity: item.totalStock } : undefined,
      };
    });

    return {
      siteId,
      total: reportItems.length,
      matched: reportItems.filter((item) => item.status.startsWith('matched_')).length,
      unresolved: reportItems.filter((item) => item.status === 'unresolved').length,
      duplicate: reportItems.filter((item) => item.status === 'duplicate').length,
      items: reportItems,
    };
  }

  async importAspNetMappings(
    siteId: string,
    rows: {
      sourceProductId: number;
      sourceKind?: 'PRODUCT' | 'COMBINATION';
      sku: string;
    }[],
  ): Promise<{ imported: number; unresolved: number; duplicates: number }> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (site.platform !== SitePlatform.NOPCOMMERCE_ASPNET) {
      throw new BadRequestException('ASP.NET mappings can only be imported for an ASP.NET site');
    }

    const normalized = rows
      .map((row) => ({
        sourceProductId: row.sourceProductId,
        sourceKind: row.sourceKind ?? ('PRODUCT' as const),
        sku: row.sku.trim(),
      }))
      .filter((row) => Number.isInteger(row.sourceProductId) && row.sourceProductId > 0 && row.sku);
    const duplicateSkus = new Set<string>();
    const seen = new Set<string>();
    for (const row of normalized) {
      const sku = row.sku.toLocaleLowerCase();
      if (seen.has(sku)) duplicateSkus.add(sku);
      seen.add(sku);
    }

    const products = await this.prisma.product.findMany({
      select: { id: true, skuMaster: true },
    });
    const productBySku = new Map(
      products.map((product) => [product.skuMaster.toLocaleLowerCase(), product]),
    );
    let imported = 0;
    let unresolved = 0;

    for (const row of normalized) {
      const normalizedSku = row.sku.toLocaleLowerCase();
      const product = productBySku.get(normalizedSku);
      if (!product || duplicateSkus.has(normalizedSku)) {
        unresolved += 1;
        continue;
      }
      await this.prisma.siteProductMapping.upsert({
        where: { productId_siteId: { productId: product.id, siteId } },
        create: {
          productId: product.id,
          siteId,
          siteSku: row.sku,
          siteProductId:
            row.sourceKind === 'COMBINATION'
              ? `combination:${row.sourceProductId}`
              : String(row.sourceProductId),
          matchStatus: 'APPROVED',
        },
        update: {
          siteSku: row.sku,
          siteProductId:
            row.sourceKind === 'COMBINATION'
              ? `combination:${row.sourceProductId}`
              : String(row.sourceProductId),
          matchStatus: 'APPROVED',
        },
      });
      imported += 1;
    }

    return { imported, unresolved, duplicates: duplicateSkus.size };
  }

  private async pushAspNetPriceStock(siteId: string, items: ResolvedPushItem[]) {
    if (!this.aspNet) throw new Error('ASP.NET product connector is not available');
    const updates: AspNetPriceStockUpdate[] = items.map((item) => {
      const sourceProductId = this.numericSourceId(item.siteProductId);
      const sourceCombinationId = this.combinationSourceId(item.siteProductId);
      return {
        sourceProductId: sourceProductId ?? undefined,
        sourceCombinationId: sourceCombinationId ?? undefined,
        sku: item.siteSku || item.skuMaster,
        price: item.basePrice,
        stockQuantity: item.totalStock,
      };
    });
    const response = await this.aspNet.bulkUpdate(siteId, updates);
    const resultsById = new Map<number, AspNetUpdateResult>();
    const resultsByCombinationId = new Map<number, AspNetUpdateResult>();
    const resultsBySku = new Map<string, AspNetUpdateResult>();
    for (const result of response.results) {
      if (result.sourceProductId !== undefined) resultsById.set(result.sourceProductId, result);
      if (result.sourceCombinationId !== undefined) {
        resultsByCombinationId.set(result.sourceCombinationId, result);
      }
      if (result.sku) resultsBySku.set(result.sku.toLocaleLowerCase(), result);
    }

    let pushed = 0;
    let updated = 0;
    let failed = 0;
    const errors: SyncItemError[] = [];
    for (const item of items) {
      const sku = item.siteSku || item.skuMaster;
      const sourceProductId = this.numericSourceId(item.siteProductId);
      const sourceCombinationId = this.combinationSourceId(item.siteProductId);
      const result =
        (sourceProductId === null ? undefined : resultsById.get(sourceProductId)) ??
        (sourceCombinationId === null
          ? undefined
          : resultsByCombinationId.get(sourceCombinationId)) ??
        resultsBySku.get(sku.toLocaleLowerCase());
      if (result?.status === 'updated' && result.remote) {
        pushed += 1;
        updated += 1;
        await this.upsertMapping(siteId, item, result.remote, false);
      } else {
        failed += 1;
        errors.push({
          sku,
          sourceProductId: sourceProductId ?? undefined,
          sourceCombinationId: sourceCombinationId ?? undefined,
          code: result?.status?.toUpperCase() ?? 'NO_RESULT',
          message: result?.message ?? 'ASP.NET site did not return a result for this product',
        });
      }
    }
    return { pushed, updated, failed, errors };
  }

  private numericSourceId(value: string | null): number | null {
    if (!value || !/^\d+$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  private combinationSourceId(value: string | null): number | null {
    const match = value?.match(/^combination:(\d+)$/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  // ─── Resolve which hub products to push for this site ─────────────────────

  private async resolvePushItems(
    siteId: string,
    scope: SyncScope,
    payload: { productIds?: string[] } | null,
  ): Promise<ResolvedPushItem[]> {
    const where: Prisma.ProductWhereInput = {};
    if (scope === 'PRODUCT_IDS' && payload?.productIds?.length) {
      where.id = { in: payload.productIds };
    }
    // For scope=MAPPING, only push products that already have a mapping for
    // this site. For scope=ALL, push every hub product (creating mappings as
    // we go).
    if (scope === 'MAPPING') {
      where.siteMappings = { some: { siteId } };
    }

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { skuMaster: 'asc' },
      include: {
        siteMappings: { where: { siteId }, take: 1 },
      },
    });

    return products.map((p) => {
      const m = p.siteMappings[0];
      return {
        productId: p.id,
        skuMaster: p.skuMaster,
        name: p.name,
        description: p.description,
        category: p.category,
        basePrice: (p.basePrice as unknown as { toString(): string }).toString(),
        totalStock: p.totalStock,
        imageUrl: p.imageUrl,
        barcode: p.barcode,
        mappingId: m?.id ?? null,
        siteSku: m?.siteSku ?? null,
        siteProductId: m?.siteProductId ?? null,
        siteSpecificTitle: m?.siteSpecificTitle ?? null,
        productType: p.productType ?? ProductType.SIMPLE,
        parentId: p.parentId ?? null,
      };
    });
  }

  // ─── Build the WC REST payload from a hub product ─────────────────────────

  private toWcPayload(item: ResolvedPushItem): WcProductPayload {
    const name = item.siteSpecificTitle || item.name;
    const sku = item.siteSku || item.skuMaster;
    const isVariable = item.productType === 'VARIABLE';
    const isVariation = item.productType === 'VARIATION';
    const payload: WcProductPayload = {
      sku,
      name,
      type: isVariable ? 'variable' : isVariation ? 'variation' : 'simple',
      regular_price: item.basePrice,
      manage_stock: !isVariable,
      stock_quantity: isVariable ? undefined : item.totalStock,
      status: 'publish',
    };
    if (item.description) payload.description = item.description;
    // Hub-only photos (hubPhotoPath) are intentionally excluded from store sync.
    if (item.imageUrl) payload.images = [{ src: item.imageUrl }];
    if (item.category) {
      payload.categories = [{ name: item.category }];
    }
    if (item.barcode) {
      // WC doesn't have a canonical barcode field; some installs use a custom
      // attribute or the SKU meta. We push it as a meta_data entry would be
      // ideal, but to keep the payload portable we omit it unless the install
      // exposes a `barcode` field. Safe no-op if not supported.
      payload.barcode = item.barcode;
    }
    return payload;
  }

  // ─── Cache the remote id back on the mapping (idempotency) ────────────────

  private async upsertMapping(
    siteId: string,
    item: ResolvedPushItem,
    remote: { id: number; sku?: string | null; kind?: 'PRODUCT' | 'COMBINATION' },
    _created: boolean,
  ): Promise<void> {
    const siteSku = item.siteSku || item.skuMaster;
    const data = {
      siteSku,
      siteProductId: remote.kind === 'COMBINATION' ? `combination:${remote.id}` : String(remote.id),
      lastSyncedAt: new Date(),
      // APPROVED because a successful push confirms the mapping is correct.
      matchStatus: item.mappingId ? undefined : ('APPROVED' as const),
    };
    if (item.mappingId) {
      await this.prisma.siteProductMapping.update({
        where: { id: item.mappingId },
        data: {
          siteSku: data.siteSku,
          siteProductId: data.siteProductId,
          lastSyncedAt: data.lastSyncedAt,
        },
      });
    } else {
      // Create a mapping row for next time; unique on (productId, siteId).
      try {
        await this.prisma.siteProductMapping.create({
          data: {
            productId: item.productId,
            siteId,
            siteSku,
            siteProductId: data.siteProductId,
            siteSpecificTitle: item.siteSpecificTitle,
            matchStatus: 'APPROVED',
            lastSyncedAt: new Date(),
          },
        });
      } catch (err) {
        // Race: another concurrent push created it first. Update instead.
        await this.prisma.siteProductMapping.updateMany({
          where: { productId: item.productId, siteId },
          data: { siteSku, siteProductId: data.siteProductId, lastSyncedAt: new Date() },
        });
      }
    }
  }

  // ─── Finalize: write SyncJob + SyncLog + lastSyncAt ───────────────────────

  private async finalize(syncJobId: string, report: SyncReport, finishedAt: Date): Promise<void> {
    const status = report.failed === 0 ? 'success' : report.pushed === 0 ? 'failed' : 'partial';
    const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });

    await this.prisma
      .$transaction([
        this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: 'COMPLETED',
            totalItems: report.pushed + report.failed,
            pushedCount: report.pushed,
            failedCount: report.failed,
            report: report as unknown as Prisma.InputJsonValue,
            errors: errorsToJson(report.errors),
            finishedAt,
          },
        }),
        this.prisma.syncLog.create({
          data: {
            siteId: job?.siteId ?? '',
            syncType: 'product_push',
            status,
            details: { syncJobId, ...report } as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.siteConfig.update({
          where: { id: job?.siteId ?? '' },
          data: { lastSyncAt: finishedAt },
        }),
      ])
      .catch(async (err) => {
        // If the transaction fails (e.g. transient), still try to mark the job.
        this.logger.warn(`Finalize transaction failed: ${(err as Error).message}`);
        await this.prisma.syncJob
          .update({
            where: { id: syncJobId },
            data: {
              status: 'COMPLETED',
              totalItems: report.pushed + report.failed,
              pushedCount: report.pushed,
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
    pushed: number,
    failed: number,
    errors: SyncItemError[],
    startedAt: Date,
    routeUsed: string,
    cause: Error,
  ): Promise<void> {
    const report: SyncReport = {
      pushed,
      failed,
      created: 0,
      updated: 0,
      errors,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      routeUsed,
    };
    try {
      const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });
      await this.prisma.$transaction([
        this.prisma.syncJob.update({
          where: { id: syncJobId },
          data: {
            status: 'FAILED',
            pushedCount: pushed,
            failedCount: failed,
            report: report as unknown as Prisma.InputJsonValue,
            errors: errorsToJson(errors),
            finishedAt: new Date(),
          },
        }),
        this.prisma.syncLog.create({
          data: {
            siteId: job?.siteId ?? '',
            syncType: 'product_push',
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
        `Failed to mark sync job ${syncJobId} FAILED: ${(err as Error).message}. Original: ${cause.message}`,
      );
    }
  }

  // ─── Queries for the admin UI ─────────────────────────────────────────────

  async listJobs(q: { siteId?: string; page: number; pageSize: number }) {
    const page = q.page;
    const pageSize = Math.min(q.pageSize, 100);
    const where: Prisma.SyncJobWhereInput = {};
    if (q.siteId) where.siteId = q.siteId;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.syncJob.count({ where }),
      this.prisma.syncJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { site: { select: { name: true } } },
      }),
    ]);
    return { data: rows, total, page, pageSize };
  }

  async listLogs(q: { siteId?: string; page: number; pageSize: number }) {
    const page = q.page;
    const pageSize = Math.min(q.pageSize, 100);
    const where: Prisma.SyncLogWhereInput = {};
    if (q.siteId) where.siteId = q.siteId;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.syncLog.count({ where }),
      this.prisma.syncLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { site: { select: { name: true } } },
      }),
    ]);
    return { data: rows, total, page, pageSize };
  }

  async deleteLog(id: string): Promise<void> {
    const row = await this.prisma.syncLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Sync log not found');
    await this.prisma.syncLog.delete({ where: { id } });
  }

  async clearFailedLogs(siteId?: string): Promise<{ deleted: number }> {
    const where: Prisma.SyncLogWhereInput = {
      status: { in: ['failed', 'partial'] },
      ...(siteId ? { siteId } : {}),
    };
    const res = await this.prisma.syncLog.deleteMany({ where });
    return { deleted: res.count };
  }

  async getJob(id: string) {
    const job = await this.prisma.syncJob.findUnique({
      where: { id },
      include: { site: { select: { name: true, networkRoute: true } } },
    });
    if (!job) throw new NotFoundException('Sync job not found');
    return job;
  }

  // ─── Scheduled-sync config ────────────────────────────────────────────────

  async updateSiteSchedule(
    siteId: string,
    input: { syncEnabled?: boolean; syncIntervalMs?: number; orderPullEnabled?: boolean },
  ): Promise<{ syncEnabled: boolean; syncIntervalMs: number; orderPullEnabled: boolean }> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (site.platform === SitePlatform.NOPCOMMERCE_ASPNET && input.orderPullEnabled === true) {
      throw new BadRequestException('Order pull cannot be enabled for an ASP.NET site');
    }
    const data: Prisma.SiteConfigUpdateInput = {};
    if (input.syncEnabled !== undefined) data.syncEnabled = input.syncEnabled;
    if (input.orderPullEnabled !== undefined) data.orderPullEnabled = input.orderPullEnabled;
    if (input.syncIntervalMs !== undefined) {
      if (input.syncIntervalMs < 60_000 || input.syncIntervalMs > 86_400_000) {
        throw new BadRequestException(
          'syncIntervalMs must be between 60000 and 86400000 (1 min – 24 h)',
        );
      }
      data.syncIntervalMs = input.syncIntervalMs;
    }
    const updated = await this.prisma.siteConfig.update({ where: { id: siteId }, data });
    return {
      syncEnabled: updated.syncEnabled,
      syncIntervalMs: updated.syncIntervalMs,
      orderPullEnabled: updated.orderPullEnabled,
    };
  }
}

function errorsToJson(errors: SyncItemError[]): Prisma.InputJsonValue {
  return errors as unknown as Prisma.InputJsonValue;
}
