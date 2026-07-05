import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

function fakePrisma(): PrismaService & {
  store: Record<string, any>;
  inventory: any[];
} {
  const products = new Map<string, any>();
  const logs: any[] = [];
  let id = 0;
  const svc: any = {
    product: {
      findUnique: async ({ where }: any) => products.get(where.id ?? where.skuMaster) ?? null,
      findMany: async () => Array.from(products.values()),
      count: async () => products.size,
      create: async ({ data }: any) => {
        const row = { id: `p${++id}`, ...data, basePrice: data.basePrice, createdAt: new Date(), updatedAt: new Date() };
        products.set(row.id, row);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            logs.push({ id: `l${logs.length + 1}`, productId: row.id, ...log, createdAt: new Date() });
          }
        }
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = products.get(where.id);
        if (!existing) throw new Error('not found');
        const merged = { ...existing, ...data };
        delete merged.inventoryLogs;
        products.set(where.id, merged);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            logs.push({ id: `l${logs.length + 1}`, productId: where.id, ...log, createdAt: new Date() });
          }
        }
        return merged;
      },
      delete: async ({ where }: any) => {
        if (!products.has(where.id)) throw new Error('not found');
        products.delete(where.id);
      },
    },
    inventoryLog: {
      findMany: async () => logs.filter((l) => true),
    },
    $transaction: async (arr: any) => Promise.all(arr),
    store: {} as any,
    inventory: logs,
  };
  return svc as PrismaService & { store: any; inventory: any[] };
}

describe('ProductsService', () => {
  let svc: ProductsService;
  let prisma: ReturnType<typeof fakePrisma>;
  const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ProductsService(prisma);
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
});
