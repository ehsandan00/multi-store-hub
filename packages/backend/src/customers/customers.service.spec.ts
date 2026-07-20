import { BadRequestException } from '@nestjs/common';
import { CustomersService } from './customers.service';

function makePrisma(customers: any[]) {
  return {
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    customer: {
      count: jest.fn(async ({ where }: any) =>
        customers.filter((c) => !where?.siteId || c.siteId === where.siteId).length,
      ),
      findMany: jest.fn(async ({ where, skip, take }: any = {}) => {
        let list = [...customers];
        if (where?.siteId) list = list.filter((c) => c.siteId === where.siteId);
        if (where?.OR) {
          const q = where.OR[0].name.contains.toLowerCase();
          list = list.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              (c.email ?? '').toLowerCase().includes(q) ||
              (c.phone ?? '').includes(q),
          );
        }
        return list.slice(skip ?? 0, (skip ?? 0) + (take ?? list.length)).map((c) => ({
          ...c,
          site: c.siteId ? { name: c.siteName } : null,
        }));
      }),
    },
  } as any;
}

describe('CustomersService', () => {
  const rows = [
    {
      id: 'c1',
      name: 'Ali',
      email: 'ali@test.com',
      phone: '09121111111',
      siteId: 's1',
      siteName: 'Shop A',
      remoteCustomerId: 1,
      totalOrdersCount: 2,
      totalSpent: { toString: () => '100.00' },
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'c2',
      name: 'Ali B',
      email: 'ali@test.com',
      phone: null,
      siteId: 's2',
      siteName: 'Shop B',
      remoteCustomerId: 2,
      totalOrdersCount: 0,
      totalSpent: { toString: () => '0' },
      createdAt: new Date('2026-01-02'),
    },
  ];

  it('requires siteId', async () => {
    const svc = new CustomersService(makePrisma(rows));
    await expect(svc.list({ siteId: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists customers for one site with duplicate flag', async () => {
    const svc = new CustomersService(makePrisma(rows));
    const r = await svc.list({ siteId: 's1', page: 1, pageSize: 25 });
    expect(r.data).toHaveLength(1);
    expect(r.data[0].crossSiteDuplicate).toBe(true);
  });

  it('returns cross-site duplicate groups', async () => {
    const svc = new CustomersService(makePrisma(rows));
    const r = await svc.crossSiteDuplicates();
    expect(r.totalGroups).toBe(1);
    expect(r.groups[0].matchType).toBe('email');
  });
});
