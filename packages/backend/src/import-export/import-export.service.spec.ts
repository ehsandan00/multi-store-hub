import { describe, it, expect, beforeEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ImportExportService,
  parseDate,
  parseDecimal,
  parseNonNegInt,
} from './import-export.service';
import type { RawImportRow, ValidatedImportRow } from './import-export.types';

/**
 * Minimal in-memory Prisma double that covers the surface area used by the
 * import/export service: products (with sku lookup), inventoryLog, importJob,
 * siteProductMapping, siteConfig. Mirrors the style of products.service.spec.
 */
function fakePrisma(): PrismaService & {
  products: Map<string, any>;
  jobs: Map<string, any>;
  inventory: any[];
} {
  const products = new Map<string, any>(); // keyed by id
  const jobs = new Map<string, any>();
  const inventory: any[] = [];
  const skuIndex = new Map<string, string>(); // skuMaster -> id
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
        const row = {
          id: `p${++pid}`,
          ...data,
          basePrice: data.basePrice,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        products.set(row.id, row);
        skuIndex.set(row.skuMaster, row.id);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            inventory.push({
              id: `l${++logId}`,
              productId: row.id,
              ...log,
              createdAt: new Date(),
            });
          }
        }
        return row;
      },
      update: async ({ where, data }: any) => {
        let existing =
          products.get(where.id) ??
          (where.skuMaster ? products.get(skuIndex.get(where.skuMaster) ?? '') : undefined);
        if (!existing) throw new Error('not found');
        const merged = { ...existing, ...data };
        delete merged.inventoryLogs;
        products.set(existing.id, merged);
        if (data.inventoryLogs?.create) {
          for (const log of data.inventoryLogs.create) {
            inventory.push({
              id: `l${++logId}`,
              productId: existing.id,
              ...log,
              createdAt: new Date(),
            });
          }
        }
        return merged;
      },
      count: async () => products.size,
    },
    inventoryLog: { findMany: async () => inventory.slice() },
    siteProductMapping: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.productId?.in ?? [];
        return ids.map((id) => products.get(id)).filter(Boolean);
      },
    },
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
        // Compare-and-set: only update if id matches AND status matches the
        // expected PREVIEW. Returns { count } so the service can detect a
        // lost race without a separate read.
        const target = jobs.get(where.id);
        if (!target) return { count: 0 };
        if (where.status !== undefined && target.status !== where.status) {
          return { count: 0 };
        }
        const merged = { ...target, ...data };
        jobs.set(where.id, merged);
        return { count: 1 };
      },
    },
    $transaction: async (arg: any) => {
      // Support both forms: array of operations (Promise.all) and interactive
      // callback `async (tx) => ...` (used by applyRow's update path so the
      // read-modify-write is atomic).
      if (typeof arg === 'function') {
        return arg(svc);
      }
      return Promise.all(arg);
    },
    products,
    jobs,
    inventory,
  };
  return svc as PrismaService & {
    products: Map<string, any>;
    jobs: Map<string, any>;
    inventory: any[];
  };
}

const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' as const };

describe('import/export pure parsers', () => {
  it('parseDecimal accepts numbers and numeric strings, rejects negatives/non-numeric', () => {
    expect(parseDecimal(12.5)).toBe(12.5);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('12.555')).toBe(12.56); // 2dp rounding
    expect(parseDecimal('')).toBe(null);
    expect(parseDecimal('abc')).toBe(null);
    expect(parseDecimal(-1)).toBe(null);
  });

  it('parseNonNegInt rejects non-integers and negatives', () => {
    expect(parseNonNegInt(5)).toBe(5);
    expect(parseNonNegInt('5')).toBe(5);
    expect(parseNonNegInt('5.5')).toBe(null);
    expect(parseNonNegInt(-3)).toBe(null);
    expect(parseNonNegInt('')).toBe(null);
  });

  it('parseDate returns ISO for valid dates, null for garbage', () => {
    expect(parseDate('2026-12-31')).toMatch(/^2026-12-31/);
    expect(parseDate('')).toBe(null);
    expect(parseDate('not-a-date')).toBe(null);
  });
});

