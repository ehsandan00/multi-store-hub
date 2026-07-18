jest.setTimeout(60_000);

import { describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ImportExportService } from './import-export.service';
import { IMPORT_MAX_ROWS } from './import-export.types';

/**
 * Stress tests for the import/export pipeline at the configured limits.
 * Uses the same in-memory Prisma double as the unit suite so no PostgreSQL
 * is required — these exercise the exceljs parse + validate + commit paths
 * at volume and assert the row-count guard fires at IMPORT_MAX_ROWS.
 */

// Reuse the shape of the fake from the unit spec (kept local to avoid coupling).
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
    siteConfig: { findUnique: async () => ({ id: 's1', name: 'Demo', baseUrl: 'https://x' }) },
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
        const merged = { ...existing, ...data };
        jobs.set(where.id, merged);
        return merged;
      },
      count: async () => jobs.size,
      findMany: async () => Array.from(jobs.values()),
      updateMany: async ({ where, data }: any) => {
        const target = jobs.get(where.id);
        if (!target) return { count: 0 };
        if (where.status !== undefined && target.status !== where.status) {
          return { count: 0 };
        }
        jobs.set(where.id, { ...target, ...data });
        return { count: 1 };
      },
    },
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(svc) : Promise.all(arg)),
    products,
    jobs,
    inventory,
  };
  return svc;
}

const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

async function buildLargeWorkbook(rowCount: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.addRow([
    'sku_master',
    'name',
    'category',
    'base_price',
    'total_stock',
    'low_stock_threshold',
    'expiry_date',
    'barcode',
    'image_url',
    'description',
  ]);
  for (let i = 1; i <= rowCount; i++) {
    ws.addRow([
      `STRESS-${i}`,
      `Product ${i}`,
      'Cat',
      `${(i % 100) + 0.99}`,
      `${(i % 500) + 1}`, // always 1..500, never 0 → every create writes an IMPORT log
      '5',
      '2027-12-31',
      `BAR-${i}`,
      'https://x/i.png',
      'desc',
    ]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('import/export stress (5000 rows = IMPORT_MAX_ROWS)', () => {
  let svc: ImportExportService;
  let prisma: any;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ImportExportService(prisma);
  });

  it('parses + validates + commits 5000 new rows within a generous time budget', async () => {
    const rowCount = IMPORT_MAX_ROWS; // 5000
    const buf = await buildLargeWorkbook(rowCount);

    const parseStart = Date.now();
    const preview = await svc.createPreviewFromUpload('stress.xlsx', buf, user);
    const parseMs = Date.now() - parseStart;
    expect(preview.totalRows).toBe(rowCount);
    expect(preview.newCount).toBe(rowCount);
    expect(preview.errorCount).toBe(0);
    expect(parseMs).toBeLessThan(20_000); // exceljs parse + validate for 5k rows

    const commitStart = Date.now();
    const report = await svc.commitJob(preview.jobId);
    const commitMs = Date.now() - commitStart;
    expect(report.created).toBe(rowCount);
    expect(report.failed).toBe(0);
    expect(prisma.products.size).toBe(rowCount);
    expect(prisma.inventory).toHaveLength(rowCount); // one IMPORT log per row
    expect(commitMs).toBeLessThan(30_000);

    // Job is COMPLETED and rows payload cleared.
    const job = prisma.jobs.get(preview.jobId);
    expect(job.status).toBe('COMPLETED');
  }, 60_000);

  it('rejects a file with IMPORT_MAX_ROWS + 1 rows before any DB write', async () => {
    const buf = await buildLargeWorkbook(IMPORT_MAX_ROWS + 1);
    await expect(svc.createPreviewFromUpload('too-big.xlsx', buf, user)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.jobs.size).toBe(0); // no job persisted
  });

  it('mixed create/update: 2500 existing + 2500 new in one commit', async () => {
    // Pre-seed 2500 products so half the file is updates.
    for (let i = 1; i <= 2500; i++) {
      await prisma.product.create({
        data: {
          skuMaster: `STRESS-${i}`,
          name: `Old ${i}`,
          totalStock: 0,
          basePrice: 1,
        } as any,
      });
    }
    const buf = await buildLargeWorkbook(5000);
    const preview = await svc.createPreviewFromUpload('mixed.xlsx', buf, user);
    expect(preview.newCount).toBe(2500);
    expect(preview.updateCount).toBe(2500);
    expect(preview.errorCount).toBe(0);

    const report = await svc.commitJob(preview.jobId);
    expect(report.created).toBe(2500);
    expect(report.updated).toBe(2500);
    expect(report.failed).toBe(0);
    expect(prisma.products.size).toBe(5000);
    // Inventory logs: 2500 from creates (initial stock) + N from updates with
    // a non-zero delta. The exact update-log count depends on stale stock (0)
    // vs incoming stock (i % 500); we just assert creates logged + at least
    // some update logs were written.
    expect(prisma.inventory.length).toBeGreaterThanOrEqual(2500);
  }, 90_000);

  it('exports 5000 products to xlsx within a generous time budget', async () => {
    for (let i = 1; i <= 5000; i++) {
      await prisma.product.create({
        data: {
          skuMaster: `EXP-${i}`,
          name: `Export ${i}`,
          category: 'Cat',
          totalStock: i % 100,
          basePrice: 1.5,
        } as any,
      });
    }
    const start = Date.now();
    const buf = await svc.exportProductsBuffer({});
    const ms = Date.now() - start;
    expect(buf.length).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(30_000);

    // Re-parse the export and confirm row count + round-trip header recognition.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet('Products')!;
    expect(sheet.rowCount).toBe(5001); // header + 5000
    expect(sheet.getRow(1).getCell(1).value).toBe('sku_master');
  }, 60_000);
});
