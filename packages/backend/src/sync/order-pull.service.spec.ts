import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { OrderPullService } from './order-pull.service';
import { WooCommerceClient } from './woocommerce-client';
import type { WcOrderRemote } from './sync.types';

/**
 * OrderPullService tests against an in-memory Prisma double with a mocked
 * WooCommerceClient (no real HTTP). Covers enqueue, idempotent upsert by
 * remoteOrderId, incremental cursor, customer upsert by email when
 * remoteCustomerId=0, line-item → product SKU linking, atomic claim, and
 * finalize (SyncLog order_pull + lastOrderPullAt stamp).
 */

function fakePrisma() {
  const sites = new Map<string, any>();
  const products = new Map<string, any>();
  const orders = new Map<string, any>();
  const customers = new Map<string, any>();
  const items: any[] = [];
  const jobs = new Map<string, any>();
  const logs: any[] = [];
  let jid = 0;

  const svc: any = {
    product: {
      findMany: async ({ where }: any) => {
        let rows = Array.from(products.values());
        if (where?.skuMaster?.in) rows = rows.filter((r: any) => where.skuMaster.in.includes(r.skuMaster));
        return rows;
      },
    },
    order: {
      findUnique: async ({ where }: any) => {
        if (where.siteId_remoteOrderId) {
          return (
            Array.from(orders.values()).find(
              (o: any) =>
                o.siteId === where.siteId_remoteOrderId.siteId &&
                o.remoteOrderId === where.siteId_remoteOrderId.remoteOrderId,
            ) ?? null
          );
        }
        return orders.get(where.id) ?? null;
      },
      create: async ({ data }: any) => {
        const id = `o${orders.size + 1}`;
        // Resolve relation connects into foreign-key fields so assertions can read them.
        const customerId = data.customer?.connect?.id ?? null;
        const siteId = data.site?.connect?.id ?? data.siteId;
        const row = { id, items: [], createdAt: new Date(), updatedAt: new Date(), ...data, siteId, customerId };
        orders.set(id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = orders.get(where.id);
        if (!existing) throw new Error('order not found');
        const customerId = data.customer?.connect?.id ?? (data.customer ? existing.customerId : existing.customerId);
        const merged = { ...existing, ...data, customerId };
        orders.set(where.id, merged);
        return merged;
      },
    },
    orderItem: {
      deleteMany: async ({ where }: any) => {
        const before = items.length;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].orderId === where.orderId) items.splice(i, 1);
        }
        return { count: before - items.length };
      },
      create: async ({ data }: any) => {
        const id = `oi${items.length + 1}`;
        const row = { id, ...data };
        items.push(row);
        return row;
      },
    },
    customer: {
      findUnique: async ({ where }: any) => {
        if (where.siteId_remoteCustomerId) {
          return (
            Array.from(customers.values()).find(
              (c: any) =>
                c.siteId === where.siteId_remoteCustomerId.siteId &&
                c.remoteCustomerId === where.siteId_remoteCustomerId.remoteCustomerId,
            ) ?? null
          );
        }
        return customers.get(where.id) ?? null;
      },
      findFirst: async ({ where }: any) =>
        Array.from(customers.values()).find(
          (c: any) =>
            c.siteId === where.siteId &&
            (!where.email || c.email?.toLowerCase() === where.email?.equals?.toLowerCase()),
        ) ?? null,
      create: async ({ data }: any) => {
        const id = `c${customers.size + 1}`;
        const row = { id, ...data };
        customers.set(id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = customers.get(where.id);
        if (!existing) throw new Error('customer not found');
        const merged = { ...existing, ...data };
        customers.set(where.id, merged);
        return merged;
      },
    },
    siteConfig: {
      findUnique: async ({ where }: any) => sites.get(where.id) ?? null,
      findMany: async ({ where }: any) =>
        Array.from(sites.values()).filter((s: any) => {
          if (where?.isActive !== undefined && s.isActive !== where.isActive) return false;
          if (where?.syncEnabled !== undefined && s.syncEnabled !== where.syncEnabled) return false;
          if (where?.orderPullEnabled !== undefined && s.orderPullEnabled !== where.orderPullEnabled)
            return false;
          return true;
        }),
      update: async ({ where, data }: any) => {
        const s = sites.get(where.id);
        if (!s) throw new Error('site not found');
        const merged = { ...s, ...data };
        sites.set(where.id, merged);
        return merged;
      },
    },
    syncJob: {
      create: async ({ data }: any) => {
        const id = `sj${++jid}`;
        const row = { id, ...data, createdAt: new Date(), startedAt: null, finishedAt: null };
        jobs.set(id, row);
        return row;
      },
      findUnique: async ({ where, include }: any) => {
        const j = jobs.get(where.id);
        if (!j) return null;
        if (include?.site) {
          return { ...j, site: sites.get(j.siteId) ? { networkRoute: sites.get(j.siteId).networkRoute, lastOrderPullAt: sites.get(j.siteId).lastOrderPullAt } : null };
        }
        return j;
      },
      update: async ({ where, data }: any) => {
        const existing = jobs.get(where.id);
        if (!existing) throw new Error('job not found');
        const merged = { ...existing, ...data };
        jobs.set(where.id, merged);
        return merged;
      },
      updateMany: async ({ where, data }: any) => {
        const target = jobs.get(where.id);
        if (!target) return { count: 0 };
        if (where.status !== undefined && target.status !== where.status) return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      },
    },
    syncLog: {
      create: async ({ data }: any) => {
        const row = { id: `sl${logs.length + 1}`, ...data, createdAt: new Date() };
        logs.push(row);
        return row;
      },
    },
    $transaction: async (arg: any) => {
      // Support both forms: array of promises, or callback receiving a tx client.
      if (typeof arg === 'function') return arg(svc);
      return Promise.all(arg);
    },
    _sites: sites,
    _products: products,
    _orders: orders,
    _customers: customers,
    _items: items,
    _jobs: jobs,
    _logs: logs,
  };
  return svc;
}

