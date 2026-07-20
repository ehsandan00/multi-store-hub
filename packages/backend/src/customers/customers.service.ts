import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  crossSiteDuplicateCustomerIds,
  findCrossSiteDuplicateGroups,
} from './customer-identity.util';
import type { ListCustomersQuery } from './customers.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListCustomersQuery) {
    if (!q.siteId?.trim()) {
      throw new BadRequestException('siteId is required — customers are listed per site only.');
    }

    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const sortBy = q.sortBy ?? 'totalSpent';
    const sortDir = q.sortDir ?? 'desc';

    const where: Prisma.CustomerWhereInput = { siteId: q.siteId };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const duplicateIds = await this.loadDuplicateCustomerIds();

    const orderBy: Prisma.CustomerOrderByWithRelationInput = { [sortBy]: sortDir };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { site: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        siteId: c.siteId,
        siteName: c.site?.name ?? null,
        remoteCustomerId: c.remoteCustomerId,
        totalOrdersCount: c.totalOrdersCount,
        totalSpent: c.totalSpent.toString(),
        crossSiteDuplicate: duplicateIds.has(c.id),
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async crossSiteDuplicates() {
    const groups = await this.loadDuplicateGroups();
    return { groups, totalGroups: groups.length };
  }

  /** Count of cross-site duplicate groups for dashboard alerts. */
  async countCrossSiteDuplicateGroups(): Promise<number> {
    const groups = await this.loadDuplicateGroups();
    return groups.length;
  }

  private async loadDuplicateGroups() {
    const rows = await this.prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        siteId: true,
        site: { select: { name: true } },
      },
    });

    return findCrossSiteDuplicateGroups(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        siteId: c.siteId,
        siteName: c.site?.name ?? null,
      })),
    );
  }

  private async loadDuplicateCustomerIds(): Promise<Set<string>> {
    const groups = await this.loadDuplicateGroups();
    return crossSiteDuplicateCustomerIds(groups);
  }
}
