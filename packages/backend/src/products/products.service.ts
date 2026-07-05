import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateProductDto, ListProductsQuery, UpdateProductDto } from './products.dto';

export interface PaginatedProducts {
  data: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductRow {
  id: string;
  skuMaster: string;
  name: string;
  description: string | null;
  category: string | null;
  basePrice: string; // serialized decimal as string to preserve precision
  expiryDate: string | null;
  totalStock: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  barcode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRow(p: any): ProductRow {
  return {
    ...p,
    basePrice: p.basePrice?.toString?.() ?? String(p.basePrice),
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListProductsQuery): Promise<PaginatedProducts> {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 200);
    const where: Prisma.ProductWhereInput = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { skuMaster: { contains: q.search, mode: 'insensitive' } },
        { barcode: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.category) {
      where.category = { equals: q.category, mode: 'insensitive' };
    }
    if (q.lowStock) {
      // totalStock <= lowStockThreshold (and threshold > 0 so 0/0 isn't always "low")
      where.AND = [{ lowStockThreshold: { gt: 0 } }];
      // Prisma can't express totalStock <= lowStockThreshold directly; fetch and filter:
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    let filtered = rows;
    if (q.lowStock) {
      filtered = rows.filter((r) => r.totalStock <= r.lowStockThreshold);
    }

    return {
      data: filtered.map(toRow),
      total: q.lowStock ? filtered.length : total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil((q.lowStock ? filtered.length : total) / pageSize)),
    };
  }

  async get(id: string): Promise<ProductRow> {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    return toRow(p);
  }

  async create(dto: CreateProductDto, user: AuthenticatedUser): Promise<ProductRow> {
    const dup = await this.prisma.product.findUnique({ where: { skuMaster: dto.skuMaster } });
    if (dup) throw new ConflictException(`SKU ${dto.skuMaster} already exists`);

    const initialStock = dto.totalStock ?? 0;
    const created = await this.prisma.product.create({
      data: {
        skuMaster: dto.skuMaster,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        basePrice: new Prisma.Decimal(dto.basePrice),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        totalStock: initialStock,
        lowStockThreshold: dto.lowStockThreshold ?? 0,
        imageUrl: dto.imageUrl,
        barcode: dto.barcode,
        inventoryLogs:
          initialStock > 0
            ? {
                create: [
                  {
                    changeAmount: initialStock,
                    reason: 'IMPORT',
                    createdByUserId: user.id,
                  },
                ],
              }
            : undefined,
      },
    });
    return toRow(created);
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    user: AuthenticatedUser,
  ): Promise<ProductRow> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');

    const stockDelta = dto.totalStock !== undefined ? dto.totalStock - existing.totalStock : 0;

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        basePrice: dto.basePrice !== undefined ? new Prisma.Decimal(dto.basePrice) : undefined,
        expiryDate:
          dto.expiryDate === null
            ? null
            : dto.expiryDate
              ? new Date(dto.expiryDate)
              : undefined,
        totalStock: dto.totalStock,
        lowStockThreshold: dto.lowStockThreshold,
        imageUrl: dto.imageUrl,
        barcode: dto.barcode,
        inventoryLogs:
          stockDelta !== 0
            ? {
                create: [
                  {
                    changeAmount: stockDelta,
                    reason: 'MANUAL_ADJUSTMENT',
                    createdByUserId: user.id,
                  },
                ],
              }
            : undefined,
      },
    });
    return toRow(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    await this.prisma.product.delete({ where: { id } });
  }

  async inventoryHistory(id: string): Promise<any[]> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    return this.prisma.inventoryLog.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async categories(): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    });
    return rows.map((r) => r.category!).filter(Boolean);
  }
}