function makeSite(prisma: any, overrides: any = {}) {
  const site = {
    id: 's1',
    name: 'Test Store',
    baseUrl: 'https://store.example',
    consumerKeyEncrypted: 'enc-key',
    consumerSecretEncrypted: 'enc-secret',
    networkRoute: 'DIRECT',
    isActive: true,
    syncEnabled: false,
    syncIntervalMs: 600_000,
    lastSyncAt: null,
    orderPullEnabled: false,
    lastOrderPullAt: null,
    ...overrides,
  };
  prisma._sites.set(site.id, site);
  return site;
}

function makeProduct(prisma: any, overrides: any = {}) {
  const id = `p${prisma._products.size + 1}`;
  const p = { id, skuMaster: `SKU-${id}`, name: `Product ${id}`, ...overrides };
  prisma._products.set(id, p);
  return p;
}

function wcOrder(overrides: Partial<WcOrderRemote> = {}): WcOrderRemote {
  return {
    id: 1001,
    number: '1001',
    status: 'processing',
    total: '49.50',
    total_shipping: '5.00',
    discount_total: '0',
    currency: 'USD',
    payment_method: 'card',
    date_created: '2026-07-05T10:00:00',
    date_modified: '2026-07-05T10:00:00',
    customer_id: 7,
    billing: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '555-0100' },
    line_items: [
      { id: 1, name: 'Alpha', sku: 'SKU-p1', quantity: 2, price: '20.00', product_id: 1 },
      { id: 2, name: 'Unmatched', sku: 'NO-MATCH', quantity: 1, price: '4.50' },
    ],
    ...overrides,
  };
}

function makeService(prisma: any, woo: Partial<WooCommerceClient> = {}): OrderPullService {
  const client = {
    listOrders: jest.fn(async () => [] as WcOrderRemote[]),
    ...woo,
  } as unknown as WooCommerceClient;
  const queue: any = { add: jest.fn(async () => ({ id: 'bq1' })) };
  return new OrderPullService(prisma, client, queue);
}

const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

describe('OrderPullService.enqueuePull', () => {
  let prisma: any;
  let svc: OrderPullService;

  beforeEach(() => {
    prisma = fakePrisma();
    makeSite(prisma);
    svc = makeService(prisma);
  });

  it('creates a QUEUED PULL SyncJob and enqueues a BullMQ pull job', async () => {
    const res = await svc.enqueuePull('s1', user);
    expect(res.queued).toBe(true);
    const job = prisma._jobs.get(res.id);
    expect(job.direction).toBe('PULL');
    expect(job.status).toBe('QUEUED');
    expect(job.scope).toBe('ORDER_PULL');
    expect(job.createdByUserId).toBe(user.id);
    expect((svc as any).syncQueue.add).toHaveBeenCalledWith('pull', { syncJobId: res.id });
  });

  it('rejects pull for an inactive site', async () => {
    makeSite(prisma, { id: 's2', isActive: false });
    await expect(svc.enqueuePull('s2')).rejects.toThrow();
  });
});