describe('ImportExportService.validateRows (sku_master matching)', () => {
  let svc: ImportExportService;
  let prisma: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ImportExportService(prisma);
  });

  it('classifies a row as "create" when sku is unknown', () => {
    const { valid, errors } = svc.validateRows(
      [{ row: 2, skuMaster: 'NEW-1', name: 'New product', basePrice: '10' }],
      new Map(),
    );
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].action).toBe('create');
    expect(valid[0].basePrice).toBe(10);
  });

  it('classifies a row as "update" when sku exists, and name is not required', () => {
    const existing = new Map([['SKU-1', 'p1']]);
    const { valid, errors } = svc.validateRows(
      [{ row: 2, skuMaster: 'SKU-1', totalStock: '50' }],
      existing,
    );
    expect(errors).toHaveLength(0);
    expect(valid[0].action).toBe('update');
    expect(valid[0].productId).toBe('p1');
    expect(valid[0].totalStock).toBe(50);
  });

  it('errors when creating without a name', () => {
    const { valid, errors } = svc.validateRows(
      [{ row: 2, skuMaster: 'NEW-X' }],
      new Map(),
    );
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/name is required/);
  });

  it('errors on duplicate sku within the same file', () => {
    const { errors } = svc.validateRows(
      [
        { row: 2, skuMaster: 'DUP', name: 'A' },
        { row: 3, skuMaster: 'DUP', name: 'B' },
      ],
      new Map(),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].message).toMatch(/Duplicate/);
  });

  it('errors on invalid base_price / total_stock / expiry_date', () => {
    const { errors } = svc.validateRows(
      [
        { row: 2, skuMaster: 'A', name: 'A', basePrice: 'cheap' },
        { row: 3, skuMaster: 'B', name: 'B', totalStock: '-5' },
        { row: 4, skuMaster: 'C', name: 'C', expiryDate: 'never' },
      ],
      new Map(),
    );
    expect(errors).toHaveLength(3);
    expect(errors[0].message).toMatch(/base_price/);
    expect(errors[1].message).toMatch(/total_stock/);
    expect(errors[2].message).toMatch(/expiry_date/);
  });

  it('collects site: prefixed columns into siteSkus', () => {
    const raw: RawImportRow[] = [
      {
        row: 2,
        skuMaster: 'S1',
        name: 'A',
        siteSkus: { 'Store IR': 'IR-S1', 'Store Foreign': 'FX-S1' },
      },
    ];
    const { valid } = svc.validateRows(raw, new Map());
    expect(valid[0].siteSkus).toEqual({ 'Store IR': 'IR-S1', 'Store Foreign': 'FX-S1' });
  });

  it('matching is by sku_master, not row position (reordering is safe)', () => {
    const existing = new Map([['SKU-A', 'pA']]);
    const { valid } = svc.validateRows(
      [
        { row: 99, skuMaster: 'SKU-A', totalStock: '1' },
        { row: 100, skuMaster: 'SKU-B', name: 'New' },
      ],
      existing,
    );
    const bySku = new Map(valid.map((v) => [v.skuMaster, v]));
    expect(bySku.get('SKU-A')?.action).toBe('update');
    expect(bySku.get('SKU-B')?.action).toBe('create');
  });

  it('recognizes the exact underscore headers emitted by exportProductsBuffer (round-trip safety)', () => {
    // These are the column keys the export writes (sku_master, base_price,
    // total_stock, low_stock_threshold, expiry_date, image_url). The parser
    // must recognize all of them so export → re-import is lossless.
    const raw: RawImportRow[] = [
      {
        row: 2,
        skuMaster: 'RT-1',
        name: 'Round trip',
        basePrice: '7.25',
        totalStock: '50',
        lowStockThreshold: '5',
        expiryDate: '2027-01-01',
        imageUrl: 'https://x/img.png',
      },
    ];
    const { valid, errors } = svc.validateRows(raw, new Map());
    expect(errors).toHaveLength(0);
    expect(valid[0].basePrice).toBe(7.25);
    expect(valid[0].totalStock).toBe(50);
    expect(valid[0].lowStockThreshold).toBe(5);
    expect(valid[0].expiryDate).toMatch(/^2027-01-01/);
    expect(valid[0].imageUrl).toBe('https://x/img.png');
  });
});

