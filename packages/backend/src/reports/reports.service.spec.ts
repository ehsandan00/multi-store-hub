import { describe, it, expect, beforeEach } from '@jest/globals';
import { ReportsService } from './reports.service';

function fakePrisma() {
  const products: any[] = [];
  const orders: any[] = [];
  const orderItems: any[] = [];
  const customers: any[] = [];
  const syncLogs: any[] = [];
  const sites: any[] = [];
  const mappings: any[] = [];

  const svc: any = {
    product: {
      count: async (arg?: any) => {
        const where = arg?.where;
        let list = products;
        if (where?.expiryDate) {
          list = list.filter((p) => {
            if (!p.expiryDate) return false;
            const d = new Date(p.expiryDate);
            if (where.expiryDate.gte && d < new Date(where.expiryDate.gte)) return false;
            if (where.expiryDate.lte && d > new Date(where.expiryDate.lte)) return false;
            return true;
          });
        }
        return list.length;
      },
      findMany: async (arg?: any) => {
        const where = arg?.where;
        let list = products.slice();
        if (where?.expiryDate) {
          list = list.filter((p) => {
            if (!p.expiryDate) return false;
            const d = new Date(p.expiryDate);
            if (where.expiryDate.gte && d < new Date(where.expiryDate.gte)) return false;
            if (where.expiryDate.lte && d > new Date(where.expiryDate.lte)) return false;
            return true;
          });
        }
        list.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        const take = arg?.take ?? list.length;
        const skip = arg?.skip ?? 0;
        return list.slice(skip, skip + take).map((p) => ({
          ...p,
          expiryDate: p.expiryDate ? new Date(p.expiryDate) : null,
        }));
      },
    },
    customer: {
      count: async (arg?: any) => {
        const where = arg?.where;
        return customers.filter((c) => matchCustomer(c, where)).length;
      },
      findMany: async (arg?: any) => {
        const where = arg?.where;
        let list = customers.filter((c) => matchCustomer(c, where));
        const sortBy = Object.keys(arg?.orderBy ?? {})[0] ?? 'totalSpent';
        const dir = arg?.orderBy?.[sortBy] === 'asc' ? 1 : -1;
        list.sort((a, b) => {
          const av = a[sortBy];
          const bv = b[sortBy];
          if (av < bv) return -dir;
          if (av > bv) return dir;
          return 0;
        });
        const skip = arg?.skip ?? 0;
        const take = arg?.take ?? list.length;
        return list.slice(skip, skip + take).map((c) => ({
          ...c,
          totalSpent: { toString: () => String(c.totalSpent) },
          site: sites.find((s) => s.id === c.siteId) ?? null,
        }));
      },
    },
    syncLog: {
      count: async (arg?: any) => {
        const where = arg?.where;
        return syncLogs.filter((l) => matchSyncLog(l, where)).length;
      },
      findMany: async (arg?: any) => {
        const where = arg?.where;
        let list = syncLogs.filter((l) => matchSyncLog(l, where));
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const skip = arg?.skip ?? 0;
        const take = arg?.take ?? list.length;
        return list.slice(skip, skip + take).map((l) => ({
          ...l,
          createdAt: new Date(l.createdAt),
          site: sites.find((s) => s.id === l.siteId) ?? { name: 'Unknown' },
        }));
      },
    },
    $queryRawUnsafe: async (sql: string, ...params: any[]) => {
      if (sql.includes('FROM "Product" p') && sql.includes('COUNT(*)')) {
        let list = products;
        if (sql.includes('lowStockThreshold')) {
          list = list.filter((p) => p.totalStock <= p.lowStockThreshold);
        }
        if (params.some((p) => typeof p === 'string' && p.startsWith('site-'))) {
          const siteId = params.find((p) => typeof p === 'string' && p.startsWith('site-'));
          const mapped = new Set(mappings.filter((m) => m.siteId === siteId).map((m) => m.productId));
          list = list.filter((p) => mapped.has(p.id));
        }
        return [{ c: list.length }];
      }
      if (sql.includes('FROM "Product" p') && sql.includes('SELECT p.id')) {
        let list = products.slice();
        if (sql.includes('lowStockThreshold')) {
          list = list.filter((p) => p.totalStock <= p.lowStockThreshold);
        }
        list.sort((a, b) => a.totalStock - b.totalStock);
        return list.slice(0, params[params.length - 2] ?? 25).map((p) => ({
          ...p,
          expiryDate: p.expiryDate ? new Date(p.expiryDate) : null,
        }));
      }
      if (sql.includes('JOIN "SiteConfig"') && sql.includes('siteName')) {
        const bySite = new Map<string, { siteName: string; orderCount: number; revenue: number }>();
        for (const o of orders) {
          const site = sites.find((s) => s.id === o.siteId);
          const cur = bySite.get(o.siteId) ?? { siteName: site?.name ?? o.siteId, orderCount: 0, revenue: 0 };
          cur.orderCount += 1;
          cur.revenue += Number(o.totalAmount);
          bySite.set(o.siteId, cur);
        }
        return Array.from(bySite.entries()).map(([siteId, v]) => ({
          siteId,
          siteName: v.siteName,
          orderCount: v.orderCount,
          revenue: v.revenue.toFixed(2),
        }));
      }
      if (sql.includes('GROUP BY o."siteId"') && sql.includes('COUNT(*)')) {
        const siteIds = new Set(orders.map((o) => o.siteId));
        return [{ c: siteIds.size }];
      }
      if (sql.includes('OrderItem') && sql.includes('GROUP BY oi."productId"')) {
        return [];
      }
      if (sql.includes('date_trunc') && sql.includes('GROUP BY day')) {
        return [];
      }
      return [];
    },
    $transaction: async (arr: any) => Promise.all(arr),
    _products: products,
    _orders: orders,
    _customers: customers,
    _syncLogs: syncLogs,
    _sites: sites,
    _mappings: mappings,
  };
  return svc;
}

