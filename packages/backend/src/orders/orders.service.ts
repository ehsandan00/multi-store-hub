import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function dec(v: unknown): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'object' && v !== null && 'toString' in v && typeof (v as { toString: () => string }).toString === 'function') {
    return (v as { toString: () => string }).toString();
  }
  return String(v);
}

function toOrderRow(o: any) {
  return {
    ...o,
    totalAmount: dec(o.totalAmount),
    discountTotal: dec(o.discountTotal),
    shippingTotal: dec(o.shippingTotal),
    items: o.items?.map((it: any) => ({
      ...it,
      unitPrice: dec(it.unitPrice),
    })),
  };
}

/**
 * Read-only access to the aggregated order book (Phase 4).
 *
 * Orders are written by `OrderPullService` (the PULL sync path). This service
 * exposes cross-store list/detail queries with filters by site, status, date
 * range, and free-text search on order number / billing name / billing email.
 * All roles can read orders; writes happen exclusively through the sync flow.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: {
    siteId?: string;
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
    pageSize: number;
  }) {
    const page = q.page;
    const pageSize = Math.min(q.pageSize, 100);
    const where: Prisma.OrderWhereInput = {};
    if (q.siteId) where.siteId = q.siteId;
    if (q.status) where.status = q.status;
    if (q.dateFrom || q.dateTo) {
      where.dateCreated = {};
      if (q.dateFrom) where.dateCreated.gte = new Date(q.dateFrom);
      if (q.dateTo) where.dateCreated.lte = new Date(q.dateTo);
    }
    if (q.search) {
      where.OR = [
        { orderNumber: { contains: q.search, mode: 'insensitive' } },
        { billingName: { contains: q.search, mode: 'insensitive' } },
        { billingEmail: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { dateCreated: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          site: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);
    return {
      data: rows.map(toOrderRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        site: { select: { id: true, name: true, baseUrl: true } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, skuMaster: true, name: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return toOrderRow(order);
  }
}
