import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { ProductsService } from './products.service';

function fakePrisma(): PrismaService & {
  store: Record<string, any>;
  inventory: any[];
} {
  const products = new Map<string, any>();
  const logsArr: any[] = [];
  let id = 0;
  const svc: any = {
    product: {
      findUnique: async ({ where }: any) => products.get(where.id ?? where.skuMaster) ?? null,
      findFirst: async ({ where }: any) => {
        for (const p of products.values()) {
          if (where.OR) {
            for (const clause of where.OR) {
              if (clause.barcode && p.barcode === clause.barcode) {
                return { ...p, expiryBatches: p.expiryBatches ?? [] };
              }
              if (clause.skuMaster && p.skuMaster === clause.skuMaster) {
                return { ...p, expiryBatches: p.expiryBatches ?? [] };
              }
            }
          }
        }
        return null;
      },
      findMany: async (args?: any) => {
        let list = Array.from(products.values()).map((p) => ({
          ...p,
          expiryBatches: p.expiryBatches ?? [],
        }));
        const where = args?.where;
        if (where?.id?.in) {
          list = list.filter((p) => where.id.in.includes(p.id));
        }
        if (where?.productType) {
          list = list.filter((p) => p.productType === where.productType);
        }
        if (where?.OR) {
          const term = where.OR[0]?.name?.contains?.toLowerCase?.();
          if (term) {
            list = list.filter(
              (p) =>
                p.name.toLowerCase().includes(term) ||
                p.skuMaster.toLowerCase().includes(term),
            );
          }
        }
        if (args?.orderBy?.updatedAt === 'desc') {
          list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        }
        const skip = args?.skip ?? 0;
        const take = args?.take ?? list.length;
        return list.slice(skip, skip + take);
      },
      count: async () => products.size,
      create: async ({ data, include }: any) => {
        const batchData = data.expiryBatches?.create ?? [];
        const logs = data.inventoryLogs?.create ?? [];
        const clean = { ...data };
        delete clean.expiryBatches;
        delete clean.inventoryLogs;
        const row = {
          id: `p${++id}`,
          ...clean,
          expiryBatches: batchData.map((b: any, i: number) => ({
            id: `eb${i + 1}`,
            productId: `p${id}`,
            ...b,
          })),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        row.expiryBatches.forEach((b: any) => {
          b.productId = row.id;
        });
        products.set(row.id, row);
        for (const log of logs) {
          logsArr.push({ id: `l${logsArr.length + 1}`, productId: row.id, ...log, createdAt: new Date() });
        }
        return row;
      },
      update: async ({ where, data, include }: any) => {
        const existing = products.get(where.id);
        if (!existing) throw new Error('not found');
        const merged = { ...existing, ...data };
        delete merged.inventoryLogs;
        products.set(where.id, merged);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            logsArr.push({ id: `l${logsArr.length + 1}`, productId: where.id, ...log, createdAt: new Date() });
          }
        }
        return merged;
      },
      delete: async ({ where }: any) => {
        if (!products.has(where.id)) throw new Error('not found');
        products.delete(where.id);
      },
    },
    productExpiryBatch: {
      deleteMany: async ({ where }: any) => {
        const p = products.get(where.productId);
        if (p) p.expiryBatches = [];
        return { count: 0 };
      },
      createMany: async ({ data }: any) => {
        for (const row of data) {
          const p = products.get(row.productId);
          if (p) {
            p.expiryBatches = p.expiryBatches ?? [];
            p.expiryBatches.push({ id: `eb${p.expiryBatches.length + 1}`, ...row });
          }
        }
        return { count: data.length };
      },
      create: async ({ data }: any) => ({ id: `eb${Date.now()}`, ...data }),
      findMany: async ({ where }: any) => {
        const p = products.get(where.productId);
        return p?.expiryBatches ?? [];
      },
    },
    inventoryLog: {
      findMany: async () => logsArr.filter(() => true),
    },
    $transaction: async (fn: any) => {
      if (typeof fn === 'function') return fn(svc);
      return Promise.all(fn);
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      const lowList = Array.from(products.values()).filter(
        (p) => p.lowStockThreshold > 0 && p.totalStock <= p.lowStockThreshold,
      );
      if (sql.includes('COUNT(*)')) {
        return [{ c: lowList.length }];
      }
      if (sql.includes('SELECT id')) {
        return lowList.map((p) => ({ id: p.id }));
      }
      return [];
    },
    store: {} as any,
    inventory: logsArr,
  };
  return svc as PrismaService & { store: any; inventory: any[] };
}

