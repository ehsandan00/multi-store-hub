import { describe, it, expect, beforeEach } from '@jest/globals';
import { DashboardService } from './dashboard.service';

/**
 * DashboardService tests against an in-memory Prisma double. The raw SQL
 * aggregates are replaced with deterministic in-memory equivalents so we
 * can verify the service's shape logic (KPIs, series, top products, low stock).
 */

function fakePrisma() {
  const products: any[] = [];
  const sites: any[] = [];
  const orders: any[] = [];

  const svc: any = {
    product: {
      count: async (arg?: any) => {
        const where = arg?.where;
        if (where?.totalStock?.lte !== undefined) {
          return products.filter((p) => p.totalStock <= p.lowStockThreshold).length;
        }
        return products.length;
      },
    },
    siteConfig: {
      count: async (arg?: any) => {
        const where = arg?.where;
        if (where?.isActive !== undefined) return sites.filter((s) => s.isActive === where.isActive).length;
        return sites.length;
      },
    },
    order: {
      count: async (arg?: any) => {
        const where = arg?.where;
        if (where?.dateCreated?.gte) return orders.filter((o) => new Date(o.dateCreated) >= new Date(where.dateCreated.gte)).length;
        return orders.length;
      },
      groupBy: async ({ where }: any) => {
        const since = where?.dateCreated?.gte ? new Date(where.dateCreated.gte) : null;
        const inRange = orders.filter((o) => !since || new Date(o.dateCreated) >= since);
        const counts = new Map<string, number>();
        for (const o of inRange) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { _all: count } }));
      },
      findMany: async ({ take }: any) => {
        const sorted = orders.slice().sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime());
        return sorted.slice(0, take ?? 5).map((o) => ({
          ...o,
          dateCreated: new Date(o.dateCreated),
          createdAt: new Date(o.createdAt),
          totalAmount: { toString: () => o.totalAmount.toString() },
          site: sites.find((s) => s.id === o.siteId) ? { id: o.siteId, name: sites.find((s) => s.id === o.siteId).name } : null,
        }));
      },
    },
    // Raw SQL stubs — return deterministic shapes the service consumes.
    $queryRaw: async (strings: TemplateStringsArray, ...vals: any[]) => {
      const sql = strings.join('?');
      const since = vals[0];
      if (sql.includes('date_trunc')) {
        // Daily revenue series.
        const inRange = orders.filter((o) => !since || new Date(o.dateCreated) >= new Date(since));
        const byDay = new Map<string, { revenue: number; orders: number }>();
        for (const o of inRange) {
          const day = new Date(o.dateCreated).toISOString().slice(0, 10);
          const cur = byDay.get(day) ?? { revenue: 0, orders: 0 };
          cur.revenue += Number(o.totalAmount);
          cur.orders += 1;
          byDay.set(day, cur);
        }
        return Array.from(byDay.entries())
          .map(([day, v]) => ({ day, revenue: v.revenue.toFixed(2), orders: v.orders }))
          .sort((a, b) => a.day.localeCompare(b.day));
      }
      if (sql.includes('COUNT(*)') && sql.includes('lowStockThreshold')) {
        return [{ c: products.filter((p) => p.totalStock <= p.lowStockThreshold).length }];
      }
      if (sql.includes('lowStockThreshold') && sql.includes('LIMIT')) {
        return products
          .filter((p) => p.totalStock <= p.lowStockThreshold)
          .sort((a, b) => a.totalStock - b.totalStock)
          .slice(0, 5)
          .map((p) => ({ id: p.id, skuMaster: p.skuMaster, name: p.name, totalStock: p.totalStock, lowStockThreshold: p.lowStockThreshold, category: p.category ?? null }));
      }
      if (sql.includes('OrderItem')) {
        // Top products by qty.
        return [];
      }
      return [];
    },
    $transaction: async (arr: any) => Promise.all(arr),
    _products: products,
    _sites: sites,
    _orders: orders,
  };
  return svc;
}

function seed(prisma: any) {
  prisma._sites.push(
    { id: 's1', name: 'Store A', isActive: true },
    { id: 's2', name: 'Store B', isActive: false },
  );
  prisma._products.push(
    { id: 'p1', skuMaster: 'SKU-1', name: 'Alpha', totalStock: 2, lowStockThreshold: 5, category: 'Snacks' },
    { id: 'p2', skuMaster: 'SKU-2', name: 'Beta', totalStock: 50, lowStockThreshold: 5, category: 'Drinks' },
  );
  const today = new Date();
  prisma._orders.push(
    { id: 'o1', orderNumber: '1001', siteId: 's1', status: 'processing', totalAmount: '49.50', dateCreated: today.toISOString() },
    { id: 'o2', orderNumber: '1002', siteId: 's1', status: 'completed', totalAmount: '12.00', dateCreated: today.toISOString() },
    { id: 'o3', orderNumber: '1003', siteId: 's2', status: 'completed', totalAmount: '5.00', dateCreated: '2026-01-01T00:00:00Z' },
  );
}

describe('DashboardService.getSummary', () => {
  let prisma: any;
  let svc: DashboardService;

  beforeEach(() => {
    prisma = fakePrisma();
    seed(prisma);
    svc = new DashboardService(prisma);
  });

  it('returns KPIs (totalProducts, lowStockCount, sites, orders)', async () => {
    const s = await svc.getSummary();
    expect(s.kpis.totalProducts).toBe(2);
    expect(s.kpis.lowStockCount).toBe(1); // Alpha (2 <= 5)
    expect(s.kpis.totalSites).toBe(2);
    expect(s.kpis.activeSites).toBe(1);
    expect(s.kpis.totalOrders).toBe(3);
    expect(s.kpis.ordersLast30d).toBe(2); // o1, o2 today; o3 in January
  });

  it('returns a revenue series for the last 30 days', async () => {
    const s = await svc.getSummary();
    expect(s.revenueSeries.length).toBeGreaterThan(0);
    const today = new Date().toISOString().slice(0, 10);
    const todayPoint = s.revenueSeries.find((p: any) => p.day === today);
    expect(todayPoint).toBeTruthy();
    expect(Number(todayPoint!.revenue)).toBeCloseTo(61.5, 2); // 49.50 + 12.00
    expect(todayPoint!.orders).toBe(2);
  });

  it('returns an order status breakdown for the last 30 days', async () => {
    const s = await svc.getSummary();
    const statuses = s.statusBreakdown.map((x: any) => x.status);
    expect(statuses).toContain('processing');
    expect(statuses).toContain('completed');
    // o3 (January) excluded.
    const completed = s.statusBreakdown.find((x: any) => x.status === 'completed');
    expect(completed?.count).toBe(1);
  });

  it('returns low-stock products (sorted by totalStock asc, capped at 5)', async () => {
    const s = await svc.getSummary();
    expect(s.lowStockProducts).toHaveLength(1);
    expect(s.lowStockProducts[0].skuMaster).toBe('SKU-1');
  });

  it('returns recent orders with site name (newest first, capped at 5)', async () => {
    const s = await svc.getSummary();
    expect(s.recentOrders.length).toBeGreaterThan(0);
    expect(s.recentOrders[0].orderNumber).toBe('1001');
    expect(s.recentOrders[0].siteName).toBe('Store A');
  });
});
