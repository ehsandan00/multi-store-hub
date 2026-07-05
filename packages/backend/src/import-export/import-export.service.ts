import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ExportFilters,
  ImportError,
  ImportPreview,
  ImportReport,
  RawImportRow,
  ValidatedImportRow,
} from './import-export.types';
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_PREVIEW_ROW_SAMPLE,
} from './import-export.types';

// ─── Column header aliases (case-insensitive) ────────────────────────────────
// Keys must include every column name the export emits (sku_master, base_price,
// total_stock, low_stock_threshold, expiry_date, image_url) so that an
// export → re-import round trip is lossless, plus common human variants.
const HEADER_ALIASES: Record<string, string> = {
  sku: 'skuMaster',
  'sku_master': 'skuMaster',
  'sku-master': 'skuMaster',
  'master sku': 'skuMaster',
  name: 'name',
  title: 'name',
  product: 'name',
  category: 'category',
  'base price': 'basePrice',
  'base_price': 'basePrice',
  baseprice: 'basePrice',
  price: 'basePrice',
  stock: 'totalStock',
  'total stock': 'totalStock',
  'total_stock': 'totalStock',
  totalstock: 'totalStock',
  'low stock threshold': 'lowStockThreshold',
  'low_stock_threshold': 'lowStockThreshold',
  'low-stock-threshold': 'lowStockThreshold',
  lowstockthreshold: 'lowStockThreshold',
  'low stock': 'lowStockThreshold',
  'low_stock': 'lowStockThreshold',
  expiry: 'expiryDate',
  'expiry date': 'expiryDate',
  'expiry_date': 'expiryDate',
  expirydate: 'expiryDate',
  barcode: 'barcode',
  image: 'imageUrl',
  'image url': 'imageUrl',
  'image_url': 'imageUrl',
  imageurl: 'imageUrl',
  description: 'description',
};

const SITE_SKU_PREFIX = 'site:';

