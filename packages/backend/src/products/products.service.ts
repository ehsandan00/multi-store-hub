import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MatchStatus, Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateProductDto,
  ExpiryBatchInputDto,
  ListProductsQuery,
  UpdateProductDto,
} from './products.dto';

export interface ProductExpiryBatchRow {
  id: string;
  expiryDate: string;
  quantity: number;
}

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
  basePrice: string;
  expiryDate: string | null;
  expiryBatches: ProductExpiryBatchRow[];
  totalStock: number | null;
  lowStockThreshold: number;
  imageUrl: string | null;
  hasHubPhoto: boolean;
  barcode: string | null;
  productType: ProductType;
  parentId: string | null;
  parentSku: string | null;
  parentName: string | null;
  variationAttributes: Record<string, string> | null;
  catalogKind?: 'HUB' | 'SITE';
  siteId?: string | null;
  siteName?: string | null;
  siteSku?: string | null;
  siteTitle?: string | null;
  siteProductId?: string | null;
  linkStatus?: string | null;
  rowKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HUB_PHOTO_MAX_BYTES = 512 * 1024;
const HUB_PHOTO_DIR = path.join(process.cwd(), 'data', 'hub-photos');
const PRODUCT_INCLUDE = {
  expiryBatches: { orderBy: { expiryDate: 'asc' as const } },
  parent: { select: { id: true, skuMaster: true, name: true } },
} as const;

interface UploadedPhoto {
  buffer?: Buffer;
  path?: string;
  size: number;
  mimetype?: string;
}

export type { UploadedPhoto };

type ProductRecord = {
  hubPhotoPath?: string | null;
};

function parseBatchDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid expiry date: ${value}`);
  }
  return d;
}

function earliestExpiry(batches: { expiryDate: Date }[]): Date | null {
  if (!batches.length) return null;
  return batches.reduce(
    (min, b) => (b.expiryDate < min ? b.expiryDate : min),
    batches[0].expiryDate,
  );
}

function normalizeBatches(
  dto: Pick<CreateProductDto, 'expiryDate' | 'expiryBatches'>,
  defaultQuantity = 0,
): ExpiryBatchInputDto[] {
  if (dto.expiryBatches?.length) {
    return dto.expiryBatches.filter((b) => b.expiryDate?.trim());
  }
  if (dto.expiryDate) {
    return [{ expiryDate: dto.expiryDate, quantity: defaultQuantity }];
  }
  return [];
}

function toRow(p: any): ProductRow {
  const { hubPhotoPath, basePrice, expiryBatches, parent, variationAttributes, ...rest } = p;
  const batches: ProductExpiryBatchRow[] = (expiryBatches ?? []).map((b: any) => ({
    id: b.id,
    expiryDate: b.expiryDate instanceof Date ? b.expiryDate.toISOString() : String(b.expiryDate),
    quantity: b.quantity ?? 0,
  }));
  const attrs =
    variationAttributes && typeof variationAttributes === 'object' && !Array.isArray(variationAttributes)
      ? (variationAttributes as Record<string, string>)
      : null;
  return {
    ...rest,
    basePrice: basePrice?.toString?.() ?? String(basePrice),
    hasHubPhoto: Boolean(hubPhotoPath),
    expiryBatches: batches,
    productType: rest.productType ?? ProductType.SIMPLE,
    parentId: rest.parentId ?? null,
    parentSku: parent?.skuMaster ?? null,
    parentName: parent?.name ?? null,
    variationAttributes: attrs,
    expiryDate:
      rest.expiryDate instanceof Date
        ? rest.expiryDate.toISOString()
        : rest.expiryDate ?? (batches[0]?.expiryDate ?? null),
  };
}

async function resolveParentId(
  prisma: PrismaService,
  productType: ProductType,
  parentId?: string | null,
): Promise<string | null> {
  if (productType !== ProductType.VARIATION) {
    if (parentId) {
      throw new BadRequestException('parentId is only allowed for variation products');
    }
    return null;
  }
  if (!parentId) {
    throw new BadRequestException('parentId is required for variation products');
  }
  const parent = await prisma.product.findUnique({ where: { id: parentId } });
  if (!parent) throw new NotFoundException('Parent product not found');
  if (parent.productType !== ProductType.VARIABLE) {
    throw new BadRequestException('Parent product must have productType VARIABLE');
  }
  return parentId;
}

function normalizeVariationAttributes(
  productType: ProductType,
  attrs?: Record<string, string> | null,
): Record<string, string> | null {
  if (productType !== ProductType.VARIATION) {
    if (attrs && Object.keys(attrs).length > 0) {
      throw new BadRequestException('variationAttributes are only allowed for variation products');
    }
    return null;
  }
  if (!attrs || Object.keys(attrs).length === 0) {
    throw new BadRequestException('variationAttributes are required for variation products');
  }
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const key = k.trim();
    const val = String(v).trim();
    if (key && val) cleaned[key] = val;
  }
  if (!Object.keys(cleaned).length) {
    throw new BadRequestException('variationAttributes are required for variation products');
  }
  return cleaned;
}

function assertCreatePrice(productType: ProductType, basePrice: number): void {
  if (productType !== ProductType.VARIABLE && basePrice <= 0) {
    throw new BadRequestException('basePrice must be greater than 0 for simple and variation products');
  }
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  async list(q: ListProductsQuery): Promise<PaginatedProducts> {
    const view = q.view ?? 'hub';
    if (view === 'site' || view === 'all') {
      return this.listCatalog(q, view);
    }

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
    if (q.productType) {
      where.productType = q.productType;
    }
    if (q.lowStock) {
      const andParts = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...andParts, { lowStockThreshold: { gt: 0 } }];
    }

    if (q.lowStock) {
      const [countRow, idRows] = await Promise.all([
        this.prisma.$queryRaw<{ c: number }[]>`
          SELECT COUNT(*)::int AS c FROM "Product"
          WHERE "lowStockThreshold" > 0 AND "totalStock" <= "lowStockThreshold"
        `,
        this.prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Product"
          WHERE "lowStockThreshold" > 0 AND "totalStock" <= "lowStockThreshold"
          ORDER BY "updatedAt" DESC
          OFFSET ${(page - 1) * pageSize}
          LIMIT ${pageSize}
        `,
      ]);
      const total = countRow[0]?.c ?? 0;
      const ids = idRows.map((r) => r.id);
      if (!ids.length) {
        return { data: [], total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
      }
      const rows = await this.prisma.product.findMany({
        where: { id: { in: ids } },
        include: PRODUCT_INCLUDE,
        orderBy: { updatedAt: 'desc' },
      });
      return {
        data: rows.map(toRow),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map(toRow),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async listCatalog(
    q: ListProductsQuery,
    view: 'site' | 'all',
  ): Promise<PaginatedProducts> {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 200);
    const siteId = q.siteId;

    let siteName: string | undefined;
    if (view === 'site' && siteId) {
      const site = await this.prisma.siteConfig.findUnique({
        where: { id: siteId },
        select: { id: true, name: true },
      });
      if (!site) throw new NotFoundException('Site not found');
      siteName = site.name;
    }

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
    if (q.productType) {
      where.productType = q.productType;
    }

    let hubProducts = await this.prisma.product.findMany({
      where,
      include: {
        expiryBatches: { orderBy: { expiryDate: 'asc' as const } },
        parent: { select: { id: true, skuMaster: true, name: true } },
        ...(view === 'site' && siteId
          ? { siteMappings: { where: { siteId } } }
          : {}),
      },
      orderBy: { skuMaster: 'asc' },
    });

    if (q.lowStock) {
      hubProducts = hubProducts.filter(
        (p) => p.lowStockThreshold > 0 && p.totalStock <= p.lowStockThreshold,
      );
    }

    const hubRows: ProductRow[] = hubProducts.map((p) => {
      const row = toRow(p);
      const mapping =
        view === 'site' && siteId && 'siteMappings' in p
          ? (p as { siteMappings?: Array<{
              siteSku: string | null;
              siteSpecificTitle: string | null;
              siteProductId: string | null;
              matchStatus: MatchStatus;
              lastSyncedAt: Date | null;
            }> }).siteMappings?.[0]
          : undefined;

      let linkStatus: string | undefined;
      if (view === 'site' && siteId) {
        if (!mapping) linkStatus = 'NO_MAPPING';
        else if (mapping.matchStatus === MatchStatus.PENDING_REVIEW) linkStatus = 'PENDING';
        else if (!mapping.siteProductId) linkStatus = 'NOT_SYNCED';
        else linkStatus = 'LINKED';
      }

      return {
        ...row,
        catalogKind: 'HUB' as const,
        rowKey: row.id,
        siteId: view === 'site' ? siteId : null,
        siteName: view === 'site' ? siteName ?? null : null,
        siteSku: mapping?.siteSku ?? null,
        siteTitle: mapping?.siteSpecificTitle ?? null,
        siteProductId: mapping?.siteProductId ?? null,
        linkStatus: linkStatus ?? null,
      };
    });

    const orphans = await this.matching.listSiteOrphans(view === 'site' ? siteId : undefined);
    const searchTerm = q.search?.trim().toLowerCase();
    const siteRows: ProductRow[] = orphans
      .filter((o) => {
        if (!searchTerm) return true;
        const hay = `${o.siteSku ?? ''} ${o.siteTitle} ${o.siteName}`.toLowerCase();
        return hay.includes(searchTerm);
      })
      .map((o) => ({
        id: `site-only:${o.siteId}:${o.siteSku ?? ''}:${o.siteTitle}`,
        skuMaster: o.siteSku ?? o.siteTitle,
        name: o.siteTitle,
        description: null,
        category: null,
        basePrice: '',
        expiryDate: null,
        expiryBatches: [],
        totalStock: o.orderCount ?? null,
        lowStockThreshold: 0,
        imageUrl: null,
        hasHubPhoto: false,
        barcode: null,
        productType: ProductType.SIMPLE,
        parentId: null,
        parentSku: null,
        parentName: null,
        variationAttributes: null,
        catalogKind: 'SITE' as const,
        rowKey: `site-only:${o.siteId}:${o.siteSku ?? ''}:${o.siteTitle}`,
        siteId: o.siteId,
        siteName: o.siteName,
        siteSku: o.siteSku,
        siteTitle: o.siteTitle,
        siteProductId: o.siteProductId,
        linkStatus: 'SITE_ONLY',
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

    const merged = [...hubRows, ...siteRows].sort((a, b) =>
      a.skuMaster.localeCompare(b.skuMaster, undefined, { sensitivity: 'base' }),
    );

    const total = merged.length;
    const skip = (page - 1) * pageSize;
    return {
      data: merged.slice(skip, skip + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async get(id: string): Promise<ProductRow> {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!p) throw new NotFoundException('Product not found');
    return toRow(p);
  }

  async lookupByCode(code: string): Promise<ProductRow | null> {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const p = await this.prisma.product.findFirst({
      where: {
        OR: [{ barcode: trimmed }, { skuMaster: trimmed }],
      },
      include: PRODUCT_INCLUDE,
    });
    return p ? toRow(p) : null;
  }

  async create(dto: CreateProductDto, user: AuthenticatedUser): Promise<ProductRow> {
    const dup = await this.prisma.product.findUnique({ where: { skuMaster: dto.skuMaster } });
    if (dup) throw new ConflictException(`SKU ${dto.skuMaster} already exists`);

    const productType = dto.productType ?? ProductType.SIMPLE;
    assertCreatePrice(productType, dto.basePrice);
    const parentId = await resolveParentId(this.prisma, productType, dto.parentId);
    const variationAttributes = normalizeVariationAttributes(productType, dto.variationAttributes);

    const initialStock =
      productType === ProductType.VARIABLE ? dto.totalStock ?? 0 : dto.totalStock ?? 0;
    const batches = normalizeBatches(dto, initialStock);
    const expiryDate = batches.length
      ? earliestExpiry(batches.map((b) => ({ expiryDate: parseBatchDate(b.expiryDate) })))
      : null;

    const created = await this.prisma.product.create({
      data: {
        skuMaster: dto.skuMaster,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        basePrice: new Prisma.Decimal(dto.basePrice),
        expiryDate,
        totalStock: initialStock,
        lowStockThreshold: dto.lowStockThreshold ?? 0,
        imageUrl: dto.imageUrl,
        barcode: dto.barcode,
        productType,
        parentId,
        variationAttributes: variationAttributes as Prisma.InputJsonValue | undefined,
        expiryBatches:
          batches.length > 0
            ? {
                create: batches.map((b) => ({
                  expiryDate: parseBatchDate(b.expiryDate),
                  quantity: b.quantity ?? 0,
                })),
              }
            : undefined,
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
      } as Prisma.ProductCreateInput,
      include: PRODUCT_INCLUDE,
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

    const nextType = existing.productType;
    if (dto.productType !== undefined && dto.productType !== existing.productType) {
      throw new BadRequestException('productType cannot be changed after creation');
    }

    let parentIdUpdate: string | null | undefined;
    if (dto.parentId !== undefined) {
      parentIdUpdate = await resolveParentId(this.prisma, nextType, dto.parentId);
    }

    let variationAttributesUpdate: Record<string, string> | null | undefined;
    if (dto.variationAttributes !== undefined) {
      variationAttributesUpdate = normalizeVariationAttributes(nextType, dto.variationAttributes);
    }

    if (dto.basePrice !== undefined && nextType !== ProductType.VARIABLE && dto.basePrice <= 0) {
      throw new BadRequestException('basePrice must be greater than 0 for simple and variation products');
    }

    const stockDelta = dto.totalStock !== undefined ? dto.totalStock - existing.totalStock : 0;
    const hasBatchUpdate = dto.expiryBatches !== undefined || dto.expiryDate !== undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (hasBatchUpdate) {
        const batches = normalizeBatches(
          {
            expiryDate: dto.expiryDate,
            expiryBatches: dto.expiryBatches,
          },
          dto.totalStock ?? existing.totalStock,
        );
        await (tx as any).productExpiryBatch.deleteMany({ where: { productId: id } });
        if (batches.length) {
          await (tx as any).productExpiryBatch.createMany({
            data: batches.map((b) => ({
              productId: id,
              expiryDate: parseBatchDate(b.expiryDate),
              quantity: b.quantity ?? 0,
            })),
          });
        }
      }

      const nextExpiry = hasBatchUpdate
        ? await this.computeEarliestExpiry(tx, id)
        : undefined;

      return tx.product.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          category: dto.category,
          basePrice: dto.basePrice !== undefined ? new Prisma.Decimal(dto.basePrice) : undefined,
          expiryDate: hasBatchUpdate ? nextExpiry : undefined,
          totalStock: dto.totalStock,
          lowStockThreshold: dto.lowStockThreshold,
          imageUrl: dto.imageUrl,
          barcode: dto.barcode,
          ...(parentIdUpdate !== undefined ? { parentId: parentIdUpdate } : {}),
          ...(variationAttributesUpdate !== undefined
            ? { variationAttributes: variationAttributesUpdate as Prisma.InputJsonValue | null }
            : {}),
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
        } as Prisma.ProductUpdateInput,
        include: PRODUCT_INCLUDE,
      });
    });

    return toRow(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = (await this.prisma.product.findUnique({ where: { id } })) as ProductRecord | null;
    if (!existing) throw new NotFoundException('Product not found');
    if (existing.hubPhotoPath) {
      await this.deleteHubPhotoFile(existing.hubPhotoPath);
    }
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

  async saveHubPhoto(id: string, file: UploadedPhoto): Promise<ProductRow> {
    const existing = (await this.prisma.product.findUnique({ where: { id } })) as ProductRecord | null;
    if (!existing) throw new NotFoundException('Product not found');
    if (!file?.buffer?.length && !file?.path) throw new BadRequestException('No photo uploaded');
    if (file.size > HUB_PHOTO_MAX_BYTES) {
      throw new BadRequestException(`Photo exceeds ${HUB_PHOTO_MAX_BYTES} bytes`);
    }
    const mime = file.mimetype?.toLowerCase() ?? '';
    if (!mime.startsWith('image/')) {
      throw new BadRequestException('Photo must be an image');
    }

    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const relPath = path.join('hub-photos', `${id}.${ext}`);
    const absPath = path.join(process.cwd(), 'data', relPath);
    await mkdir(HUB_PHOTO_DIR, { recursive: true });
    if (existing.hubPhotoPath && existing.hubPhotoPath !== relPath) {
      await this.deleteHubPhotoFile(existing.hubPhotoPath);
    }
    const bytes = file.buffer?.length
      ? file.buffer
      : file.path
        ? await readFile(file.path)
        : null;
    if (!bytes?.length) throw new BadRequestException('No photo uploaded');
    await writeFile(absPath, bytes);

    const updated = await this.prisma.product.update({
      where: { id },
      data: { hubPhotoPath: relPath } as Prisma.ProductUpdateInput,
      include: PRODUCT_INCLUDE,
    });
    return toRow(updated);
  }

  async getHubPhoto(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const existing = (await this.prisma.product.findUnique({ where: { id } })) as ProductRecord | null;
    if (!existing?.hubPhotoPath) throw new NotFoundException('Hub photo not found');
    const absPath = path.join(process.cwd(), 'data', existing.hubPhotoPath);
    try {
      const buffer = await readFile(absPath);
      const ext = path.extname(existing.hubPhotoPath).toLowerCase();
      const mimeType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { buffer, mimeType };
    } catch {
      throw new NotFoundException('Hub photo file missing');
    }
  }

  async removeHubPhoto(id: string): Promise<ProductRow> {
    const existing = (await this.prisma.product.findUnique({ where: { id } })) as ProductRecord | null;
    if (!existing) throw new NotFoundException('Product not found');
    if (existing.hubPhotoPath) {
      await this.deleteHubPhotoFile(existing.hubPhotoPath);
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { hubPhotoPath: null } as Prisma.ProductUpdateInput,
      include: PRODUCT_INCLUDE,
    });
    return toRow(updated);
  }

  private async computeEarliestExpiry(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<Date | null> {
    const batches = await (tx as any).productExpiryBatch.findMany({
      where: { productId },
      select: { expiryDate: true },
      orderBy: { expiryDate: 'asc' },
    });
    return earliestExpiry(batches);
  }

  private async deleteHubPhotoFile(relPath: string): Promise<void> {
    try {
      await unlink(path.join(process.cwd(), 'data', relPath));
    } catch {
      // File may already be gone.
    }
  }
}
