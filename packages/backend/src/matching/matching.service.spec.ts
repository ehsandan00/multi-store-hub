import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { MatchStatus } from '@prisma/client';
import type { Environment } from '../config/env.validation';
import { MatchingService } from './matching.service';
import { ClaudeMatcherService, scoreSiteTitleAgainstCatalog } from './claude-matcher.service';
import * as fuzzball from 'fuzzball';

function fakePrisma() {
  const products = new Map<string, any>([
    ['p1', { id: 'p1', skuMaster: 'HUB-001', name: 'Organic Honey 500g' }],
    ['p2', { id: 'p2', skuMaster: 'HUB-002', name: 'Almond Butter Jar' }],
  ]);
  const mappings = new Map<string, any>();
  const jobs = new Map<string, any>();
  let mid = 0;
  let jid = 0;

  return {
    product: {
      findMany: async () => Array.from(products.values()),
    },
    siteConfig: {
      findUnique: async ({ where }: any) =>
        where.id === 's1'
          ? { id: 's1', name: 'Demo', isActive: true }
          : null,
    },
    siteProductMapping: {
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.productId_siteId.productId}:${where.productId_siteId.siteId}`;
        const existing = mappings.get(key);
        const row = existing ? { ...existing, ...update } : { id: `m${++mid}`, ...create };
        mappings.set(key, row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        Array.from(mappings.values()).find((m) => m.id === where.id) ?? null,
      findMany: async () => Array.from(mappings.values()),
      count: async () => mappings.size,
      update: async ({ where, data }: any) => {
        const m = Array.from(mappings.values()).find((x) => x.id === where.id);
        Object.assign(m, data);
        return m;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const m of Array.from(mappings.values())) {
          if (m.matchStatus === where.matchStatus && m.matchConfidence >= where.matchConfidence.gte) {
            Object.assign(m, data);
            count++;
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        for (const [k, m] of mappings.entries()) {
          if (m.id === where.id) mappings.delete(k);
        }
      },
    },
    matchingJob: {
      create: async ({ data }: any) => {
        const j = { id: `j${++jid}`, ...data };
        jobs.set(j.id, j);
        return j;
      },
      update: async ({ where, data }: any) => {
        const j = jobs.get(where.id);
        Object.assign(j, data);
        return j;
      },
      findUnique: async ({ where }: any) => jobs.get(where.id) ?? null,
      findMany: async () => Array.from(jobs.values()),
      count: async () => jobs.size,
    },
    _mappings: mappings,
    _jobs: jobs,
  };
}

describe('scoreSiteTitleAgainstCatalog', () => {
  const catalog = [
    { id: 'p1', skuMaster: 'HUB-001', name: 'Organic Honey 500g' },
    { id: 'p2', skuMaster: 'HUB-002', name: 'Almond Butter Jar' },
  ];

  it('returns definite tier for very similar titles', () => {
    const r = scoreSiteTitleAgainstCatalog(
      'Organic Honey 500 g',
      catalog,
      85,
      50,
      (a, b) => fuzzball.token_set_ratio(a, b),
    );
    expect(r?.tier).toBe('definite');
    expect(r?.productId).toBe('p1');
  });

  it('returns reject tier for unrelated titles', () => {
    const r = scoreSiteTitleAgainstCatalog(
      'Completely Different Widget',
      catalog,
      90,
      50,
      (a, b) => fuzzball.token_set_ratio(a, b),
    );
    expect(r?.tier).toBe('reject');
  });
});

describe('MatchingService', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let svc: MatchingService;

  beforeEach(() => {
    prisma = fakePrisma();
    const config = {
      get: (key: string) => {
        const map: Record<string, number | string> = {
          MATCH_FUZZY_DEFINITE: 85,
          MATCH_FUZZY_REJECT: 50,
          MATCH_BULK_APPROVE: 95,
          MATCH_CLAUDE_MODEL: 'claude-3-5-haiku-20241022',
          ANTHROPIC_API_KEY: '',
        };
        return map[key];
      },
    } as unknown as ConfigService<Environment, true>;
    const claude = new ClaudeMatcherService(config);
    svc = new MatchingService(prisma as any, claude, config);
  });

  it('analyzeUpload creates PENDING_REVIEW mappings for strong matches', async () => {
    const csv = Buffer.from(
      'title,sku,id\nOrganic Honey 500 g,SKU-1,99\n',
      'utf8',
    );
    const preview = await svc.analyzeUpload('s1', 'site.csv', csv);
    expect(preview.suggestedCount + preview.reviewCount).toBeGreaterThan(0);
    expect(prisma._mappings.size).toBeGreaterThan(0);
    const m = Array.from(prisma._mappings.values())[0] as any;
    expect(m.matchStatus).toBe(MatchStatus.PENDING_REVIEW);
  });

  it('bulkApprove approves only mappings above threshold', async () => {
    await prisma.siteProductMapping.upsert({
      where: { productId_siteId: { productId: 'p1', siteId: 's1' } },
      create: {
        productId: 'p1',
        siteId: 's1',
        matchConfidence: 96,
        matchStatus: MatchStatus.PENDING_REVIEW,
      },
      update: {},
    });
    const res = await svc.bulkApprove('s1');
    expect(res.approved).toBe(1);
  });
});
