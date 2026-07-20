import { PrismaService } from '../prisma/prisma.service';

/**
 * Recompute totalOrdersCount and totalSpent from linked Order rows for all
 * customers on a site (or one customer when customerId is provided).
 */
export async function recomputeCustomerStats(
  prisma: PrismaService,
  siteId: string,
  customerId?: string,
): Promise<void> {
  const agg = await prisma.order.groupBy({
    by: ['customerId'],
    where: {
      siteId,
      customerId: customerId ? customerId : { not: null },
    },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  const statsByCustomer = new Map<string, { count: number; spent: string }>();
  for (const row of agg) {
    if (!row.customerId) continue;
    statsByCustomer.set(row.customerId, {
      count: row._count._all,
      spent: row._sum.totalAmount?.toString() ?? '0',
    });
  }

  const customers = await prisma.customer.findMany({
    where: { siteId, ...(customerId ? { id: customerId } : {}) },
    select: { id: true },
  });

  for (const c of customers) {
    const stats = statsByCustomer.get(c.id);
    await prisma.customer.update({
      where: { id: c.id },
      data: {
        totalOrdersCount: stats?.count ?? 0,
        totalSpent: stats?.spent ?? '0',
      },
    });
  }
}
