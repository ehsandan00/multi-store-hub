import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateLogisticsOrderDto,
  ListLogisticsOrdersQuery,
  LogisticsStatus,
} from './logistics-orders.dto';

const LOGISTICS_INCLUDE = {
  createdBy: { select: { id: true, fullName: true, email: true } },
  employee: { select: { id: true, fullName: true, email: true, role: true } },
  items: {
    include: {
      product: {
        select: { id: true, name: true, skuMaster: true, barcode: true },
      },
    },
    orderBy: { productName: 'asc' as const },
  },
} satisfies Prisma.LogisticsOrderInclude;

function toRow(order: any) {
  return {
    ...order,
    itemCount: order.items?.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0,
    ) ?? 0,
  };
}

function makeOrderNumber(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `LG-${date}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

@Injectable()
export class LogisticsOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  listEmployees() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async list(q: ListLogisticsOrdersQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const where: Prisma.LogisticsOrderWhereInput = {};

    if (q.status) where.status = q.status;
    if (q.search?.trim()) {
      const search = q.search.trim();
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { receiverName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { employee: { fullName: { contains: search, mode: 'insensitive' } } },
        { employee: { email: { contains: search, mode: 'insensitive' } } },
        { items: { some: { productName: { contains: search, mode: 'insensitive' } } } },
        { items: { some: { skuMaster: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.logisticsOrder.count({ where }),
      this.prisma.logisticsOrder.findMany({
        where,
        include: LOGISTICS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map(toRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async create(dto: CreateLogisticsOrderDto, user: AuthenticatedUser) {
    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }

    return this.prisma.$transaction(async (tx) => {
      const productIds = [...quantities.keys()];
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, skuMaster: true },
      });
      if (products.length !== productIds.length) {
        throw new BadRequestException('One or more selected products do not exist');
      }
      const employee = await tx.user.findFirst({
        where: { id: dto.employeeId, isActive: true },
        select: { id: true },
      });
      if (!employee) {
        throw new BadRequestException('Selected employee does not exist or is inactive');
      }

      const productById = new Map(products.map((product) => [product.id, product]));
      const created = await tx.logisticsOrder.create({
        data: {
          orderNumber: makeOrderNumber(),
          receiverName: dto.receiverName.trim(),
          phone: dto.phone.trim(),
          city: dto.city.trim(),
          status: dto.status,
          createdByUserId: user.id,
          employeeId: employee.id,
          items: {
            create: productIds.map((productId) => {
              const product = productById.get(productId)!;
              return {
                productId,
                quantity: quantities.get(productId)!,
                productName: product.name,
                skuMaster: product.skuMaster,
              };
            }),
          },
        },
        include: LOGISTICS_INCLUDE,
      });
      return toRow(created);
    });
  }

  async updateStatus(id: string, status: LogisticsStatus) {
    const existing = await this.prisma.logisticsOrder.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Logistics order not found');

    const updated = await this.prisma.logisticsOrder.update({
      where: { id },
      data: { status },
      include: LOGISTICS_INCLUDE,
    });
    return toRow(updated);
  }
}