describe('ImportExportService.commitJob (apply changes via BullMQ-free path)', () => {
  let svc: ImportExportService;
  let prisma: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ImportExportService(prisma);
  });

  async function seedJob(rows: ValidatedImportRow[]): Promise<string> {
    const job = await prisma.importJob.create({
      data: {
        kind: 'PRODUCT_IMPORT',
        status: 'PREVIEW',
        fileName: 'test.xlsx',
        totalRows: rows.length,
        newCount: rows.filter((r) => r.action === 'create').length,
        updateCount: rows.filter((r) => r.action === 'update').length,
        errorCount: 0,
        errors: [],
        rows: rows as any,
        createdByUserId: user.id,
      },
    } as any);
    return job.id;
  }

  it('creates new products and writes IMPORT inventory logs for initial stock', async () => {
    const jobId = await seedJob([
      {
        row: 2,
        skuMaster: 'NEW-1',
        name: 'New 1',
        basePrice: 10,
        totalStock: 100,
        action: 'create',
      },
    ]);
    const report = await svc.commitJob(jobId);
    expect(report.created).toBe(1);
    expect(report.updated).toBe(0);
    expect(prisma.products.size).toBe(1);
    expect(prisma.inventory).toHaveLength(1);
    expect(prisma.inventory[0].reason).toBe('IMPORT');
    expect(prisma.inventory[0].changeAmount).toBe(100);
    const job = prisma.jobs.get(jobId);
    expect(job.status).toBe('COMPLETED');
    // rows payload is cleared after commit (Prisma.JsonNull → fake stores falsy/empty)
    expect(Array.isArray(job.rows) ? job.rows.length : 0).toBe(0);
  });

  it('updates existing products and writes IMPORT logs only for stock delta', async () => {
    // Seed an existing product directly in the fake.
    const existing = await prisma.product.create({
      data: { skuMaster: 'EX-1', name: 'Old', totalStock: 50, basePrice: 5 } as any,
    });
    const jobId = await seedJob([
      {
        row: 2,
        skuMaster: 'EX-1',
        name: 'Updated name',
        totalStock: 40, // delta = -10
        productId: existing.id,
        action: 'update',
      },
    ]);
    const report = await svc.commitJob(jobId);
    expect(report.updated).toBe(1);
    expect(prisma.inventory).toHaveLength(1);
    expect(prisma.inventory[0].changeAmount).toBe(-10);
    const updated = prisma.products.get(existing.id);
    expect(updated.name).toBe('Updated name');
    expect(updated.totalStock).toBe(40);
  });

  it('does NOT write an inventory log when totalStock is unchanged on update', async () => {
    const existing = await prisma.product.create({
      data: { skuMaster: 'EX-2', name: 'Old', totalStock: 50, basePrice: 5 } as any,
    });
    const jobId = await seedJob([
      {
        row: 2,
        skuMaster: 'EX-2',
        name: 'Renamed only',
        productId: existing.id,
        action: 'update',
      },
    ]);
    await svc.commitJob(jobId);
    expect(prisma.inventory).toHaveLength(0);
  });

  it('records per-row failures in the report without aborting the whole import', async () => {
    // Force one row to fail by pointing its productId at a missing record and
    // overriding findUnique to return null for that id.
    const badRow: ValidatedImportRow = {
      row: 2,
      skuMaster: 'GONE',
      name: 'Ghost',
      totalStock: 5,
      productId: 'ghost-id',
      action: 'update',
    };
    const goodRow: ValidatedImportRow = {
      row: 3,
      skuMaster: 'OK',
      name: 'Good',
      totalStock: 5,
      action: 'create',
    };
    const jobId = await seedJob([badRow, goodRow]);
    (prisma.product.findUnique as any) = async ({ where }: any) => {
      if (where.id === 'ghost-id') return null;
      if (where.skuMaster === 'GONE') return null;
      if (where.id) return prisma.products.get(where.id) ?? null;
      return null;
    };
    const report = await svc.commitJob(jobId);
    expect(report.failed).toBe(1);
    expect(report.created).toBe(1);
    expect(report.errors[0].sku).toBe('GONE');
  });

  it('rejects commit when job is not in PREVIEW status', async () => {
    const jobId = await seedJob([]);
    await prisma.importJob.update({ where: { id: jobId }, data: { status: 'COMPLETED' } as any });
    await expect(svc.commitJob(jobId)).rejects.toThrow(BadRequestException);
  });

  it('cancelJob only works on PREVIEW jobs', async () => {
    const jobId = await seedJob([]);
    await svc.cancelJob(jobId);
    expect(prisma.jobs.get(jobId).status).toBe('CANCELLED');
    await expect(svc.cancelJob(jobId)).rejects.toThrow(BadRequestException);
  });

  it('getPreview throws NotFound for missing jobs', async () => {
    await expect(svc.getPreview('missing')).rejects.toThrow(NotFoundException);
  });

  it('markCompleted retries the final status update on transient failure and still returns the report', async () => {
    const jobId = await seedJob([
      { row: 2, skuMaster: 'OK', name: 'Good', totalStock: 5, action: 'create' },
    ]);
    // Make the COMPLETED status update fail twice, then succeed on the 3rd try.
    const originalUpdate = prisma.importJob.update;
    let completedAttempts = 0;
    (prisma.importJob.update as any) = async ({ where, data }: any) => {
      if (data.status === 'COMPLETED') {
        completedAttempts += 1;
        if (completedAttempts < 3) throw new Error('Transient DB blip');
      }
      return originalUpdate.call(prisma.importJob, { where, data });
    };
    const report = await svc.commitJob(jobId);
    expect(report.created).toBe(1);
    expect(completedAttempts).toBe(3); // retried until it succeeded
    expect(prisma.jobs.get(jobId).status).toBe('COMPLETED');
    (prisma.importJob.update as any) = originalUpdate;
  });

  it('markCompleted leaves the job in PROCESSING (data applied) if all retries exhaust, but still returns the report', async () => {
    const jobId = await seedJob([
      { row: 2, skuMaster: 'OK', name: 'Good', totalStock: 5, action: 'create' },
    ]);
    const originalUpdate = prisma.importJob.update;
    (prisma.importJob.update as any) = async ({ where, data }: any) => {
      if (data.status === 'COMPLETED') throw new Error('DB down');
      return originalUpdate.call(prisma.importJob, { where, data });
    };
    // The commit itself does NOT throw — the report is returned and the data
    // is applied; only the status update is stuck.
    const report = await svc.commitJob(jobId);
    expect(report.created).toBe(1);
    expect(prisma.products.size).toBe(1); // data was applied
    expect(prisma.jobs.get(jobId).status).toBe('PROCESSING'); // status stale
    (prisma.importJob.update as any) = originalUpdate;
  });

  it('update path uses a transaction so the read-modify-write is atomic', async () => {
    // Seed an existing product, then commit an update. The fake $transaction
    // callback form hands the same svc back as `tx`, so findUnique/update on tx
    // route through the same in-memory store. We assert the inventory log is
    // written with the correct delta and the product is updated.
    const existing = await prisma.product.create({
      data: { skuMaster: 'TX-1', name: 'Old', totalStock: 100, basePrice: 5 } as any,
    });
    const jobId = await seedJob([
      {
        row: 2,
        skuMaster: 'TX-1',
        name: 'New name',
        totalStock: 80, // delta = -20
        productId: existing.id,
        action: 'update',
      },
    ]);
    const report = await svc.commitJob(jobId);
    expect(report.updated).toBe(1);
    const updated = prisma.products.get(existing.id);
    expect(updated.totalStock).toBe(80);
    expect(updated.name).toBe('New name');
    expect(prisma.inventory).toHaveLength(1);
    expect(prisma.inventory[0].changeAmount).toBe(-20);
  });
});