describe('ProductsService', () => {
  let svc: ProductsService;
  let prisma: ReturnType<typeof fakePrisma>;
  const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ProductsService(prisma, {
      listSiteOrphans: async () => [],
    } as unknown as MatchingService);
  });

  it('creates a product and writes an IMPORT inventory log for initial stock', async () => {
    const p = await svc.create(
      {
        skuMaster: 'SKU-1',
        name: 'Test',
        basePrice: 10,
        totalStock: 100,
        lowStockThreshold: 5,
      },
      user,
    );
    expect(p.skuMaster).toBe('SKU-1');
    expect(prisma.inventory).toHaveLength(1);
    expect(prisma.inventory[0].reason).toBe('IMPORT');
    expect(prisma.inventory[0].changeAmount).toBe(100);
  });

  it('rejects duplicate skuMaster', async () => {
    await svc.create({ skuMaster: 'SKU-1', name: 'A', basePrice: 1 }, user);
    // simulate existing:
    (prisma.product.findUnique as any) = async () => ({ id: 'p0', skuMaster: 'SKU-1' });
    await expect(svc.create({ skuMaster: 'SKU-1', name: 'B', basePrice: 1 }, user)).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws NotFound when updating a missing product', async () => {
    await expect(svc.update('missing', { name: 'x' }, user)).rejects.toThrow(NotFoundException);
  });

  it('writes a MANUAL_ADJUSTMENT log when totalStock changes', async () => {
    const p = await svc.create({ skuMaster: 'SKU-2', name: 'A', basePrice: 1, totalStock: 10 }, user);
    prisma.inventory.length = 0;
    await svc.update(p.id, { totalStock: 7 }, user);
    expect(prisma.inventory).toHaveLength(1);
    expect(prisma.inventory[0].reason).toBe('MANUAL_ADJUSTMENT');
    expect(prisma.inventory[0].changeAmount).toBe(-3);
  });

  it('does NOT write an inventory log when totalStock is unchanged', async () => {
    const p = await svc.create({ skuMaster: 'SKU-3', name: 'A', basePrice: 1 }, user);
    prisma.inventory.length = 0;
    await svc.update(p.id, { name: 'New name' }, user);
    expect(prisma.inventory).toHaveLength(0);
  });

  it('lowStock filter returns only products with stock ≤ threshold', async () => {
    await svc.create({ skuMaster: 'L1', name: 'low', basePrice: 1, totalStock: 3, lowStockThreshold: 5 }, user);
    await svc.create({ skuMaster: 'L2', name: 'ok', basePrice: 1, totalStock: 50, lowStockThreshold: 5 }, user);
    const res = await svc.list({ lowStock: true, page: 1, pageSize: 25 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].skuMaster).toBe('L1');
  });

  it('creates multiple expiry batches and sets earliest on product', async () => {
    const p = await svc.create(
      {
        skuMaster: 'EXP-1',
        name: 'Batchy',
        basePrice: 5,
        expiryBatches: [
          { expiryDate: '2026-12-01', quantity: 10 },
          { expiryDate: '2026-08-01', quantity: 5 },
        ],
      },
      user,
    );
    expect(p.expiryBatches).toHaveLength(2);
    expect(p.expiryDate).toMatch(/^2026-08-01/);
  });

  it('lookup finds product by barcode or sku', async () => {
    await svc.create(
      { skuMaster: 'SKU-BC', name: 'Scannable', basePrice: 1, barcode: '1234567890' },
      user,
    );
    const byBarcode = await svc.lookupByCode('1234567890');
    expect(byBarcode?.skuMaster).toBe('SKU-BC');
    const bySku = await svc.lookupByCode('SKU-BC');
    expect(bySku?.barcode).toBe('1234567890');
  });

  it('creates a variable parent with zero price', async () => {
    const p = await svc.create(
      {
        skuMaster: 'VAR-1',
        name: 'T-Shirt',
        basePrice: 0,
        productType: 'VARIABLE',
      },
      user,
    );
    expect(p.productType).toBe('VARIABLE');
    expect(p.basePrice).toBe('0');
  });

  it('creates a variation linked to a variable parent', async () => {
    const parent = await svc.create(
      {
        skuMaster: 'VAR-2',
        name: 'Shoe',
        basePrice: 0,
        productType: 'VARIABLE',
      },
      user,
    );
    const child = await svc.create(
      {
        skuMaster: 'VAR-2-42',
        name: 'Shoe 42',
        basePrice: 89,
        productType: 'VARIATION',
        parentId: parent.id,
        variationAttributes: { Size: '42' },
        totalStock: 5,
      },
      user,
    );
    expect(child.productType).toBe('VARIATION');
    expect(child.parentId).toBe(parent.id);
    expect(child.variationAttributes).toEqual({ Size: '42' });
  });

  it('rejects variation without parent', async () => {
    await expect(
      svc.create(
        {
          skuMaster: 'VAR-BAD',
          name: 'Orphan',
          basePrice: 10,
          productType: 'VARIATION',
          variationAttributes: { Color: 'Red' },
        },
        user,
      ),
    ).rejects.toThrow('parentId is required');
  });

  it('filters list by productType', async () => {
    await svc.create({ skuMaster: 'S1', name: 'Simple', basePrice: 1 }, user);
    await svc.create(
      { skuMaster: 'V1', name: 'Variable', basePrice: 0, productType: 'VARIABLE' },
      user,
    );
    const res = await svc.list({ productType: 'VARIABLE', page: 1, pageSize: 25 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].skuMaster).toBe('V1');
  });
});
