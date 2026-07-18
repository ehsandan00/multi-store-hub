import { describe, it, expect, beforeEach } from '@jest/globals';
import { AuditLogService } from './audit-log.service';

function fakePrisma() {
  const logs: any[] = [];
  const users = new Map([['u1', { email: 'admin@hub.local', fullName: 'Admin' }]]);

  return {
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `log${logs.length + 1}`, createdAt: new Date(), ...data };
        logs.push(row);
        return row;
      },
      count: async ({ where }: any) => {
        return logs.filter((l) => {
          if (where?.userId && l.userId !== where.userId) return false;
          if (where?.action?.contains) {
            const needle = where.action.contains.toLowerCase();
            if (!l.action.toLowerCase().includes(needle)) return false;
          }
          return true;
        }).length;
      },
      findMany: async ({ where, skip, take, include }: any) => {
        let list = logs.filter((l) => {
          if (where?.userId && l.userId !== where.userId) return false;
          if (where?.action?.contains) {
            const needle = where.action.contains.toLowerCase();
            if (!l.action.toLowerCase().includes(needle)) return false;
          }
          return true;
        });
        list = list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return list.slice(skip ?? 0, (skip ?? 0) + (take ?? list.length)).map((l) => ({
          ...l,
          user: include?.user ? users.get(l.userId) ?? null : undefined,
        }));
      },
    },
    _logs: logs,
  };
}

describe('AuditLogService', () => {
  let svc: AuditLogService;
  let prisma: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new AuditLogService(prisma as any);
  });

  it('records and lists audit entries', async () => {
    await svc.record({
      userId: 'u1',
      action: 'PRODUCT_UPDATE',
      target: 'PRODUCT:p1',
      details: { method: 'PATCH', path: '/products/p1' },
    });
    await svc.record({ userId: 'u1', action: 'USER_CREATE', target: 'USER:u2' });

    const res = await svc.list({ page: 1, pageSize: 10 });
    expect(res.total).toBe(2);
    const actions = res.data.map((r) => r.action);
    expect(actions).toContain('PRODUCT_UPDATE');
    expect(actions).toContain('USER_CREATE');
    expect(res.data.find((r) => r.action === 'PRODUCT_UPDATE')?.userEmail).toBe('admin@hub.local');
  });

  it('filters by action prefix', async () => {
    await svc.record({ action: 'PRODUCT_CREATE' });
    await svc.record({ action: 'USER_CREATE' });
    const res = await svc.list({ action: 'PRODUCT', page: 1, pageSize: 10 });
    expect(res.total).toBe(1);
    expect(res.data[0].action).toBe('PRODUCT_CREATE');
  });
});