describe('ImportExportService.createPreviewFromUpload (end-to-end via fake prisma)', () => {
  let svc: ImportExportService;
  let prisma: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new ImportExportService(prisma);
  });

  it('parseWorkbook recognizes the exact underscore headers the export emits (round-trip)', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    // Exact headers produced by exportProductsBuffer:
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
    ws.addRow(['RT-1', 'Round trip', 'Cat', '7.25', '50', '5', '2027-01-01', 'BAR1', 'https://x/i.png', 'desc']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const raw = await svc.parseWorkbook(buf);
    expect(raw).toHaveLength(1);
    expect(raw[0].skuMaster).toBe('RT-1');
    expect(raw[0].basePrice).toBe('7.25');
    expect(raw[0].totalStock).toBe('50');
    expect(raw[0].lowStockThreshold).toBe('5');
    expect(raw[0].expiryDate).toMatch(/^2027-01-01/);
    expect(raw[0].barcode).toBe('BAR1');
    expect(raw[0].imageUrl).toBe('https://x/i.png');
    expect(raw[0].description).toBe('desc');
  });

  it('persists a PREVIEW job with new/update counts keyed by sku_master', async () => {
    // Pre-seed one existing product so one row is "update" and one is "create".
    await prisma.product.create({
      data: { skuMaster: 'EX', name: 'Existing', totalStock: 1, basePrice: 1 } as any,
    });
    // Build a tiny xlsx in-memory with exceljs.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(['sku_master', 'name', 'base_price', 'total_stock']);
    ws.addRow(['EX', 'Updated', '5', '10']); // update
    ws.addRow(['NEW', 'Brand new', '7', '3']); // create
    ws.addRow(['BAD', '', 'free', '']); // error: invalid base_price + no name (create)
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = await svc.createPreviewFromUpload('test.xlsx', buf, user);
    expect(preview.totalRows).toBe(3);
    expect(preview.updateCount).toBe(1);
    expect(preview.newCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0].sku).toBe('BAD');
    expect(preview.status).toBe('PREVIEW');
    // Job persisted
    expect(prisma.jobs.size).toBe(1);
  });

  it('rejects empty files', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty').addRow(['sku_master', 'name']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(svc.createPreviewFromUpload('empty.xlsx', buf, user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects files missing the sku_master column', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bad');
    ws.addRow(['name', 'price']);
    ws.addRow(['A', '1']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(svc.createPreviewFromUpload('bad.xlsx', buf, user)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ImportExportService.exportProductsBuffer (shape)', () => {
  it('produces an xlsx with Products + SiteMapping sheets and header styling', async () => {
    const prisma = fakePrisma();
    await prisma.product.create({
      data: {
        skuMaster: 'X-1',
        name: 'X',
        category: 'Cat',
        totalStock: 5,
        basePrice: 9,
        expiryDate: new Date('2027-01-01'),
      } as any,
    });
    const svc = new ImportExportService(prisma);
    const buf = await svc.exportProductsBuffer({});
    expect(buf.length).toBeGreaterThan(0);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Products', 'SiteMapping']);
    const productsSheet = wb.getWorksheet('Products')!;
    expect(productsSheet.getRow(1).getCell(1).value).toBe('sku_master');
    expect(productsSheet.getRow(2).getCell(1).value).toBe('X-1');
  });

  it('exportWooCommerceBuffer throws NotFound for unknown site', async () => {
    const prisma = fakePrisma();
    (prisma.siteConfig.findUnique as any) = async () => null;
    const svc = new ImportExportService(prisma);
    await expect(svc.exportWooCommerceBuffer('missing')).rejects.toThrow(NotFoundException);
  });

  it('exportWooCommerceBuffer uses site mapping SKU when present, else hub sku_master', async () => {
    const prisma = fakePrisma();
    await prisma.product.create({
      data: { skuMaster: 'HUB-1', name: 'Hub', totalStock: 3, basePrice: 2 } as any,
    });
    (prisma.siteConfig.findUnique as any) = async () => ({ id: 's1', name: 'Demo' });
    (prisma.siteProductMapping.findMany as any) = async () => [
      { productId: 'p1', siteSku: 'SITE-SKU-1' },
    ];
    const svc = new ImportExportService(prisma);
    const buf = await svc.exportWooCommerceBuffer('s1');
    const csvText = buf.toString('utf-8');
    expect(csvText).toContain('SITE-SKU-1');
    expect(csvText).toContain('simple');
    expect(csvText).toContain('publish');
  });
});
