import { describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ImportExportService } from './import-export.service';
import type { ValidatedImportRow } from './import-export.types';

/**
 * Concurrency tests for the import commit path.
 *
 * The BullMQ worker is configured with `concurrency: 1`, so the queue itself
 * serializes jobs. But the service must still be correct if two commits run
 * in parallel (defensive against a double-clicked Confirm, a misconfigured
 * worker pool, or a future concurrency bump). The atomic PREVIEW→PROCESSING
 * claim in commitJob guarantees exactly one winner per job.
 */

function fakePrisma(): any {
  const products = new Map<string, any>();
  const jobs = new Map<string, any>();
  const inventory: any[] = [];
  const skuIndex = new Map<string, string>();
  let pid = 0;
  let jid = 0;
  let logId = 0;
  const svc: any = {
    product: {
      findUnique: async ({ where }: any) => {
        if (where.id) return products.get(where.id) ?? null;
        if (where.skuMaster) {
          const id = skuIndex.get(where.skuMaster);
          return id ? products.get(id) ?? null : null;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        const skus: string[] = where?.skuMaster?.in ?? [];
        if (skus.length) {
          return skus
            .map((s) => skuIndex.get(s))
            .filter((id): id is string => Boolean(id))
            .map((id) => products.get(id))
            .filter(Boolean);
        }
        return Array.from(products.values());
      },
      create: async ({ data }: any) => {
        const row = { id: `p${++pid}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        products.set(row.id, row);
        skuIndex.set(row.skuMaster, row.id);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            inventory.push({ id: `l${++logId}`, productId: row.id, ...log, createdAt: new Date() });
          }
        }
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = products.get(where.id) ?? products.get(skuIndex.get(where.skuMaster ?? '') ?? '');
        if (!existing) throw new Error('not found');
        const merged = { ...existing, ...data };
        delete merged.inventoryLogs;
        products.set(existing.id, merged);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            inventory.push({ id: `l${++logId}`, productId: existing.id, ...log, createdAt: new Date() });
          }
        }
        return merged;
      },
      count: async () => products.size,
    },
    inventoryLog: { findMany: async () => inventory.slice() },
    siteProductMapping: { findMany: async () => [] },
    siteConfig: { findUnique: async () => null },
    importJob: {
      create: async ({ data }: any) => {
        const row = { id: `j${++jid}`, ...data };
        jobs.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }: any) => jobs.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const existing = jobs.get(where.id);
        if (!existing) throw new Error('job not found');
        jobs.set(where.id, { ...existing, ...data });
        return jobs.get(where.id);
      },
      updateMany: async ({ where, data }: any) => {
        const target = jobs.get(where.id);
        if (!target) return { count: 0 };
        if (where.status !== undefined && target.status !== where.status) {
          return { count: 0 };
        }
        jobs.set(where.id, { ...target, ...data });
        return { count: 1 };
      },
      count: async () => jobs.size,
      findMany: async () => Array.from(jobs.values()),
    },
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(svc) : Promise.all(arg)),
    products,
    jobs,
    inventory,
  };
  return svc;
}

const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

async function seedJob(prisma: any, rows: ValidatedImportRow[]): Promise<string> {
  const job = await prisma.importJob.create({
    data: {
      kind: 'PRODUCT_IMPORT',
      status: 'PREVIEW',
      fileName: 'c.xlsx',
      totalRows: rows.length,
      newCount: rows.filter((r) => r.action === 'create').length,
      updateCount: rows.filter((r) => r.action === 'update').length,
      errorCount: 0,
      errors: [],
      rows: rows as any,
      createdByUserId: user.id,
    } as any,
  });
  return job.id;
}

describe('import commit concurrency (atomic PREVIEW→PROCESSING claim)', () => {
  let svc: ImportExportService;
  let prisma: any;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ImportExportService(prisma);
  });

  it('exactly one of N parallel commits for the SAME job wins; the rest get BadRequest', async () => {
    const jobId = await seedJob(prisma, [
      { row: 2, skuMaster: 'C-1', name: 'Contended', totalStock: 1, action: 'create' },
    ]);

    // Fire 8 concurrent commits. The atomic compare-and-set on
    // { id, status: 'PREVIEW' } means only one updateMany returns count=1.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => svc.commitJob(jobId)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    }

    // The winning commit applied the row exactly once — no double inventory log.
    const report = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(report.created).toBe(1);
    expect(prisma.products.size).toBe(1);
    expect(prisma.inventory).toHaveLength(1);
    expect(prisma.jobs.get(jobId).status).toBe('COMPLETED');
  });

  it('parallel commits for DIFFERENT jobs do not corrupt each other', async () => {
    const jobA = await seedJob(prisma, [
      { row: 2, skuMaster: 'A-1', name: 'A1', totalStock: 10, action: 'create' },
      { row: 3, skuMaster: 'A-2', name: 'A2', totalStock: 20, action: 'create' },
    ]);
    const jobB = await seedJob(prisma, [
      { row: 2, skuMaster: 'B-1', name: 'B1', totalStock: 30, action: 'create' },
      { row: 3, skuMaster: 'B-2', name: 'B2', totalStock: 40, action: 'create' },
    ]);

    const [reportA, reportB] = await Promise.all([svc.commitJob(jobA), svc.commitJob(jobB)]);

    expect(reportA.created).toBe(2);
    expect(reportB.created).toBe(2);
    expect(prisma.products.size).toBe(4);
    expect(prisma.inventory).toHaveLength(4); // one IMPORT log per created product

    // Each job reached COMPLETED independently.
    expect(prisma.jobs.get(jobA).status).toBe('COMPLETED');
    expect(prisma.jobs.get(jobB).status).toBe('COMPLETED');

    // No SKU leakage between jobs.
    const skus = new Set(Array.from(prisma.products.values()).map((p: any) => p.skuMaster));
    expect(skus).toEqual(new Set(['A-1', 'A-2', 'B-1', 'B-2']));
  });

  it('a cancelled job cannot be committed (atomic claim rejects status=CANCELLED)', async () => {
    const jobId = await seedJob(prisma, [
      { row: 2, skuMaster: 'X', name: 'X', totalStock: 1, action: 'create' },
    ]);
    await svc.cancelJob(jobId);
    await expect(svc.commitJob(jobId)).rejects.toThrow(BadRequestException);
    expect(prisma.products.size).toBe(0); // nothing applied
  });

  it('a completed job cannot be re-committed (idempotency guard)', async () => {
    const jobId = await seedJob(prisma, [
      { row: 2, skuMaster: 'Y', name: 'Y', totalStock: 1, action: 'create' },
    ]);
    await svc.commitJob(jobId);
    await expect(svc.commitJob(jobId)).rejects.toThrow(BadRequestException);
    // Still exactly one product + one inventory log (no double-application).
    expect(prisma.products.size).toBe(1);
    expect(prisma.inventory).toHaveLength(1);
  });
});
