import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SyncService } from './sync.service';
import { WooCommerceClient } from './woocommerce-client';
import type { WcProductPayload, WcProductRemote } from './sync.types';

/**
 * Sync module tests. The SyncService is exercised against an in-memory Prisma
 * double with a mocked WooCommerceClient (no real HTTP), so we can assert the
 * push orchestration, idempotency, SyncLog writes, and the atomic claim
 * without hitting WooCommerce or Redis.
 */

function fakePrisma() {
  const sites = new Map<string, any>();
  const products = new Map<string, any>();
  const mappings = new Map<string, any>();
  const jobs = new Map<string, any>();
  const logs: any[] = [];
  const skuIndex = new Map<string, string>();
  let pid = 0;
  let jid = 0;

  const svc: any = {
    product: {
      findMany: async ({ where, include }: any) => {
        let rows = Array.from(products.values());
        if (where?.id?.in) rows = rows.filter((r: any) => where.id.in.includes(r.id));
        if (where?.siteMappings?.some) {
          rows = rows.filter((r: any) =>
            Array.from(mappings.values()).some((m: any) => m.productId === r.id && m.siteId === where.siteMappings.some.siteId),
          );
        }
        rows.sort((a: any, b: any) => a.skuMaster.localeCompare(b.skuMaster));
        // Attach the include.siteMappings relation.
        return rows.map((r: any) => ({
          ...r,
          basePrice: { toString: () => r.basePrice.toString() },
          siteMappings: Array.from(mappings.values()).filter(
            (m: any) => m.productId === r.id && (!include?.siteMappings?.where?.siteId || m.siteId === include.siteMappings.where.siteId),
          ),
        }));
      },
    },
    siteProductMapping: {
      create: async ({ data }: any) => {
        const id = `m${mappings.size + 1}`;
        const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        mappings.set(id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = mappings.get(where.id);
        if (!existing) throw new Error('mapping not found');
        const merged = { ...existing, ...data };
        mappings.set(where.id, merged);
        return merged;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const m of Array.from(mappings.values()) as any[]) {
          if (m.productId === where.productId && m.siteId === where.siteId) {
            Object.assign(m, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    siteConfig: {
      findUnique: async ({ where }: any) => sites.get(where.id) ?? null,
      findMany: async ({ where }: any) =>
        Array.from(sites.values()).filter((s: any) => {
          if (where?.isActive !== undefined && s.isActive !== where.isActive) return false;
          if (where?.syncEnabled !== undefined && s.syncEnabled !== where.syncEnabled) return false;
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
      findUnique: async ({ where }: any) => jobs.get(where.id) ?? null,
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
      count: async () => jobs.size,
      findMany: async () => Array.from(jobs.values()),
    },
    syncLog: {
      create: async ({ data }: any) => {
        const row = { id: `sl${logs.length + 1}`, ...data, createdAt: new Date() };
        logs.push(row);
        return row;
      },
      count: async () => logs.length,
      findMany: async () => logs.slice(),
    },
    $transaction: async (arr: any) => Promise.all(arr),
    // exposed for assertions
    _sites: sites,
    _products: products,
    _mappings: mappings,
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
    ...overrides,
  };
  prisma._sites.set(site.id, site);
  return site;
}

function makeProduct(prisma: any, overrides: any = {}) {
  const id = `p${prisma._products.size + 1}`;
  const p = {
    id,
    skuMaster: `SKU-${id}`,
    name: `Product ${id}`,
    description: 'desc',
    category: 'Cat',
    basePrice: new Prisma.Decimal('9.99'),
    totalStock: 10,
    imageUrl: 'https://x/i.png',
    barcode: 'BAR1',
    ...overrides,
  };
  prisma._products.set(id, p);
  return p;
}

/** Build a SyncService with a mocked WooCommerceClient. */
function makeService(prisma: any, woo: Partial<WooCommerceClient> = {}): SyncService {
  const client = {
    findProductsBySku: jest.fn(async () => new Map<string, WcProductRemote>()),
    createProduct: jest.fn(async (_siteId: string, payload: WcProductPayload) => ({
      id: Math.floor(Math.random() * 100000) + 1,
      sku: payload.sku,
      name: payload.name,
    })),
    updateProduct: jest.fn(async (_siteId: string, _id: number, payload: Partial<WcProductPayload>) => ({
      id: _id,
      sku: payload.sku,
      name: payload.name,
    })),
    upsertProductBySku: jest.fn(async (siteId: string, payload: WcProductPayload, existing?: WcProductRemote) => {
      if (existing && existing.id) {
        return { remote: await (woo.updateProduct ?? client.updateProduct)(siteId, existing.id, payload), created: false };
      }
      return { remote: await (woo.createProduct ?? client.createProduct)(siteId, payload), created: true };
    }),
    ...woo,
  } as unknown as WooCommerceClient;
  const queue: any = { add: jest.fn(async () => ({ id: 'bq1' })) };
  return new SyncService(prisma, client, queue);
}

const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

describe('SyncService.enqueuePush', () => {
  let prisma: any;
  let svc: SyncService;

  beforeEach(() => {
    prisma = fakePrisma();
    makeSite(prisma);
    svc = makeService(prisma);
  });

  it('creates a QUEUED SyncJob and enqueues a BullMQ job', async () => {
    const res = await svc.enqueuePush('s1', 'ALL', undefined, user);
    expect(res.id).toBeTruthy();
    expect(res.queued).toBe(true);
    const job = prisma._jobs.get(res.id);
    expect(job.status).toBe('QUEUED');
    expect(job.scope).toBe('ALL');
    expect(job.createdByUserId).toBe(user.id);
  });

  it('rejects push for an inactive site', async () => {
    makeSite(prisma, { id: 's2', isActive: false });
    await expect(svc.enqueuePush('s2')).rejects.toThrow(BadRequestException);
  });

  it('rejects push for an unknown site', async () => {
    await expect(svc.enqueuePush('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('SyncService.runPush (idempotent hub → site)', () => {
  let prisma: any;
  let svc: SyncService;
  let woo: any;

  beforeEach(() => {
    prisma = fakePrisma();
    makeSite(prisma);
    makeProduct(prisma, { id: 'p1', skuMaster: 'A-1', name: 'Alpha', totalStock: 7 });
    makeProduct(prisma, { id: 'p2', skuMaster: 'B-2', name: 'Beta', totalStock: 0 });
    woo = {
      findProductsBySku: jest.fn(async () => new Map<string, WcProductRemote>()),
      createProduct: jest.fn(async (_s: string, p: WcProductPayload) => ({ id: 5001, sku: p.sku, name: p.name })),
      updateProduct: jest.fn(async (_s: string, id: number, p: Partial<WcProductPayload>) => ({ id, sku: p.sku, name: p.name })),
    };
    svc = makeService(prisma, woo);
  });

  it('creates remote products when no mapping exists, and caches the remote id on a new mapping', async () => {
    const { id } = await svc.enqueuePush('s1', 'ALL');
    const report = await svc.runPush(id);
    expect(report.pushed).toBe(2);
    expect(report.created).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.failed).toBe(0);
    expect(woo.createProduct).toHaveBeenCalledTimes(2);
    expect(woo.updateProduct).not.toHaveBeenCalled();
    // Two mapping rows created with the remote id + lastSyncedAt set.
    expect(prisma._mappings.size).toBe(2);
    for (const m of Array.from(prisma._mappings.values()) as any[]) {
      expect(m.siteProductId).toBe('5001');
      expect(m.lastSyncedAt).toBeTruthy();
      expect(m.matchStatus).toBe('APPROVED');
    }
    // SyncJob finalized as COMPLETED.
    expect(prisma._jobs.get(id).status).toBe('COMPLETED');
    // Site lastSyncAt stamped.
    expect(prisma._sites.get('s1').lastSyncAt).toBeTruthy();
    // One SyncLog row written (success).
    expect(prisma._logs).toHaveLength(1);
    expect(prisma._logs[0].syncType).toBe('product_push');
    expect(prisma._logs[0].status).toBe('success');
  });

  it('updates remote products when a mapping with siteProductId exists (PUT, no create)', async () => {
    // Pre-seed mappings with a cached remote id.
    prisma._mappings.set('m1', {
      id: 'm1',
      productId: 'p1',
      siteId: 's1',
      siteSku: 'A-1',
      siteProductId: '123',
      siteSpecificTitle: null,
      matchStatus: 'APPROVED',
      lastSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma._mappings.set('m2', {
      id: 'm2',
      productId: 'p2',
      siteId: 's1',
      siteSku: 'B-2',
      siteProductId: '456',
      siteSpecificTitle: null,
      matchStatus: 'APPROVED',
      lastSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { id } = await svc.enqueuePush('s1', 'ALL');
    const report = await svc.runPush(id);
    expect(report.pushed).toBe(2);
    expect(report.updated).toBe(2);
    expect(report.created).toBe(0);
    expect(woo.updateProduct).toHaveBeenCalledTimes(2);
    expect(woo.createProduct).not.toHaveBeenCalled();
    // No new mappings created.
    expect(prisma._mappings.size).toBe(2);
  });

  it('idempotent: running the same push twice never creates duplicates (2nd run PUTs)', async () => {
    const { id: first } = await svc.enqueuePush('s1', 'ALL');
    await svc.runPush(first); // creates 2 remote products + 2 mappings
    const { id: second } = await svc.enqueuePush('s1', 'ALL');
    const report = await svc.runPush(second);
    expect(report.created).toBe(0);
    expect(report.updated).toBe(2);
    expect(woo.createProduct).toHaveBeenCalledTimes(2); // only from the first run
    expect(woo.updateProduct).toHaveBeenCalledTimes(2); // only from the second run
    // Still only 2 mappings (no duplicates).
    expect(prisma._mappings.size).toBe(2);
  });

  it('records per-item failures without aborting the batch (partial sync)', async () => {
    woo.createProduct = jest.fn(async (_s: string, p: WcProductPayload) => {
      if (p.sku === 'A-1') throw new Error('WC rejected: duplicate SKU');
      return { id: 7000, sku: p.sku, name: p.name };
    });
    const { id } = await svc.enqueuePush('s1', 'ALL');
    const report = await svc.runPush(id);
    expect(report.pushed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors[0].sku).toBe('A-1');
    expect(report.errors[0].message).toMatch(/duplicate SKU/);
    // SyncLog status is 'partial' (some pushed, some failed).
    expect(prisma._logs[0].status).toBe('partial');
    expect(prisma._jobs.get(id).status).toBe('COMPLETED');
  });

  it('rejects runPush when the job is not in QUEUED state (atomic claim)', async () => {
    const { id } = await svc.enqueuePush('s1', 'ALL');
    await prisma.syncJob.update({ where: { id }, data: { status: 'PROCESSING' } });
    await expect(svc.runPush(id)).rejects.toThrow(BadRequestException);
  });

  it('scope=PRODUCT_IDS only pushes the listed products', async () => {
    makeProduct(prisma, { id: 'p3', skuMaster: 'C-3', name: 'Gamma', totalStock: 3 });
    const { id } = await svc.enqueuePush('s1', 'PRODUCT_IDS', ['p1', 'p3']);
    const report = await svc.runPush(id);
    expect(report.pushed).toBe(2);
    expect(woo.createProduct).toHaveBeenCalledTimes(2);
    const pushedSkus = (woo.createProduct as jest.Mock).mock.calls.map((c: any[]) => c[1].sku);
    expect(pushedSkus.sort()).toEqual(['A-1', 'C-3']);
  });

  it('scope=MAPPING only pushes products that already have a mapping', async () => {
    prisma._mappings.set('m1', {
      id: 'm1', productId: 'p1', siteId: 's1', siteSku: 'A-1', siteProductId: '99',
      siteSpecificTitle: null, matchStatus: 'APPROVED', lastSyncedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const { id } = await svc.enqueuePush('s1', 'MAPPING');
    const report = await svc.runPush(id);
    expect(report.pushed).toBe(1);
    expect(report.updated).toBe(1);
  });
});

describe('SyncService schedule config + queries', () => {
  let prisma: any;
  let svc: SyncService;

  beforeEach(() => {
    prisma = fakePrisma();
    makeSite(prisma);
    svc = makeService(prisma);
  });

  it('updateSiteSchedule toggles syncEnabled and validates the interval bounds', async () => {
    const res = await svc.updateSiteSchedule('s1', { syncEnabled: true, syncIntervalMs: 300_000 });
    expect(res.syncEnabled).toBe(true);
    expect(res.syncIntervalMs).toBe(300_000);
    expect(prisma._sites.get('s1').syncEnabled).toBe(true);
    await expect(svc.updateSiteSchedule('s1', { syncIntervalMs: 10 })).rejects.toThrow(BadRequestException);
    await expect(svc.updateSiteSchedule('s1', { syncIntervalMs: 100_000_000 })).rejects.toThrow(BadRequestException);
  });

  it('updateSiteSchedule throws NotFound for an unknown site', async () => {
    await expect(svc.updateSiteSchedule('ghost', { syncEnabled: true })).rejects.toThrow(NotFoundException);
  });

  it('getJob throws NotFound for an unknown id', async () => {
    await expect(svc.getJob('ghost')).rejects.toThrow(NotFoundException);
  });
});
