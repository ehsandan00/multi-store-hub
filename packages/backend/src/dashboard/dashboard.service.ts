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
        WHERE "dateCreated" >= ${sinceIso}
        GROUP BY day
        ORDER BY day ASC
      `,
      // Low-stock count requires a column-to-column comparison (totalStock <= lowStockThreshold),
      // which Prisma's where clause doesn't support — compute it in SQL.
      this.prisma.$queryRaw<LowStockCountRow[]>`
        SELECT COUNT(*)::int AS c FROM "Product" WHERE "totalStock" <= "lowStockThreshold"
      `,
      this.prisma.$queryRaw<LowStockProductRow[]>`
        SELECT id, "skuMaster", name, "totalStock", "lowStockThreshold", category
        FROM "Product"
        WHERE "totalStock" <= "lowStockThreshold"
        ORDER BY "totalStock" ASC
        LIMIT 5
      `,
    ]);

    const lowStockCount = lowStockCountRow[0]?.c ?? 0;

    // ─── Order status breakdown (last 30d) ───────────────────────────────────
    const statusGroups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { dateCreated: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { status: 'desc' } },
    });

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
      WHERE o."dateCreated" >= ${sinceIso}
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
      },
      revenueSeries: revenueLast30dRows.map((r) => ({ day: r.day, revenue: r.revenue, orders: r.orders })),
      statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      topProducts: topProductsRows.map((r) => ({
        productId: r.productId,
        skuMaster: r.skuMaster,
        name: r.name,
        quantity: r.qty,
        revenue: r.revenue,
      })),
      lowStockProducts,
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
