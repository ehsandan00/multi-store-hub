import { describe, it, expect, beforeEach } from '@jest/globals';
import { OrdersService } from './orders.service';

/**
 * OrdersService tests against an in-memory Prisma double. Verifies list
 * filters (site, status, search, date range) and the detail include.
 */

function fakePrisma() {
  const orders: any[] = [];
  const sites = new Map<string, any>();
  const customers = new Map<string, any>();
  const items: any[] = [];

  const svc: any = {
    order: {
      count: async ({ where }: any) => orders.filter((o) => matchWhere(o, where)).length,
      findMany: async ({ where, skip, take }: any) => {
        let rows = orders.filter((o) => matchWhere(o, where));
        rows.sort((a, b) => (new Date(b.dateCreated ?? b.createdAt).getTime()) - (new Date(a.dateCreated ?? a.createdAt).getTime()));
        rows = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 25));
        return rows.map((o) => ({
          ...o,
          totalAmount: { toString: () => o.totalAmount.toString() },
          site: sites.get(o.siteId) ? { id: o.siteId, name: sites.get(o.siteId).name } : null,
          customer: o.customerId ? { id: o.customerId, name: customers.get(o.customerId)?.name, email: customers.get(o.customerId)?.email } : null,
        }));
      },
      findUnique: async ({ where, include }: any) => {
        const o = orders.find((x) => x.id === where.id);
        if (!o) return null;
        return {
          ...o,
          totalAmount: { toString: () => o.totalAmount.toString() },
          site: sites.get(o.siteId) ? { id: o.siteId, name: sites.get(o.siteId).name, baseUrl: sites.get(o.siteId).baseUrl } : null,
          customer: o.customerId ? { id: o.customerId, name: customers.get(o.customerId)?.name, email: customers.get(o.customerId)?.email, phone: customers.get(o.customerId)?.phone } : null,
          items: items.filter((i) => i.orderId === o.id).map((i) => ({
            ...i,
            unitPrice: { toString: () => i.unitPrice.toString() },
            product: i.productId ? { id: i.productId, skuMaster: 'SKU', name: 'Prod' } : null,
          })),
        };
      },
    },
    $transaction: async (arr: any) => Promise.all(arr),
    _orders: orders,
    _sites: sites,
    _customers: customers,
    _items: items,
  };
  return svc;
}

function matchWhere(o: any, where: any): boolean {
  if (!where) return true;
  if (where.siteId && o.siteId !== where.siteId) return false;
  if (where.status && o.status !== where.status) return false;
  if (where.dateCreated?.gte && new Date(o.dateCreated) < new Date(where.dateCreated.gte)) return false;
  if (where.dateCreated?.lte && new Date(o.dateCreated) > new Date(where.dateCreated.lte)) return false;
  if (where.OR) {
    const q = (where.OR[0].orderNumber?.contains ?? where.OR[1].billingName?.contains ?? where.OR[2].billingEmail?.contains ?? '').toLowerCase();
    if (q) {
      const hay = `${o.orderNumber} ${o.billingName ?? ''} ${o.billingEmail ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

function seed(prisma: any) {
  prisma._sites.set('s1', { id: 's1', name: 'Store A', baseUrl: 'https://a' });
  prisma._sites.set('s2', { id: 's2', name: 'Store B', baseUrl: 'https://b' });
  prisma._customers.set('c1', { id: 'c1', name: 'Jane Doe', email: 'jane@x.com', phone: '555' });
  prisma._orders.push(
    { id: 'o1', orderNumber: '1001', siteId: 's1', customerId: 'c1', status: 'processing', totalAmount: '49.50', dateCreated: new Date('2026-07-05T10:00:00'), billingName: 'Jane Doe', billingEmail: 'jane@x.com', createdAt: new Date(), updatedAt: new Date() },
    { id: 'o2', orderNumber: '1002', siteId: 's2', customerId: null, status: 'completed', totalAmount: '12.00', dateCreated: new Date('2026-07-04T10:00:00'), billingName: 'Bob', billingEmail: 'bob@x.com', createdAt: new Date(), updatedAt: new Date() },
    { id: 'o3', orderNumber: '1003', siteId: 's1', customerId: null, status: 'cancelled', totalAmount: '5.00', dateCreated: new Date('2026-07-01T10:00:00'), billingName: 'Carol', billingEmail: 'carol@x.com', createdAt: new Date(), updatedAt: new Date() },
  );
  prisma._items.push({ id: 'oi1', orderId: 'o1', productId: 'p1', quantity: 2, unitPrice: '20.00', siteSku: 'SKU-p1', lineName: 'Alpha' });
}

describe('OrdersService.list', () => {
  let prisma: any;
  let svc: OrdersService;

  beforeEach(() => {
    prisma = fakePrisma();
    seed(prisma);
    svc = new OrdersService(prisma);
  });

  it('returns all orders paginated with site + customer', async () => {
    const res = await svc.list({ page: 1, pageSize: 25 });
    expect(res.data).toHaveLength(3);
    expect(res.total).toBe(3);
    expect(res.data[0].site?.name).toBe('Store A'); // most recent first
  });

  it('filters by siteId', async () => {
    const res = await svc.list({ siteId: 's1', page: 1, pageSize: 25 });
    expect(res.data.every((o: any) => o.siteId === 's1')).toBe(true);
    expect(res.total).toBe(2);
  });

  it('filters by status', async () => {
    const res = await svc.list({ status: 'completed', page: 1, pageSize: 25 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].status).toBe('completed');
  });

  it('filters by date range (dateFrom)', async () => {
    const res = await svc.list({ dateFrom: '2026-07-04T00:00:00Z', page: 1, pageSize: 25 });
    expect(res.total).toBe(2);
  });

  it('searches by order number / billing name / email (case-insensitive)', async () => {
    const res = await svc.list({ search: 'jane', page: 1, pageSize: 25 });
    expect(res.total).toBe(1);
    expect(res.data[0].orderNumber).toBe('1001');
  });
});

describe('OrdersService.get', () => {
  let prisma: any;
  let svc: OrdersService;

  beforeEach(() => {
    prisma = fakePrisma();
    seed(prisma);
    svc = new OrdersService(prisma);
  });

  it('returns the order with items, site, and customer', async () => {
    const o = (await svc.get('o1')) as any;
    expect(o.id).toBe('o1');
    expect(o.items).toHaveLength(1);
    expect(o.items[0].product?.skuMaster).toBe('SKU');
    expect(o.site?.name).toBe('Store A');
    expect(o.customer?.name).toBe('Jane Doe');
  });

  it('throws NotFound for an unknown id', async () => {
    await expect(svc.get('ghost')).rejects.toThrow();
  });
});