function matchCustomer(c: any, where: any): boolean {
  if (!where) return true;
  if (where.siteId && c.siteId !== where.siteId) return false;
  if (where.OR && where.OR.length) {
    const q = where.OR[0]?.name?.contains?.toLowerCase?.();
    if (q) {
      const hay = `${c.name} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
      return hay.includes(q);
    }
  }
  return true;
}

function matchSyncLog(l: any, where: any): boolean {
  if (!where) return true;
  if (where.siteId && l.siteId !== where.siteId) return false;
  if (where.syncType && l.syncType !== where.syncType) return false;
  if (where.status && l.status !== where.status) return false;
  return true;
}

function seed(prisma: any) {
  prisma._sites.push({ id: 's1', name: 'Store A' });
  prisma._products.push(
    {
      id: 'p1',
      skuMaster: 'SKU-1',
      name: 'Alpha',
      category: 'Snacks',
      basePrice: '10.00',
      totalStock: 2,
      lowStockThreshold: 5,
      expiryDate: '2026-07-20T00:00:00Z',
    },
    {
      id: 'p2',
      skuMaster: 'SKU-2',
      name: 'Beta',
      category: 'Drinks',
      basePrice: '5.00',
      totalStock: 50,
      lowStockThreshold: 5,
      expiryDate: '2027-01-01T00:00:00Z',
    },
  );
  prisma._mappings.push({ productId: 'p1', siteId: 's1' });
  prisma._orders.push(
    { id: 'o1', siteId: 's1', totalAmount: '49.50', dateCreated: new Date().toISOString() },
    { id: 'o2', siteId: 's1', totalAmount: '12.00', dateCreated: new Date().toISOString() },
  );
  prisma._customers.push(
    {
      id: 'c1',
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555',
      siteId: 's1',
      totalOrdersCount: 3,
      totalSpent: 120,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  );
  prisma._syncLogs.push({
    id: 'l1',
    siteId: 's1',
    syncType: 'product_push',
    status: 'success',
    createdAt: new Date().toISOString(),
  });
}

describe('ReportsService', () => {
  let prisma: any;
  let svc: ReportsService;

  beforeEach(() => {
    prisma = fakePrisma();
    seed(prisma);
    svc = new ReportsService(prisma);
  });

  it('inventory lists products and flags low stock', async () => {
    const r = await svc.inventory({ page: 1, pageSize: 25 });
    expect(r.total).toBe(2);
    const alpha = r.data.find((p) => p.skuMaster === 'SKU-1');
    expect(alpha?.isLowStock).toBe(true);
  });

  it('inventory lowStockOnly filter returns only low-stock rows', async () => {
    const r = await svc.inventory({ lowStockOnly: true, page: 1, pageSize: 25 });
    expect(r.total).toBe(1);
    expect(r.data[0].skuMaster).toBe('SKU-1');
  });

  it('expiry returns products in range with daysUntilExpiry', async () => {
    const r = await svc.expiry({ days: 365, page: 1, pageSize: 25 });
    expect(r.total).toBeGreaterThan(0);
    expect(r.data[0].daysUntilExpiry).not.toBeNull();
  });

  it('sales by site aggregates order revenue', async () => {
    const r = await svc.sales({ groupBy: 'site', page: 1, pageSize: 25 });
    expect(r.groupBy).toBe('site');
    expect(r.data.length).toBeGreaterThan(0);
    expect(Number((r.data[0] as any).revenue)).toBeCloseTo(61.5, 1);
  });

  it('sync history returns log rows with site name', async () => {
    const r = await svc.syncHistory({ page: 1, pageSize: 25 });
    expect(r.total).toBe(1);
    expect(r.data[0].siteName).toBe('Store A');
  });

  it('customers lists with total spent as string', async () => {
    const r = await svc.customers({ page: 1, pageSize: 25, sortBy: 'totalSpent', sortDir: 'desc' });
    expect(r.total).toBe(1);
    expect(r.data[0].totalSpent).toBe('120');
  });

  it('inventoryXlsx returns a non-empty buffer', async () => {
    const buf = await svc.inventoryXlsx({});
    expect(buf.length).toBeGreaterThan(100);
  });
});