@Injectable()
export class ImportExportService {
  private readonly logger = new Logger(ImportExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Export: full hub workbook (xlsx) ──────────────────────────────────────

  /**
   * Builds a multi-sheet xlsx:
   *   Sheet "Products"  — one row per hub product
   *   Sheet "SiteMapping" — one row per (product, site) mapping
   *
   * Filtering is applied on the Products sheet; the SiteMapping sheet only
   * includes rows for the filtered product set.
   */
  async exportProductsBuffer(filters: ExportFilters): Promise<Buffer> {
    const products = await this.fetchProductsForExport(filters);
    const productIds = products.map((p) => p.id);
    const mappings =
      productIds.length > 0
        ? await this.prisma.siteProductMapping.findMany({
            where: { productId: { in: productIds } },
            include: { site: { select: { name: true } } },
          })
        : [];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Multi-Store Hub';
    wb.created = new Date();

    const productsSheet = wb.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    productsSheet.columns = [
      { header: 'sku_master', key: 'skuMaster', width: 18 },
      { header: 'name', key: 'name', width: 32 },
      { header: 'category', key: 'category', width: 18 },
      { header: 'base_price', key: 'basePrice', width: 12 },
      { header: 'total_stock', key: 'totalStock', width: 12 },
      { header: 'low_stock_threshold', key: 'lowStockThreshold', width: 18 },
      { header: 'expiry_date', key: 'expiryDate', width: 14 },
      { header: 'barcode', key: 'barcode', width: 18 },
      { header: 'image_url', key: 'imageUrl', width: 30 },
      { header: 'description', key: 'description', width: 50 },
    ];
    for (const p of products) {
      productsSheet.addRow({
        skuMaster: p.skuMaster,
        name: p.name,
        category: p.category ?? '',
        basePrice: p.basePrice.toString(),
        totalStock: p.totalStock,
        lowStockThreshold: p.lowStockThreshold,
        expiryDate: p.expiryDate ? p.expiryDate.toISOString() : '',
        barcode: p.barcode ?? '',
        imageUrl: p.imageUrl ?? '',
        description: p.description ?? '',
      });
    }
    this.styleHeaderRow(productsSheet);

    const mappingSheet = wb.addWorksheet('SiteMapping', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    mappingSheet.columns = [
      { header: 'sku_master', key: 'skuMaster', width: 18 },
      { header: 'site_name', key: 'siteName', width: 24 },
      { header: 'site_sku', key: 'siteSku', width: 18 },
      { header: 'site_product_id', key: 'siteProductId', width: 16 },
      { header: 'site_specific_title', key: 'siteSpecificTitle', width: 36 },
      { header: 'match_status', key: 'matchStatus', width: 16 },
    ];
    // Build a lookup from product id → sku_master for fast join.
    const skuById = new Map(products.map((p) => [p.id, p.skuMaster]));
    for (const m of mappings) {
      mappingSheet.addRow({
        skuMaster: skuById.get(m.productId) ?? '',
        siteName: m.site?.name ?? '',
        siteSku: m.siteSku ?? '',
        siteProductId: m.siteProductId ?? '',
        siteSpecificTitle: m.siteSpecificTitle ?? '',
        matchStatus: m.matchStatus,
      });
    }
    this.styleHeaderRow(mappingSheet);

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Export: WooCommerce-import-ready (CSV) for a single site ───────────────

  /**
   * Produces a CSV in WooCommerce's default product-import schema (a stable
   * subset). SKU is the join key: we use the site-specific SKU when a
   * SiteProductMapping exists, falling back to the hub sku_master.
   *
   * WooCommerce import columns (subset, all standard fields):
   *   Type, SKU, Name, Regular price, Stock, Categories, Description, Images, Status, Visibility, Tax status, Backorders
   */
  async exportWooCommerceBuffer(siteId: string): Promise<Buffer> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');

    const products = await this.fetchProductsForExport({ siteId });
    const mappings =
      products.length > 0
        ? await this.prisma.siteProductMapping.findMany({
            where: { siteId, productId: { in: products.map((p) => p.id) } },
          })
        : [];
    const mapByProductId = new Map(mappings.map((m) => [m.productId, m]));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('products');
    const headers = [
      'Type',
      'SKU',
      'Name',
      'Regular price',
      'Stock',
      'Categories',
      'Description',
      'Images',
      'Status',
      'Visibility',
      'Tax status',
      'Backorders',
    ];
    ws.addRow(headers);

    for (const p of products) {
      const m = mapByProductId.get(p.id);
      ws.addRow([
        'simple',
        m?.siteSku || p.skuMaster,
        m?.siteSpecificTitle || p.name,
        p.basePrice.toString(),
        p.totalStock,
        p.category ?? '',
        p.description ?? '',
        p.imageUrl ?? '',
        'publish',
        'visible',
        'taxable',
        'no',
      ]);
    }

    const buf = await wb.csv.writeBuffer();
    return Buffer.from(buf);
  }

  // ─── Import: parse + validate + persist preview ─────────────────────────────

  /**
   * Parses an uploaded xlsx buffer, validates rows, classifies each as
   * create/update by sku_master, and persists an ImportJob(status=PREVIEW)
   * holding the validated rows + errors. Returns a preview summary.
   */
  async createPreviewFromUpload(
    fileName: string,
    fileBuffer: Buffer,
    user: AuthenticatedUser,
  ): Promise<ImportPreview> {
    if (fileBuffer.byteLength > IMPORT_MAX_FILE_BYTES) {
      throw new BadRequestException(
        `File too large (max ${IMPORT_MAX_FILE_BYTES} bytes; got ${fileBuffer.byteLength})`,
      );
    }

    const rawRows = await this.parseWorkbook(fileBuffer);
    if (rawRows.length === 0) {
      throw new BadRequestException('No data rows found in the uploaded file.');
    }
    if (rawRows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Too many rows (max ${IMPORT_MAX_ROWS}; got ${rawRows.length}). Please split the file.`,
      );
    }

    // Fetch existing products matching the SKUs in the file (single query).
    const skuSet = new Set<string>();
    for (const r of rawRows) {
      const sku = (r.skuMaster ?? '').trim();
      if (sku) skuSet.add(sku);
    }
    const existing = await this.prisma.product.findMany({
      where: { skuMaster: { in: Array.from(skuSet) } },
      select: { id: true, skuMaster: true },
    });
    const existingBySku = new Map(existing.map((p) => [p.skuMaster, p.id]));

    const { valid, errors } = this.validateRows(rawRows, existingBySku);

    const newCount = valid.filter((v) => v.action === 'create').length;
    const updateCount = valid.filter((v) => v.action === 'update').length;

    const job = await this.prisma.importJob.create({
      data: {
        kind: 'PRODUCT_IMPORT',
        status: 'PREVIEW',
        fileName,
        totalRows: rawRows.length,
        newCount,
        updateCount,
        errorCount: errors.length,
        errors: errors as unknown as Prisma.InputJsonValue,
        rows: valid as unknown as Prisma.InputJsonValue,
        createdByUserId: user.id,
      },
    });

    return this.toPreview(job, valid);
  }

  /** Returns the persisted preview for a job (must be in PREVIEW status). */
  async getPreview(jobId: string): Promise<ImportPreview> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');
    const rows = (job.rows as unknown as ValidatedImportRow[] | null) ?? [];
    const errors = (job.errors as unknown as ImportError[] | null) ?? [];
    return {
      jobId: job.id,
      fileName: job.fileName,
      status: job.status,
      totalRows: job.totalRows,
      newCount: job.newCount,
      updateCount: job.updateCount,
      errorCount: job.errorCount,
      errors,
      rowsPreview: rows.slice(0, IMPORT_PREVIEW_ROW_SAMPLE),
    };
  }

  // ─── Import: commit (called by the BullMQ processor) ───────────────────────

  /**
   * Applies a PREVIEW job to the database. Each valid row is upserted by
   * sku_master inside its own transaction so a single bad row doesn't roll
   * back the whole import. Inventory logs are written for stock changes.
   *
   * Returns the final report and updates the ImportJob to COMPLETED.
   * This method is safe to call directly (sync) in tests or when the queue
   * is unavailable; the processor wraps it in a job.
   */
  async commitJob(jobId: string): Promise<ImportReport> {
    // Atomic claim: only one caller can transition PREVIEW → PROCESSING. This
    // is a compare-and-set, not a read-then-write, so two concurrent commits
    // for the same job (e.g. a double-clicked "Confirm" or two workers) cannot
    // both proceed — exactly one wins, the other gets a clean BadRequest.
    const claimed = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: 'PREVIEW' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
    if (claimed.count === 0) {
      const fresh = await this.prisma.importJob.findUnique({ where: { id: jobId } });
      if (!fresh) throw new NotFoundException('Import job not found');
      throw new BadRequestException(`Job is in ${fresh.status} state; cannot commit.`);
    }

    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');

    const rows = (job.rows as unknown as ValidatedImportRow[] | null) ?? [];
    const startedAt = job.startedAt ?? new Date();

    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: ImportError[] = [];

    // Per-row application is individually try/caught so one bad row doesn't
    // abort the import. An unexpected escape from this loop (e.g. a Prisma
    // connection drop) is caught by the outer guard below so the job is
    // marked FAILED with a partial report instead of being left stuck in
    // PROCESSING forever.
    try {
      for (const row of rows) {
        try {
          await this.applyRow(row, job.createdByUserId ?? undefined);
          if (row.action === 'create') created += 1;
          else updated += 1;
        } catch (err) {
          failed += 1;
          errors.push({
            row: row.row,
            sku: row.skuMaster,
            message: (err as Error).message ?? 'Unknown error',
          });
          this.logger.warn(
            `Import row ${row.row} (sku=${row.skuMaster}) failed: ${(err as Error).message}`,
          );
        }
      }
    } catch (fatal) {
      this.logger.error(
        `Fatal error applying import job ${jobId}: ${(fatal as Error).message}`,
      );
      await this.markFailed(jobId, created, updated, failed, errors, startedAt, fatal as Error);
      throw fatal;
    }

    const finishedAt = new Date();
    const report: ImportReport = {
      created,
      updated,
      failed,
      errors,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };

    // The data is already applied at this point; a transient failure on the
    // final status update shouldn't make BullMQ retry (which would re-enter
    // commitJob and throw BadRequest because status is PROCESSING). Retry the
    // status update a few times, and if it still fails, leave the job in
    // PROCESSING and log loudly — the report is still returned to the worker.
    await this.markCompleted(jobId, report, finishedAt);

    return report;
  }

  private async markCompleted(
    jobId: string,
    report: ImportReport,
    finishedAt: Date,
  ): Promise<void> {
    const payload = {
      status: 'COMPLETED' as const,
      createdCount: report.created,
      updatedCount: report.updated,
      failedCount: report.failed,
      report: report as unknown as Prisma.InputJsonValue,
      finishedAt,
      rows: Prisma.JsonNull,
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.prisma.importJob.update({ where: { id: jobId }, data: payload });
        return;
      } catch (err) {
        this.logger.warn(
          `Failed to mark import job ${jobId} COMPLETED (attempt ${attempt}/3): ${(err as Error).message}`,
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
    // All retries exhausted — data is applied; status is stale but not corrupt.
    this.logger.error(
      `Import job ${jobId} data was applied but the COMPLETED status update failed 3x. The job will appear stuck in PROCESSING and needs manual reconciliation.`,
    );
  }

  private async markFailed(
    jobId: string,
    created: number,
    updated: number,
    failed: number,
    errors: ImportError[],
    startedAt: Date,
    cause: Error,
  ): Promise<void> {
    try {
      const report: ImportReport = {
        created,
        updated,
        failed,
        errors,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
      };
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          createdCount: created,
          updatedCount: updated,
          failedCount: failed,
          report: report as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
          // Preserve the validated rows so a future "retry from preview" is
          // possible — we only clear rows on COMPLETED/CANCELLED.
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to mark import job ${jobId} FAILED after fatal error: ${(err as Error).message}. Original cause: ${cause.message}`,
      );
    }
  }

  /** Marks a PREVIEW job as CANCELLED (user dismissed it). */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');
    if (job.status !== 'PREVIEW') {
      throw new BadRequestException(`Only PREVIEW jobs can be cancelled (current: ${job.status}).`);
    }
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', rows: Prisma.JsonNull, finishedAt: new Date() },
    });
  }

  async getJob(jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async listJobs(q: { page: number; pageSize: number }) {
    const page = q.page;
    const pageSize = Math.min(q.pageSize, 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.importJob.count(),
      this.prisma.importJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { email: true, fullName: true } } },
      }),
    ]);
    return { data: rows, total, page, pageSize };
  }

  // ─── Internals: parsing + validation ───────────────────────────────────────

  /**
   * Parses an xlsx buffer into raw rows. The first worksheet is used.
   * Header matching is case-insensitive via HEADER_ALIASES; columns with the
   * `site:` prefix (e.g. `site:Store IR`) become entries in `siteSkus`.
   */
  async parseWorkbook(buffer: Buffer): Promise<RawImportRow[]> {
    const wb = new ExcelJS.Workbook();
    // ExcelJS's typing expects an ArrayBuffer-backed Buffer; Node's Buffer is
    // Uint8Array-backed. The runtime accepts both — cast to satisfy tsc.
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Workbook has no sheets.');

    const headerRow = ws.getRow(1);
    if (!headerRow || headerRow.cellCount === 0) {
      throw new BadRequestException('First row must be a header row.');
    }

    // Build a mapping: column number → normalized field name (or `site:<name>`).
    const colMap = new Map<number, { field: string; siteName?: string }>();
    headerRow.eachCell((cell, colNumber) => {
      const raw = String(cell.value ?? '').trim();
      if (!raw) return;
      const lower = raw.toLowerCase();
      if (lower.startsWith(SITE_SKU_PREFIX)) {
        const siteName = raw.slice(SITE_SKU_PREFIX.length).trim();
        if (siteName) colMap.set(colNumber, { field: 'siteSku', siteName });
        return;
      }
      const field = HEADER_ALIASES[lower];
      if (field) colMap.set(colNumber, { field });
    });

    if (!colMap.size) {
      throw new BadRequestException(
        'No recognized header columns. Expected at least: sku_master, name.',
      );
    }
    if (![...colMap.values()].some((c) => c.field === 'skuMaster')) {
      throw new BadRequestException('Missing required column: sku_master (or "SKU").');
    }

    const out: RawImportRow[] = [];
    // Start at row 2 (1-based; row 1 is the header).
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row.hasValues === false) continue; // skip fully-empty rows
      const parsed: RawImportRow = { row: r, siteSkus: {} };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const mapping = colMap.get(colNumber);
        if (!mapping) return;
        const value = cell.value == null ? '' : cellText(cell.value);
        if (mapping.field === 'siteSku' && mapping.siteName) {
          if (value) parsed.siteSkus![mapping.siteName] = value;
          return;
        }
        (parsed as any)[mapping.field] = value;
      });
      // Skip rows where every recognized field is empty.
      const hasAny = (parsed.skuMaster ?? '').trim() !== '' || (parsed.name ?? '').trim() !== '';
      if (hasAny) out.push(parsed);
    }
    return out;
  }

  /**
   * Validates raw rows and classifies each as create/update.
   * Pure function (no I/O) — existingBySku is passed in, so this is unit-testable.
   */
  validateRows(
    raw: RawImportRow[],
    existingBySku: Map<string, string>,
  ): { valid: ValidatedImportRow[]; errors: ImportError[] } {
    const valid: ValidatedImportRow[] = [];
    const errors: ImportError[] = [];
    const seenSkus = new Set<string>();

    for (const r of raw) {
      const sku = (r.skuMaster ?? '').trim();
      if (!sku) {
        errors.push({ row: r.row, message: 'Missing sku_master' });
        continue;
      }
      if (sku.length > 100) {
        errors.push({ row: r.row, sku, message: 'sku_master exceeds 100 characters' });
        continue;
      }
      if (seenSkus.has(sku)) {
        errors.push({ row: r.row, sku, message: 'Duplicate sku_master within this file' });
        continue;
      }
      seenSkus.add(sku);

      const trimmedName = (r.name ?? '').trim();
      const existingId = existingBySku.get(sku);
      const action: 'create' | 'update' = existingId ? 'update' : 'create';
      if (action === 'create' && !trimmedName) {
        errors.push({
          row: r.row,
          sku,
          message: 'name is required when creating a new product',
        });
        continue;
      }

      const basePrice = parseDecimal(r.basePrice);
      if (r.basePrice !== undefined && r.basePrice !== '' && basePrice === null) {
        errors.push({ row: r.row, sku, message: `Invalid base_price: "${r.basePrice}"` });
        continue;
      }

      const totalStock = parseNonNegInt(r.totalStock);
      if (r.totalStock !== undefined && r.totalStock !== '' && totalStock === null) {
        errors.push({ row: r.row, sku, message: `Invalid total_stock: "${r.totalStock}"` });
        continue;
      }

      const lowStockThreshold = parseNonNegInt(r.lowStockThreshold);
      if (
        r.lowStockThreshold !== undefined &&
        r.lowStockThreshold !== '' &&
        lowStockThreshold === null
      ) {
        errors.push({
          row: r.row,
          sku,
          message: `Invalid low_stock_threshold: "${r.lowStockThreshold}"`,
        });
        continue;
      }

      const expiry = parseDate(r.expiryDate);
      if (r.expiryDate && r.expiryDate.trim() !== '' && expiry === null) {
        errors.push({ row: r.row, sku, message: `Invalid expiry_date: "${r.expiryDate}"` });
        continue;
      }

      valid.push({
        row: r.row,
        skuMaster: sku,
        name: trimmedName || undefined,
        category: r.category ? r.category.trim() : undefined,
        basePrice: basePrice ?? undefined,
        totalStock: totalStock ?? undefined,
        lowStockThreshold: lowStockThreshold ?? undefined,
        expiryDate: expiry,
        barcode: r.barcode ? r.barcode.trim() : undefined,
        imageUrl: r.imageUrl ? r.imageUrl.trim() : undefined,
        description: r.description ? r.description.trim() : undefined,
        siteSkus: r.siteSkus && Object.keys(r.siteSkus).length ? r.siteSkus : undefined,
        action,
        productId: existingId,
      });
    }

    return { valid, errors };
  }

  // ─── Internals: applying a single row during commit ────────────────────────

  private async applyRow(row: ValidatedImportRow, userId?: string): Promise<void> {
    if (row.action === 'create') {
      const initialStock = row.totalStock ?? 0;
      await this.prisma.product.create({
        data: {
          skuMaster: row.skuMaster,
          name: row.name ?? row.skuMaster, // defensive: validated rows have name on create
          description: row.description ?? null,
          category: row.category ?? null,
          basePrice: row.basePrice != null ? new Prisma.Decimal(row.basePrice) : new Prisma.Decimal(0),
          expiryDate: row.expiryDate ? new Date(row.expiryDate) : null,
          totalStock: initialStock,
          lowStockThreshold: row.lowStockThreshold ?? 0,
          barcode: row.barcode ?? null,
          imageUrl: row.imageUrl ?? null,
          inventoryLogs:
            initialStock > 0
              ? {
                  create: [
                    {
                      changeAmount: initialStock,
                      reason: 'IMPORT',
                      createdByUserId: userId ?? null,
                    },
                  ],
                }
              : undefined,
        },
      });
      return;
    }

    // update — read + compute delta + write inside a single transaction so the
    // stock-delta computation can't observe a half-applied concurrent write.
    // (The create path above is already atomic via Prisma's nested writes.)
    await this.prisma.$transaction(async (tx) => {
      const existing = row.productId
        ? await tx.product.findUnique({ where: { id: row.productId } })
        : await tx.product.findUnique({ where: { skuMaster: row.skuMaster } });
      if (!existing) {
        // Race: product was deleted between preview and commit. Treat as error.
        throw new Error('Product vanished between preview and commit');
      }

      const nextStock = row.totalStock ?? existing.totalStock;
      const stockDelta = nextStock - existing.totalStock;

      const data: Prisma.ProductUpdateInput = {};
      if (row.name !== undefined) data.name = row.name;
      if (row.category !== undefined) data.category = row.category;
      if (row.description !== undefined) data.description = row.description;
      if (row.basePrice !== undefined) data.basePrice = new Prisma.Decimal(row.basePrice);
      if (row.barcode !== undefined) data.barcode = row.barcode;
      if (row.imageUrl !== undefined) data.imageUrl = row.imageUrl;
      if (row.lowStockThreshold !== undefined) data.lowStockThreshold = row.lowStockThreshold;
      if (row.expiryDate !== undefined) {
        data.expiryDate = row.expiryDate ? new Date(row.expiryDate) : null;
      }
      if (row.totalStock !== undefined) data.totalStock = nextStock;

      if (stockDelta !== 0) {
        data.inventoryLogs = {
          create: [
            {
              changeAmount: stockDelta,
              reason: 'IMPORT',
              createdByUserId: userId ?? null,
            },
          ],
        };
      }

      await tx.product.update({ where: { id: existing.id }, data });
    });
  }

  // ─── Internals: data fetch for exports ─────────────────────────────────────

  private async fetchProductsForExport(filters: ExportFilters) {
    const where: Prisma.ProductWhereInput = {};
    if (filters.category) {
      where.category = { equals: filters.category, mode: 'insensitive' };
    }
    if (filters.minStock !== undefined || filters.maxStock !== undefined) {
      where.totalStock = {};
      if (filters.minStock !== undefined) where.totalStock.gte = filters.minStock;
      if (filters.maxStock !== undefined) where.totalStock.lte = filters.maxStock;
    }
    if (filters.siteId) {
      where.siteMappings = { some: { siteId: filters.siteId } };
    }
    return this.prisma.product.findMany({
      where,
      orderBy: { skuMaster: 'asc' },
    });
  }

  // ─── Internals: helpers ────────────────────────────────────────────────────

  private styleHeaderRow(ws: ExcelJS.Worksheet): void {
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    header.alignment = { vertical: 'middle' };
  }

  private toPreview(
    job: {
      id: string;
      fileName: string;
      status: any;
      totalRows: number;
      newCount: number;
      updateCount: number;
      errorCount: number;
      errors: unknown;
      rows: unknown;
    },
    rows: ValidatedImportRow[],
  ): ImportPreview {
    return {
      jobId: job.id,
      fileName: job.fileName,
      status: job.status,
      totalRows: job.totalRows,
      newCount: job.newCount,
      updateCount: job.updateCount,
      errorCount: job.errorCount,
      errors: (job.errors as unknown as ImportError[]) ?? [],
      rowsPreview: rows.slice(0, IMPORT_PREVIEW_ROW_SAMPLE),
    };
  }
}

// ─── Pure helpers (exported for testing) ────────────────────────────────────

export function parseDecimal(v: string | number | undefined | null): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  // Cap to 2 decimal places (matches DECIMAL(12,2) column)
  return Math.round(n * 100) / 100;
}

export function parseNonNegInt(v: string | number | undefined | null): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < 0) return null;
  return n;
}

export function parseDate(v: string | undefined | null): string | null {
  if (!v || !v.trim()) return null;
  const s = v.trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    // { formula, result } or rich text
    if ('result' in value && value.result != null) return String(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((rt: any) => rt.text ?? '').join('');
    }
    if ('text' in value && value.text != null) return String(value.text);
  }
  return String(value);
}
