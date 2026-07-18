import { describe, it, expect, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HttpProxyService } from '../http-proxy/http-proxy.service';
import { HttpProxyError } from '../http-proxy/http-proxy.error';
import { SitesService } from './sites.service';

function fakePrisma(): PrismaService & {
  sites: Map<string, any>;
  logs: any[];
} {
  const sites = new Map<string, any>();
  const logs: any[] = [];
  let id = 0;
  const svc: any = {
    siteConfig: {
      findUnique: async ({ where }: any) => sites.get(where.id) ?? null,
      findFirst: async () => null,
      findMany: async () => Array.from(sites.values()),
      count: async () => sites.size,
      create: async ({ data }: any) => {
        const row = { id: `s${++id}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        sites.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = sites.get(where.id);
        if (!existing) throw new Error('not found');
        const merged = { ...existing, ...data };
        sites.set(where.id, merged);
        return merged;
      },
      delete: async ({ where }: any) => {
        if (!sites.has(where.id)) throw new Error('not found');
        sites.delete(where.id);
      },
    },
    syncLog: {
      create: async ({ data }: any) => {
        logs.push({ id: `log${logs.length + 1}`, ...data });
      },
    },
    $transaction: async (arr: any) => Promise.all(arr),
    sites,
    logs,
  };
  return svc as PrismaService & { sites: Map<string, any>; logs: any[] };
}

function fakeHttp(impl: (site: any) => Promise<any>): HttpProxyService {
  return {
    request: (site: any) => impl(site),
  } as unknown as HttpProxyService;
}

describe('SitesService', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('encrypts consumer key/secret on create and never returns them in clear', async () => {
    const prisma = fakePrisma();
    const svc = new SitesService(prisma, fakeHttp(async () => ({ status: 200 })));
    const created = await svc.create({
      name: 'Demo',
      baseUrl: 'https://demo.example.com',
      consumerKey: 'ck_live_abc',
      consumerSecret: 'cs_live_xyz',
      networkRoute: 'DIRECT',
    });
    // raw row in storage must be encrypted, not plaintext
    const raw = prisma.sites.get(created.id);
    expect(raw.consumerKeyEncrypted).not.toBe('ck_live_abc');
    expect(raw.consumerSecretEncrypted).not.toBe('cs_live_xyz');
    // public representation must be masked, not full
    expect(created.consumerKeyMasked).not.toContain('ck_live_abc');
    expect(created.consumerSecretMasked).not.toContain('cs_live_xyz');
  });

  it('test-connection success path writes SyncLog(status=success) and returns route', async () => {
    const prisma = fakePrisma();
    const http = fakeHttp(async () => ({
      status: 200,
      latencyMs: 123,
      routeUsed: 'DIRECT',
      attempts: 1,
    }));
    const svc = new SitesService(prisma, http);
    const s = await svc.create({
      name: 'Demo',
      baseUrl: 'https://demo.example.com',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      networkRoute: 'DIRECT',
    });

    const res = await svc.testConnection(s.id);
    expect(res.ok).toBe(true);
    expect(res.routeUsed).toBe('DIRECT');
    expect(prisma.logs).toHaveLength(1);
    expect(prisma.logs[0].status).toBe('success');
    expect(prisma.logs[0].syncType).toBe('test_connection');
  });

  it('test-connection failure path writes SyncLog(status=failed) and surfaces error code', async () => {
    const prisma = fakePrisma();
    const http = fakeHttp(async () => {
      throw new HttpProxyError({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED',
        networkRoute: 'VIA_FOREIGN_PROXY',
        attempt: 2,
      });
    });
    const svc = new SitesService(prisma, http);
    const s = await svc.create({
      name: 'Demo',
      baseUrl: 'https://demo.example.com',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      networkRoute: 'VIA_FOREIGN_PROXY',
    });

    const res = await svc.testConnection(s.id);
    expect(res.ok).toBe(false);
    expect(res.routeUsed).toBe('VIA_FOREIGN_PROXY');
    expect(res.error?.code).toBe('ECONNREFUSED');
    expect(prisma.logs[0].status).toBe('failed');
  });

  it('throws NotFound when testing a missing site', async () => {
    const prisma = fakePrisma();
    const svc = new SitesService(prisma, fakeHttp(async () => ({ status: 200 })));
    await expect(svc.testConnection('missing')).rejects.toThrow(NotFoundException);
  });

  it('keeps existing credentials when update omits them', async () => {
    const prisma = fakePrisma();
    const svc = new SitesService(prisma, fakeHttp(async () => ({ status: 200 })));
    const s = await svc.create({
      name: 'Demo',
      baseUrl: 'https://demo.example.com',
      consumerKey: 'ck_keep',
      consumerSecret: 'cs_keep',
      networkRoute: 'DIRECT',
    });
    const before = prisma.sites.get(s.id);
    await svc.update(s.id, { name: 'Renamed' });
    const after = prisma.sites.get(s.id);
    expect(after.consumerKeyEncrypted).toBe(before.consumerKeyEncrypted);
    expect(after.consumerSecretEncrypted).toBe(before.consumerSecretEncrypted);
    expect(after.name).toBe('Renamed');
  });
});
