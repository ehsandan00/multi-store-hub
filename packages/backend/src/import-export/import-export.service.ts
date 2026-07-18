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
  RawSiteMappingRow,
  ValidatedImportRow,
  ValidatedSiteMappingRow,
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
  'product type': 'productType',
  product_type: 'productType',
  producttype: 'productType',
  'parent sku': 'parentSku',
  parent_sku: 'parentSku',
  parentsku: 'parentSku',
  'variation attributes': 'variationAttributes',
  variation_attributes: 'variationAttributes',
  variationattributes: 'variationAttributes',
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
    return this.buildProductsWorkbook(filters);
  }

  /** Empty template with the same sheets/columns as export — safe to fill and re-import. */
  async exportTemplateBuffer(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Multi-Store Hub';
    wb.created = new Date();
    this.addProductsSheet(wb, []);
    this.addSiteMappingSheet(wb, [], new Map());
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private async buildProductsWorkbook(filters: ExportFilters): Promise<Buffer> {
    const products = await this.fetchProductsForExport(filters);
    const parentSkuById = new Map<string, string>();
    for (const p of products) {
      if (p.parentId) {
        const parent = products.find((x) => x.id === p.parentId);
        if (parent) parentSkuById.set(p.parentId, parent.skuMaster);
      }
    }
    // Include parents referenced by filtered variations even if parent didn't match filters.
    const missingParentIds = products
      .map((p) => p.parentId)
      .filter((id): id is string => !!id && !products.some((p) => p.id === id));
    if (missingParentIds.length) {
      const parents = await this.prisma.product.findMany({
        where: { id: { in: missingParentIds } },
      });
      for (const p of parents) {
        products.push(p);
      }
      products.sort((a, b) => a.skuMaster.localeCompare(b.skuMaster));
      for (const p of products) {
        if (p.parentId) {
          const parent = products.find((x) => x.id === p.parentId);
          if (parent) parentSkuById.set(p.parentId, parent.skuMaster);
        }
      }
    }
    for (const p of products) {
      if (p.parentId && !parentSkuById.has(p.parentId)) {
        const parent = products.find((x) => x.id === p.parentId);
        if (parent) parentSkuById.set(p.parentId, parent.skuMaster);
      }
    }

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
    this.addProductsSheet(wb, products, parentSkuById);
    const skuById = new Map(products.map((p) => [p.id, p.skuMaster]));
    this.addSiteMappingSheet(wb, mappings, skuById);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private addProductsSheet(
    wb: ExcelJS.Workbook,
    products: Array<{
      skuMaster: string;
      name: string;
      category: string | null;
      basePrice: { toString(): string };
      totalStock: number;
      lowStockThreshold: number;
      expiryDate: Date | null;
      barcode: string | null;
      imageUrl: string | null;
      description: string | null;
      productType?: string;
      parentId?: string | null;
      variationAttributes?: unknown;
    }>,
    parentSkuById: Map<string, string> = new Map(),
  ): void {
    const productsSheet = wb.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    productsSheet.columns = [
      { header: 'sku_master', key: 'skuMaster', width: 18 },
      { header: 'name', key: 'name', width: 32 },
      { header: 'product_type', key: 'productType', width: 12 },
      { header: 'parent_sku', key: 'parentSku', width: 18 },
      { header: 'variation_attributes', key: 'variationAttributes', width: 28 },
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
      const attrs = formatVariationAttributes(p.variationAttributes);
      const parentSku = p.parentId ? parentSkuById.get(p.parentId) ?? '' : '';
      productsSheet.addRow({
        skuMaster: p.skuMaster,
        name: p.name,
        productType: (p.productType ?? 'SIMPLE').toString().toLowerCase(),
        parentSku,
        variationAttributes: attrs,
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
  }

  private addSiteMappingSheet(
    wb: ExcelJS.Workbook,
    mappings: Array<{
      productId: string;
      siteSku: string | null;
      siteProductId: string | null;
      siteSpecificTitle: string | null;
      matchStatus: string;
      site?: { name: string } | null;
    }>,
    skuById: Map<string, string>,
  ): void {
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
      const wcType =
        (p as { productType?: string }).productType === 'VARIABLE'
          ? 'variable'
          : (p as { productType?: string }).productType === 'VARIATION'
            ? 'variation'
            : 'simple';
      ws.addRow([
        wcType,
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
    const rawMappings = await this.parseSiteMappingSheet(fileBuffer);
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
    const { valid: validMappings, errors: mappingErrors } = await this.validateMappingRows(
      rawMappings,
      skuSet,
    );
    const allErrors = [...errors, ...mappingErrors];

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
        errorCount: allErrors.length,
        errors: allErrors as unknown as Prisma.InputJsonValue,
        rows: valid as unknown as Prisma.InputJsonValue,
        mappingRows: validMappings as unknown as Prisma.InputJsonValue,
        createdByUserId: user.id,
      },
    });

    return this.toPreview(job, valid, validMappings.length);
  }

  /** Returns the persisted preview for a job (must be in PREVIEW status). */
  async getPreview(jobId: string): Promise<ImportPreview> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found');
    const rows = (job.rows as unknown as ValidatedImportRow[] | null) ?? [];
    const errors = (job.errors as unknown as ImportError[] | null) ?? [];
    const mappingRows = (job.mappingRows as unknown as ValidatedSiteMappingRow[] | null) ?? [];
    return {
      jobId: job.id,
      fileName: job.fileName,
      status: job.status,
      totalRows: job.totalRows,
      newCount: job.newCount,
      updateCount: job.updateCount,
      errorCount: job.errorCount,
      mappingRowCount: mappingRows.length,
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
    const mappingRows = (job.mappingRows as unknown as ValidatedSiteMappingRow[] | null) ?? [];
    const startedAt = job.startedAt ?? new Date();

    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: ImportError[] = [];

    const sortedRows = [...rows].sort((a, b) => {
      const rank = (t?: string) => (t === 'VARIATION' ? 2 : 1);
      return rank(a.productType) - rank(b.productType);
    });

    try {
      for (const row of sortedRows) {
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

      for (const m of mappingRows) {
        try {
          await this.applyMappingRow(m);
        } catch (err) {
          failed += 1;
          errors.push({
            row: m.row,
            sku: m.skuMaster,
            message: (err as Error).message ?? 'Unknown error',
          });
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
      mappingRows: Prisma.JsonNull,
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
      data: { status: 'CANCELLED', rows: Prisma.JsonNull, mappingRows: Prisma.JsonNull, finishedAt: new Date() },
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
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws =
      wb.getWorksheet('Products') ??
      wb.worksheets.find((s) => /products/i.test(s.name)) ??
      wb.worksheets[0];
    if (!ws) throw new BadRequestException('Workbook has no sheets.');
    return this.parseProductSheet(ws);
  }

  async parseSiteMappingSheet(buffer: Buffer): Promise<RawSiteMappingRow[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws =
      wb.getWorksheet('SiteMapping') ??
      wb.worksheets.find((s) => /sitemapping|site.mapping/i.test(s.name));
    if (!ws) return [];
    return this.parseMappingSheet(ws);
  }

  private parseProductSheet(ws: ExcelJS.Worksheet): RawImportRow[] {
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
    const skusInFile = new Set(
      raw.map((r) => (r.skuMaster ?? '').trim()).filter(Boolean),
    );

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

      const productType = parseProductType(r.productType);
      const parentSku = (r.parentSku ?? '').trim() || null;
      const variationAttributes = parseVariationAttributesText(r.variationAttributes);
      if (productType === 'VARIATION' && !parentSku) {
        errors.push({ row: r.row, sku, message: 'parent_sku is required for variation products' });
        continue;
      }
      if (parentSku && !existingBySku.has(parentSku) && !skusInFile.has(parentSku)) {
        errors.push({
          row: r.row,
          sku,
          message: `parent_sku "${parentSku}" not found in hub or this file`,
        });
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
        productType,
        parentSku,
        variationAttributes,
        siteSkus: r.siteSkus && Object.keys(r.siteSkus).length ? r.siteSkus : undefined,
        action,
        productId: existingId,
      });
    }

    return { valid, errors };
  }

  private parseMappingSheet(ws: ExcelJS.Worksheet): RawSiteMappingRow[] {
    const headerRow = ws.getRow(1);
    if (!headerRow?.cellCount) return [];
    const colMap = new Map<number, string>();
    headerRow.eachCell((cell, colNumber) => {
      const raw = String(cell.value ?? '').trim().toLowerCase();
      if (!raw) return;
      if (raw === 'sku_master' || raw === 'sku') colMap.set(colNumber, 'skuMaster');
      else if (raw === 'site_name' || raw === 'site name') colMap.set(colNumber, 'siteName');
      else if (raw === 'site_sku' || raw === 'site sku') colMap.set(colNumber, 'siteSku');
      else if (raw === 'site_product_id' || raw === 'site product id')
        colMap.set(colNumber, 'siteProductId');
      else if (raw === 'site_specific_title' || raw === 'site specific title')
        colMap.set(colNumber, 'siteSpecificTitle');
      else if (raw === 'match_status' || raw === 'match status') colMap.set(colNumber, 'matchStatus');
    });
    if (!colMap.size) return [];

    const out: RawSiteMappingRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row.hasValues === false) continue;
      const parsed: RawSiteMappingRow = { row: r };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const field = colMap.get(colNumber);
        if (!field) return;
        (parsed as any)[field] = cell.value == null ? '' : cellText(cell.value);
      });
      if ((parsed.skuMaster ?? '').trim() || (parsed.siteName ?? '').trim()) out.push(parsed);
    }
    return out;
  }

  private async validateMappingRows(
    raw: RawSiteMappingRow[],
    productSkusInFile: Set<string>,
  ): Promise<{ valid: ValidatedSiteMappingRow[]; errors: ImportError[] }> {
    const valid: ValidatedSiteMappingRow[] = [];
    const errors: ImportError[] = [];
    if (!raw.length) return { valid, errors };

    const sites = await this.prisma.siteConfig.findMany({ select: { id: true, name: true } });
    const siteByName = new Map(sites.map((s) => [s.name.toLowerCase(), s]));

    const existingProducts = await this.prisma.product.findMany({
      where: {
        skuMaster: {
          in: [...new Set(raw.map((r) => (r.skuMaster ?? '').trim()).filter(Boolean))],
        },
      },
      select: { skuMaster: true },
    });
    const knownSkus = new Set([
      ...existingProducts.map((p) => p.skuMaster),
      ...productSkusInFile,
    ]);

    for (const r of raw) {
      const sku = (r.skuMaster ?? '').trim();
      const siteName = (r.siteName ?? '').trim();
      if (!sku) {
        errors.push({ row: r.row, message: 'SiteMapping: missing sku_master' });
        continue;
      }
      if (!siteName) {
        errors.push({ row: r.row, sku, message: 'SiteMapping: missing site_name' });
        continue;
      }
      if (!knownSkus.has(sku)) {
        errors.push({
          row: r.row,
          sku,
          message: `SiteMapping: sku_master "${sku}" not in Products sheet or hub`,
        });
        continue;
      }
      const site = siteByName.get(siteName.toLowerCase());
      if (!site) {
        errors.push({ row: r.row, sku, message: `SiteMapping: unknown site "${siteName}"` });
        continue;
      }
      valid.push({
        row: r.row,
        skuMaster: sku,
        siteName: site.name,
        siteSku: (r.siteSku ?? '').trim() || null,
        siteProductId: (r.siteProductId ?? '').trim() || null,
        siteSpecificTitle: (r.siteSpecificTitle ?? '').trim() || null,
        matchStatus: (r.matchStatus ?? '').trim() || null,
      });
    }
    return { valid, errors };
  }

  // ─── Internals: applying a single row during commit ────────────────────────

  private async applyRow(row: ValidatedImportRow, userId?: string): Promise<void> {
    const parentId = row.parentSku ? await this.resolveParentId(row.parentSku) : null;
    const productType = row.productType ?? 'SIMPLE';
    const variationAttributes = row.variationAttributes ?? undefined;

    if (row.action === 'create') {
      const initialStock = row.totalStock ?? 0;
      const product = await this.prisma.product.create({
        data: {
          skuMaster: row.skuMaster,
          name: row.name ?? row.skuMaster,
          description: row.description ?? null,
          category: row.category ?? null,
          basePrice: row.basePrice != null ? new Prisma.Decimal(row.basePrice) : new Prisma.Decimal(0),
          expiryDate: row.expiryDate ? new Date(row.expiryDate) : null,
          totalStock: initialStock,
          lowStockThreshold: row.lowStockThreshold ?? 0,
          barcode: row.barcode ?? null,
          imageUrl: row.imageUrl ?? null,
          productType,
          parentId,
          variationAttributes: variationAttributes as Prisma.InputJsonValue | undefined,
          expiryBatches: row.expiryDate
            ? {
                create: [
                  {
                    expiryDate: new Date(row.expiryDate),
                    quantity: initialStock,
                  },
                ],
              }
            : undefined,
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
        } as Prisma.ProductCreateInput,
      });
      await this.applySiteSkus(row.siteSkus, product.id);
      return;
    }

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
      if (row.productType !== undefined) (data as Prisma.ProductUpdateInput & { productType?: string }).productType = row.productType;
      if (row.parentSku !== undefined) (data as Prisma.ProductUpdateInput & { parentId?: string | null }).parentId = parentId;
      if (row.variationAttributes !== undefined) {
        data.variationAttributes = variationAttributes as Prisma.InputJsonValue | undefined;
      }

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

      if (row.expiryDate !== undefined) {
        await tx.productExpiryBatch.deleteMany({ where: { productId: existing.id } });
        if (row.expiryDate) {
          await tx.productExpiryBatch.create({
            data: {
              productId: existing.id,
              expiryDate: new Date(row.expiryDate),
              quantity: nextStock,
            },
          });
        }
      }
    });
    const updatedProduct = await this.prisma.product.findUnique({
      where: { skuMaster: row.skuMaster },
      select: { id: true },
    });
    if (updatedProduct) await this.applySiteSkus(row.siteSkus, updatedProduct.id);
  }

  private async resolveParentId(parentSku: string): Promise<string> {
    const parent = await this.prisma.product.findUnique({
      where: { skuMaster: parentSku },
      select: { id: true },
    });
    if (!parent) throw new Error(`Parent product "${parentSku}" not found`);
    return parent.id;
  }

  private async applySiteSkus(
    siteSkus: Record<string, string> | undefined,
    productId: string,
  ): Promise<void> {
    if (!siteSkus || !Object.keys(siteSkus).length) return;
    const sites = await this.prisma.siteConfig.findMany({ select: { id: true, name: true } });
    const siteByName = new Map(sites.map((s) => [s.name.toLowerCase(), s]));
    for (const [siteName, siteSku] of Object.entries(siteSkus)) {
      const site = siteByName.get(siteName.toLowerCase());
      if (!site) continue;
      await this.prisma.siteProductMapping.upsert({
        where: { productId_siteId: { productId, siteId: site.id } },
        create: {
          productId,
          siteId: site.id,
          siteSku,
          matchStatus: 'MANUAL',
        },
        update: { siteSku },
      });
    }
  }

  private async applyMappingRow(row: ValidatedSiteMappingRow): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { skuMaster: row.skuMaster },
      select: { id: true },
    });
    if (!product) throw new Error(`Product ${row.skuMaster} not found`);
    const site = await this.prisma.siteConfig.findFirst({
      where: { name: { equals: row.siteName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!site) throw new Error(`Site ${row.siteName} not found`);

    const matchStatus = parseMatchStatus(row.matchStatus);
    const data = {
      siteSku: row.siteSku,
      siteProductId: row.siteProductId,
      siteSpecificTitle: row.siteSpecificTitle,
      matchStatus,
    };
    await this.prisma.siteProductMapping.upsert({
      where: { productId_siteId: { productId: product.id, siteId: site.id } },
      create: { productId: product.id, siteId: site.id, ...data },
      update: data,
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
    mappingRowCount = 0,
  ): ImportPreview {
    return {
      jobId: job.id,
      fileName: job.fileName,
      status: job.status,
      totalRows: job.totalRows,
      newCount: job.newCount,
      updateCount: job.updateCount,
      errorCount: job.errorCount,
      mappingRowCount,
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
    if ('result' in value && value.result != null) return String(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((rt: any) => rt.text ?? '').join('');
    }
    if ('text' in value && value.text != null) return String(value.text);
  }
  return String(value);
}

export function parseProductType(raw?: string | null): import('@prisma/client').ProductType {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'variable') return 'VARIABLE';
  if (v === 'variation') return 'VARIATION';
  return 'SIMPLE';
}

export function parseVariationAttributesText(
  raw?: string | null,
): Record<string, string> | null {
  if (!raw?.trim()) return null;
  const out: Record<string, string> = {};
  for (const part of raw.split(/[|;]/)) {
    const seg = part.trim();
    if (!seg) continue;
    const [k, ...rest] = seg.includes('=') ? seg.split('=') : seg.split(':');
    const key = (k ?? '').trim();
    const val = rest.join(seg.includes('=') ? '=' : ':').trim();
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

export function formatVariationAttributes(attrs: unknown): string {
  if (!attrs || typeof attrs !== 'object') return '';
  return Object.entries(attrs as Record<string, string>)
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

function parseMatchStatus(raw?: string | null): import('@prisma/client').MatchStatus {
  const v = (raw ?? '').trim().toUpperCase();
  if (v === 'APPROVED') return 'APPROVED';
  if (v === 'PENDING_REVIEW') return 'PENDING_REVIEW';
  return 'MANUAL';
}