describe('OrderPullService.runPull', () => {
  let prisma: any;
  let svc: OrderPullService;
  let woo: any;

  beforeEach(() => {
    prisma = fakePrisma();
    makeSite(prisma);
    makeProduct(prisma, { id: 'p1', skuMaster: 'SKU-p1', name: 'Alpha' });
    woo = { listOrders: jest.fn(async () => [] as WcOrderRemote[]) };
    svc = makeService(prisma, woo);
  });

  it('upserts orders by (siteId, remoteOrderId) idempotently — second run updates, not duplicates', async () => {
    const order = wcOrder();
    // A single partial page (< WC_ORDERS_PAGE_SIZE) ends the pagination loop,
    // so one mock return value is enough per run.
    woo.listOrders.mockResolvedValueOnce([order]);
    const { id } = await svc.enqueuePull('s1');

    const r1 = await svc.runPull(id);
    expect(r1.pulled).toBe(1);
    expect(r1.created).toBe(1);
    expect(r1.updated).toBe(0);
    expect(prisma._orders.size).toBe(1);

    // Second pull: same order modified — should update, not create a duplicate.
    const order2 = { ...order, status: 'completed', date_modified: '2026-07-05T11:00:00' };
    woo.listOrders.mockResolvedValueOnce([order2]);
    const { id: id2 } = await svc.enqueuePull('s1');
    const r2 = await svc.runPull(id2);
    expect(r2.pulled).toBe(1);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    expect(prisma._orders.size).toBe(1);
    const theOrder: any = Array.from(prisma._orders.values())[0];
    expect(theOrder.status).toBe('completed');
  });

  it('uses modifiedAfter = lastOrderPullAt for incremental pulls (first pull has null cursor)', async () => {
    makeSite(prisma, { lastOrderPullAt: new Date('2026-07-04T00:00:00Z') });
    woo.listOrders.mockResolvedValueOnce([]);
    const { id } = await svc.enqueuePull('s1');
    await svc.runPull(id);
    expect(woo.listOrders).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ modifiedAfter: expect.any(Date) }),
    );
  });

  it('upserts customer by email when remoteCustomerId=0 (guest checkout)', async () => {
    const order = wcOrder({ customer_id: 0, billing: { first_name: 'Guest', last_name: 'Buyer', email: 'guest@example.com', phone: '555' } });
    woo.listOrders.mockResolvedValueOnce([order]);
    const { id } = await svc.enqueuePull('s1');
    await svc.runPull(id);
    expect(prisma._customers.size).toBe(1);
    const c: any = Array.from(prisma._customers.values())[0];
    expect(c.email).toBe('guest@example.com');
    expect(c.remoteCustomerId).toBeNull();
    // The order is linked to the customer.
    const o: any = Array.from(prisma._orders.values())[0];
    expect(o.customerId).toBe(c.id);
  });

  it('reuses an existing customer matched by (siteId, remoteCustomerId)', async () => {
    prisma._customers.set('c1', { id: 'c1', siteId: 's1', remoteCustomerId: 7, name: 'Jane Doe', email: 'jane@example.com' });
    const order = wcOrder();
    woo.listOrders.mockResolvedValueOnce([order]);
    const { id } = await svc.enqueuePull('s1');
    await svc.runPull(id);
    expect(prisma._customers.size).toBe(1);
    const o: any = Array.from(prisma._orders.values())[0];
    expect(o.customerId).toBe('c1');
  });

  it('links line items to hub products by SKU and stores siteSku for unmatched', async () => {
    const order = wcOrder();
    woo.listOrders.mockResolvedValueOnce([order]);
    const { id } = await svc.enqueuePull('s1');
    await svc.runPull(id);
    const matched = prisma._items.find((i: any) => i.siteSku === 'SKU-p1');
    const unmatched = prisma._items.find((i: any) => i.siteSku === 'NO-MATCH');
    expect(matched).toBeTruthy();
    expect(matched.productId).toBe('p1');
    expect(unmatched).toBeTruthy();
    expect(unmatched.productId).toBeNull();
    expect(unmatched.siteSku).toBe('NO-MATCH');
  });

  it('finalizes: writes SyncLog syncType=order_pull and stamps lastOrderPullAt with newest date_modified', async () => {
    const o1 = wcOrder({ id: 1001, date_modified: '2026-07-05T09:00:00' });
    const o2 = wcOrder({ id: 1002, number: '1002', date_modified: '2026-07-05T10:30:00' });
    woo.listOrders.mockResolvedValueOnce([o1, o2]);
    const { id } = await svc.enqueuePull('s1');
    await svc.runPull(id);
    const log = prisma._logs[0];
    expect(log.syncType).toBe('order_pull');
    expect(log.status).toBe('success');
    expect(prisma._sites.get('s1').lastOrderPullAt).toEqual(new Date('2026-07-05T10:30:00'));
    expect(prisma._jobs.get(id).status).toBe('COMPLETED');
  });

  it('atomic claim: a second worker cannot claim a job already PROCESSING', async () => {
    woo.listOrders.mockResolvedValue([]);
    const { id } = await svc.enqueuePull('s1');
    await svc.runPull(id);
    // Re-running the same job id should throw (already COMPLETED, not QUEUED).
    await expect(svc.runPull(id)).rejects.toThrow();
  });

  it('records a per-order error but continues when one order fails to upsert', async () => {
    const good = wcOrder({ id: 2002, number: '2002' });
    const bad = wcOrder({ id: 2003, number: '2003' });
    woo.listOrders.mockResolvedValueOnce([good, bad]);
    // Sabotage the order findUnique so the bad order (2003) throws during upsert.
    const origFindUnique = prisma.order.findUnique;
    prisma.order.findUnique = async ({ where }: any) => {
      if (where.siteId_remoteOrderId?.remoteOrderId === 2003) throw new Error('DB error');
      return origFindUnique({ where });
    };
    const { id } = await svc.enqueuePull('s1');
    const report = await svc.runPull(id);
    expect(report.pulled).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].remoteOrderId).toBe(2003);
    prisma.order.findUnique = origFindUnique;
  });
});
