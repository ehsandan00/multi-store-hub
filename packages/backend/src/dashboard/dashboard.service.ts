import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Aggregated storewide metrics for the admin dashboard (Phase 4).
 *
 * All math runs in PostgreSQL so we never pull raw rows into JS for
 * summing — `totalAmount` is a DECIMAL(12,2) and must stay exact. We use
 * `prisma.$queryRaw` for the daily revenue series (group-by on a date
 * expression) and `groupBy`/`count` for the rest.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceIso = since.toISOString();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const expiryHorizon = new Date(todayStart);
    expiryHorizon.setDate(expiryHorizon.getDate() + 30);

    // ─── KPIs ────────────────────────────────────────────────────────────────
    const [
      totalProducts,
      totalSites,
      activeSites,
      totalOrdersAll,
      ordersLast30d,
      revenueLast30dRows,
      lowStockCountRow,
      lowStockProducts,
      inventoryAggRows,
      ordersTodayRow,
      expiringSoonRow,
      pendingMappingRow,
      recentFailedSyncRow,
      duplicateOnSiteRow,
      latestSyncRows,
      expiringSoonProducts,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.siteConfig.count(),
      this.prisma.siteConfig.count({ where: { isActive: true } }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { dateCreated: { gte: since } } }),
      // Daily revenue series (last 30d). DECIMAL sum stays exact in SQL.
      this.prisma.$queryRaw<RevenueRow[]>`
        SELECT
          to_char(date_trunc('day', "dateCreated"), 'YYYY-MM-DD') AS day,
          COALESCE(SUM("totalAmount"), 0)::text AS revenue,
          COUNT(*)::int AS orders
        FROM "Order"
        WHERE "dateCreated" >= ${since}
        GROUP BY day
        ORDER BY day ASC
      `,
      // Low-stock count requires a column-to-column comparison (totalStock <= lowStockThreshold),
      // which Prisma's where clause doesn't support — compute it in SQL.
      this.prisma.$queryRaw<LowStockCountRow[]>`
        SELECT COUNT(*)::int AS c FROM "Product"
        WHERE "lowStockThreshold" > 0 AND "totalStock" <= "lowStockThreshold"
      `,
      this.prisma.$queryRaw<LowStockProductRow[]>`
        SELECT id, "skuMaster", name, "totalStock", "lowStockThreshold", category
        FROM "Product"
        WHERE "lowStockThreshold" > 0 AND "totalStock" <= "lowStockThreshold"
        ORDER BY "totalStock" ASC
        LIMIT 5
      `,
      this.prisma.$queryRaw<InventoryAggRow[]>`
        SELECT
          COALESCE(SUM("totalStock"), 0)::int AS units,
          COALESCE(SUM("basePrice" * "totalStock"), 0)::text AS value
        FROM "Product"
      `,
      this.prisma.$queryRaw<TodayOrdersRow[]>`
        SELECT
          COUNT(*)::int AS orders,
          COALESCE(SUM("totalAmount"), 0)::text AS revenue
        FROM "Order"
        WHERE "dateCreated" >= ${todayStart}
          AND "dateCreated" <= ${todayEnd}
      `,
      this.prisma.product.count({
        where: { expiryDate: { gte: todayStart, lte: expiryHorizon } },
      }),
      this.prisma.siteProductMapping.count({ where: { matchStatus: 'PENDING_REVIEW' } }),
      this.prisma.syncLog.count({
        where: {
          status: { in: ['failed', 'partial'] },
          createdAt: { gte: since },
        },
      }),
      this.prisma.$queryRaw<DuplicateCountRow[]>`
        SELECT (
          (SELECT COUNT(*)::int FROM (
            SELECT m."siteId", m."siteSku"
            FROM "SiteProductMapping" m
            WHERE m."siteSku" IS NOT NULL AND m."siteSku" <> ''
            GROUP BY m."siteId", m."siteSku"
            HAVING COUNT(*) > 1
          ) a)
          +
          (SELECT COUNT(*)::int FROM (
            SELECT m."siteId", m."siteProductId"
            FROM "SiteProductMapping" m
            WHERE m."siteProductId" IS NOT NULL AND m."siteProductId" <> ''
            GROUP BY m."siteId", m."siteProductId"
            HAVING COUNT(*) > 1
          ) b)
        )::int AS c
      `,
      this.prisma.$queryRaw<LatestSyncRow[]>`
        SELECT DISTINCT ON (sl."siteId")
          sl."siteId",
          s.name AS "siteName",
          sl."syncType",
          sl.status,
          sl."createdAt"
        FROM "SyncLog" sl
        JOIN "SiteConfig" s ON s.id = sl."siteId"
        ORDER BY sl."siteId", sl."createdAt" DESC
      `,
      this.prisma.product.findMany({
        where: { expiryDate: { gte: todayStart, lte: expiryHorizon } },
        orderBy: { expiryDate: 'asc' },
        take: 5,
        select: {
          id: true,
          skuMaster: true,
          name: true,
          expiryDate: true,
          totalStock: true,
        },
      }),
    ]);

    const lowStockCount = lowStockCountRow[0]?.c ?? 0;
    const inventoryUnits = inventoryAggRows[0]?.units ?? 0;
    const inventoryValue = inventoryAggRows[0]?.value ?? '0';
    const ordersToday = ordersTodayRow[0]?.orders ?? 0;
    const revenueToday = ordersTodayRow[0]?.revenue ?? '0';
    const expiringSoonCount = expiringSoonRow;
    const pendingMappingReviews = pendingMappingRow;
    const failedSyncCount = recentFailedSyncRow;
    const duplicateOnSiteCount = duplicateOnSiteRow[0]?.c ?? 0;
    const activeAlerts =
      lowStockCount +
      expiringSoonCount +
      failedSyncCount +
      pendingMappingReviews +
      duplicateOnSiteCount;

    // ─── Order status breakdown (last 30d) ───────────────────────────────────
    const statusGroups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { dateCreated: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { status: 'desc' } },
    });
    const logisticsStatusGroups = await this.prisma.logisticsOrder.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const logisticsStatusCounts = {
      SENT: 0,
      NEED_PRODUCT: 0,
      CANCELED: 0,
    };
    for (const group of logisticsStatusGroups) {
      logisticsStatusCounts[group.status] = group._count._all;
    }

    // ─── Top products by quantity sold (last 30d) ────────────────────────────
    const topProductsRows = await this.prisma.$queryRaw<TopProductRow[]>`
      SELECT
        oi."productId",
        p."skuMaster",
        p.name,
        COALESCE(SUM(oi.quantity), 0)::int AS qty,
        COALESCE(SUM(oi.quantity * oi."unitPrice"), 0)::text AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON p.id = oi."productId"
      WHERE o."dateCreated" >= ${since}
        AND oi."productId" IS NOT NULL
      GROUP BY oi."productId", p."skuMaster", p.name
      ORDER BY qty DESC
      LIMIT 5
    `;

    // ─── Recent orders ───────────────────────────────────────────────────────
    const recentOrders = await this.prisma.order.findMany({
      orderBy: { dateCreated: 'desc' },
      take: 5,
      include: {
        site: { select: { id: true, name: true } },
      },
    });

    return {
      kpis: {
        totalProducts,
        lowStockCount,
        totalSites,
        activeSites,
        totalOrders: totalOrdersAll,
        ordersLast30d,
        inventoryUnits,
        inventoryValue,
        ordersToday,
        revenueToday,
        expiringSoonCount,
        pendingMappingReviews,
        failedSyncCount,
        duplicateOnSiteCount,
        activeAlerts,
      },
      alertBreakdown: {
        lowStock: lowStockCount,
        expiringSoon: expiringSoonCount,
        failedSyncs: failedSyncCount,
        pendingMappingReviews,
        duplicateOnSite: duplicateOnSiteCount,
      },
      revenueSeries: revenueLast30dRows.map((r) => ({ day: r.day, revenue: r.revenue, orders: r.orders })),
      statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      logisticsStatusCounts,
      topProducts: topProductsRows.map((r) => ({
        productId: r.productId,
        skuMaster: r.skuMaster,
        name: r.name,
        quantity: r.qty,
        revenue: r.revenue,
      })),
      lowStockProducts,
      expiringSoonProducts: expiringSoonProducts.map((p) => ({
        id: p.id,
        skuMaster: p.skuMaster,
        name: p.name,
        totalStock: p.totalStock,
        expiryDate: p.expiryDate?.toISOString() ?? null,
      })),
      latestSyncs: latestSyncRows.map((s) => ({
        siteId: s.siteId,
        siteName: s.siteName,
        syncType: s.syncType,
        status: s.status,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        siteId: o.siteId,
        siteName: o.site.name,
        status: o.status,
        totalAmount: o.totalAmount.toString(),
        dateCreated: o.dateCreated?.toISOString() ?? o.createdAt.toISOString(),
      })),
      since: sinceIso,
    };
  }
}

interface RevenueRow {
  day: string;
  revenue: string;
  orders: number;
}

interface LowStockCountRow {
  c: number;
}

interface DuplicateCountRow {
  c: number;
}

export interface LowStockProductRow {
  id: string;
  skuMaster: string;
  name: string;
  totalStock: number;
  lowStockThreshold: number;
  category: string | null;
}

interface TopProductRow {
  productId: string | null;
  skuMaster: string | null;
  name: string | null;
  qty: number;
  revenue: string;
}

interface InventoryAggRow {
  units: number;
  value: string;
}

interface TodayOrdersRow {
  orders: number;
  revenue: string;
}

interface LatestSyncRow {
  siteId: string;
  siteName: string;
  syncType: string;
  status: string;
  createdAt: Date;
}
