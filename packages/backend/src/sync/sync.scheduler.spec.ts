import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { encrypt } from '../config/crypto.util';
import { WooCommerceClient } from './woocommerce-client';
import { SyncScheduler } from './sync.scheduler';
import { SyncService } from './sync.service';
import { SYNC_DEFAULT_MIN_INTERVAL_MS } from './sync.types';

/**
 * Tests for the WooCommerceClient rate-limit gate (per-site concurrency +
 * min-interval spacing) and the SyncScheduler tick (only enqueue sites that
 * are due). Both are tested without real HTTP or Redis.
 */

function fakePrismaWithSite(site: any) {
  const sites = new Map<string, any>([[site.id, site]]);
  return {
    siteConfig: {
      findUnique: async ({ where }: any) => sites.get(where.id) ?? null,
      findMany: async ({ where, select }: any) =>
        Array.from(sites.values())
          .filter((s: any) => {
            if (where?.isActive !== undefined && s.isActive !== where.isActive) return false;
            if (where?.syncEnabled !== undefined && s.syncEnabled !== where.syncEnabled) return false;
            if (where?.orderPullEnabled !== undefined && s.orderPullEnabled !== where.orderPullEnabled)
              return false;
            return true;
          })
          .map((s: any) => {
            if (!select) return s;
            const out: any = {};
            for (const k of Object.keys(select)) {
              if (select[k]) out[k] = s[k];
            }
            return out;
          }),
      update: async ({ where, data }: any) => {
        const s = sites.get(where.id);
        const merged = { ...s, ...data };
        sites.set(where.id, merged);
        return merged;
      },
    },
    product: { findMany: async () => [] },
    siteProductMapping: { create: async () => ({}), update: async () => ({}), updateMany: async () => ({ count: 0 }) },
    syncJob: {
      create: async ({ data }: any) => ({ id: `sj${Math.random()}`, ...data }),
      findUnique: async () => null,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
      count: async () => 0,
      findMany: async () => [],
    },
    syncLog: { create: async () => ({}), count: async () => 0, findMany: async () => [] },
    $transaction: async (arr: any) => Promise.all(arr),
    _sites: sites,
  };
}

function fakeHttp() {
  const calls: { t: number; method: string; path: string }[] = [];
  const http: any = {
    request: jest.fn(async (site: any, opts: any) => {
      calls.push({ t: Date.now(), method: opts.method, path: opts.path });
      // Simulate a small network delay so concurrency is observable.
      await new Promise((r) => setTimeout(r, 10));
      return { status: 200, body: opts.method === 'GET' ? [] : { id: 1, sku: 'X' }, routeUsed: site.networkRoute, latencyMs: 10, attempts: 1 };
    }),
    _calls: calls,
  };
  return http;
}

describe('WooCommerceClient rate-limit gate', () => {
  let prisma: any;
  let http: any;
  let client: WooCommerceClient;

  beforeEach(() => {
    prisma = fakePrismaWithSite({
      id: 's1', name: 'T', baseUrl: 'https://x', networkRoute: 'DIRECT',
      consumerKeyEncrypted: encrypt('ck_key'), consumerSecretEncrypted: encrypt('cs_secret'),
    });
    http = fakeHttp();
    client = new WooCommerceClient(http, prisma);
  });

  it('spaces successive requests to the same site by >= SYNC_DEFAULT_MIN_INTERVAL_MS', async () => {
    // Two sequential GETs to the same site. The gate should serialize them
    // and space their start times by at least the min interval (minus a tiny
    // tolerance for timer jitter).
    await client.findProductsBySku('s1', ['A']);
    await client.findProductsBySku('s1', ['B']);
    expect(http._calls).toHaveLength(2);
    const gap = http._calls[1].t - http._calls[0].t;
    expect(gap).toBeGreaterThanOrEqual(SYNC_DEFAULT_MIN_INTERVAL_MS - 50);
  });

  it('dispatches requests for DIFFERENT sites concurrently (no cross-site gating)', async () => {
    prisma._sites.set('s2', {
      id: 's2', name: 'T2', baseUrl: 'https://y', networkRoute: 'DIRECT',
      consumerKeyEncrypted: encrypt('ck2'), consumerSecretEncrypted: encrypt('cs2'),
    });
    const start = Date.now();
    await Promise.all([
      client.findProductsBySku('s1', ['A']),
      client.findProductsBySku('s2', ['A']),
    ]);
    const total = Date.now() - start;
    expect(http._calls).toHaveLength(2);
    // Two different sites should run concurrently — total time should be
    // well under the min interval (which would apply only if serialized).
    expect(total).toBeLessThan(SYNC_DEFAULT_MIN_INTERVAL_MS);
  });
});

describe('SyncScheduler.runTick (only due sites are enqueued)', () => {
  let prisma: any;
  let sync: SyncService;
  let orderPull: any;
  let scheduler: SyncScheduler;
  let queue: any;

  beforeEach(() => {
    prisma = fakePrismaWithSite({
      id: 's1', name: 'A', networkRoute: 'DIRECT', baseUrl: 'https://x',
      consumerKeyEncrypted: encrypt('e'), consumerSecretEncrypted: encrypt('e'),
      isActive: true, syncEnabled: true, syncIntervalMs: 600_000, lastSyncAt: null,
      orderPullEnabled: false, lastOrderPullAt: null,
    });
    // Second site that synced recently → not due.
    prisma._sites.set('s2', {
      id: 's2', name: 'B', networkRoute: 'DIRECT', baseUrl: 'https://x',
      consumerKeyEncrypted: encrypt('e'), consumerSecretEncrypted: encrypt('e'),
      isActive: true, syncEnabled: true, syncIntervalMs: 600_000,
      lastSyncAt: new Date(),
      orderPullEnabled: false, lastOrderPullAt: null,
    });
    queue = { add: jest.fn(), removeRepeatableByKey: jest.fn(async () => undefined) };
    const woo: any = {};
    sync = new SyncService(prisma, woo, queue);
    orderPull = { enqueuePull: jest.fn(async () => ({ id: 'pull-1', status: 'QUEUED', queued: true })) };
    scheduler = new SyncScheduler(queue, prisma, sync, orderPull);
  });

  it('enqueues only sites whose lastSyncAt is older than syncIntervalMs (or null)', async () => {
    const spy = jest.spyOn(sync, 'enqueuePush');
    const res = await scheduler.runTick();
    expect(res.enqueued).toBe(1);
    expect(res.siteIds).toEqual(['s1']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('s1', 'ALL');
  });

  it('skips sites with syncEnabled=false', async () => {
    prisma._sites.get('s1').syncEnabled = false;
    prisma._sites.delete('s2');
    const res = await scheduler.runTick();
    expect(res.enqueued).toBe(0);
  });

  it('enqueues order pull for sites with orderPullEnabled=true and stale lastOrderPullAt', async () => {
    prisma._sites.get('s1').syncEnabled = false;
    prisma._sites.get('s1').orderPullEnabled = true;
    prisma._sites.get('s1').lastOrderPullAt = null;
    prisma._sites.delete('s2');
    const res = await scheduler.runTick();
    expect(res.enqueued).toBe(1);
    expect(orderPull.enqueuePull).toHaveBeenCalledWith('s1');
  });
});
