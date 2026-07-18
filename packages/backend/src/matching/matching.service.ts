import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MatchStatus, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import * as fuzzball from 'fuzzball';
import { PrismaService } from '../prisma/prisma.service';
import { ClaudeMatcherService, scoreSiteTitleAgainstCatalog } from './claude-matcher.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { Environment } from '../config/env.validation';
import {
  MATCHING_CLAUDE_BATCH_SIZE,
  MATCHING_MAX_FILE_BYTES,
  MATCHING_MAX_ROWS,
  type MatchSuggestionRow,
  type MatchingPreview,
  type MatchingReport,
  type SiteProductRow,
} from './matching.types';

const TITLE_ALIASES = new Set([
  'title',
  'name',
  'product_name',
  'product name',
  'site_title',
  'site title',
]);
const SKU_ALIASES = new Set(['sku', 'site_sku', 'site sku']);
const ID_ALIASES = new Set(['id', 'product_id', 'site_product_id', 'woocommerce_id']);

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeMatcherService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  // ─── Upload + analyze ─────────────────────────────────────────────────────

  async analyzeUpload(
    siteId: string,
    fileName: string,
    buffer: Buffer,
    user?: AuthenticatedUser,
  ): Promise<MatchingPreview> {
    if (buffer.length > MATCHING_MAX_FILE_BYTES) {
      throw new BadRequestException(`File exceeds ${MATCHING_MAX_FILE_BYTES} bytes`);
    }
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.isActive) throw new BadRequestException('Site is inactive');

    const rows = await this.parseFile(buffer, fileName);
    if (rows.length > MATCHING_MAX_ROWS) {
      throw new BadRequestException(`File exceeds ${MATCHING_MAX_ROWS} rows`);
    }

    const job = await this.prisma.matchingJob.create({
      data: {
        siteId,
        fileName,
        status: 'PREVIEW',
        totalRows: rows.length,
        createdByUserId: user?.id,
      },
    });

    const report = await this.runAnalysis(job.id, siteId, rows);
    return this.toPreview(job.id, fileName, report);
  }

  async runAnalysis(
    jobId: string,
    siteId: string,
    rows: SiteProductRow[],
  ): Promise<{
    suggestions: MatchSuggestionRow[];
    errors: { row: number; message: string }[];
    suggestedCount: number;
    reviewCount: number;
    rejectedCount: number;
    aiReviewCount: number;
  }> {
    const definite = this.config.get('MATCH_FUZZY_DEFINITE', { infer: true });
    const reject = this.config.get('MATCH_FUZZY_REJECT', { infer: true });

    const hubProducts = await this.prisma.product.findMany({
      select: { id: true, skuMaster: true, name: true },
    });

    const errors: { row: number; message: string }[] = [];
    const suggestions: MatchSuggestionRow[] = [];
    const reviewQueue: { idx: number; siteTitle: string; candidate: NonNullable<ReturnType<typeof scoreSiteTitleAgainstCatalog>> }[] = [];

    for (const row of rows) {
      try {
        const best = scoreSiteTitleAgainstCatalog(
          row.siteTitle,
          hubProducts,
          definite,
          reject,
          (a, b) => fuzzball.token_set_ratio(a, b),
        );
        if (!best || best.tier === 'reject') {
          continue;
        }
        const sug: MatchSuggestionRow = {
          row: row.row,
          siteTitle: row.siteTitle,
          siteSku: row.siteSku,
          siteProductId: row.siteProductId,
          productId: best.productId,
          skuMaster: best.skuMaster,
          hubName: best.hubName,
          matchConfidence: best.score,
          tier: best.tier,
        };
        if (best.tier === 'review') {
          reviewQueue.push({ idx: suggestions.length, siteTitle: row.siteTitle, candidate: best });
        }
        suggestions.push(sug);
      } catch (err) {
        errors.push({ row: row.row, message: (err as Error).message });
      }
    }

    let aiReviewCount = 0;
    if (reviewQueue.length && this.claude.isEnabled()) {
      for (let i = 0; i < reviewQueue.length; i += MATCHING_CLAUDE_BATCH_SIZE) {
        const batch = reviewQueue.slice(i, i + MATCHING_CLAUDE_BATCH_SIZE);
        const results = await this.claude.reviewPairs(
          batch.map((b) => ({
            siteTitle: b.siteTitle,
            hubName: b.candidate.hubName,
            skuMaster: b.candidate.skuMaster,
          })),
        );
        results.forEach((r, j) => {
          const target = suggestions[batch[j].idx];
          target.matchAiReasoning = r.reasoning;
          if (r.sameProduct && r.confidence >= reject) {
            target.matchConfidence = Math.max(target.matchConfidence, r.confidence);
            target.tier = r.confidence >= definite ? 'definite' : 'review';
            aiReviewCount++;
          } else {
            target.tier = 'reject';
          }
        });
      }
    }

    const active = suggestions.filter((s) => s.tier !== 'reject');
    for (const s of active) {
      const mapping = await this.prisma.siteProductMapping.upsert({
        where: { productId_siteId: { productId: s.productId, siteId } },
        create: {
          productId: s.productId,
          siteId,
          siteSku: s.siteSku ?? null,
          siteProductId: s.siteProductId ?? null,
          siteSpecificTitle: s.siteTitle,
          matchConfidence: s.matchConfidence,
          matchAiReasoning: s.matchAiReasoning ?? null,
          matchStatus: MatchStatus.PENDING_REVIEW,
        },
        update: {
          siteSku: s.siteSku ?? undefined,
          siteProductId: s.siteProductId ?? undefined,
          siteSpecificTitle: s.siteTitle,
          matchConfidence: s.matchConfidence,
          matchAiReasoning: s.matchAiReasoning ?? null,
          matchStatus: MatchStatus.PENDING_REVIEW,
        },
      });
      s.mappingId = mapping.id;
    }

    const suggestedCount = active.filter((s) => s.tier === 'definite').length;
    const reviewCount = active.filter((s) => s.tier === 'review').length;
    const rejectedCount = rows.length - active.length;

    const matchedRows = new Set(active.map((s) => s.row));
    const orphanRows = rows
      .filter((r) => !matchedRows.has(r.row))
      .map((r) => ({
        siteTitle: r.siteTitle,
        siteSku: r.siteSku,
        siteProductId: r.siteProductId,
      }));

    const startedAt = new Date();
    const finishedAt = new Date();
    const report: MatchingReport = {
      suggested: suggestedCount,
      review: reviewCount,
      rejected: rejectedCount,
      aiReviewed: aiReviewCount,
      errors,
      orphanRows,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };

    await this.prisma.matchingJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        suggestedCount,
        reviewCount,
        rejectedCount,
        aiReviewCount,
        errors: errors as unknown as Prisma.InputJsonValue,
        report: report as unknown as Prisma.InputJsonValue,
        startedAt,
        finishedAt,
      },
    });

    return {
      suggestions: active,
      errors,
      suggestedCount,
      reviewCount,
      rejectedCount,
      aiReviewCount,
    };
  }

  // ─── Suggestions CRUD ─────────────────────────────────────────────────────

  async listSuggestions(q: {
    siteId?: string;
    status?: MatchStatus;
    page: number;
    pageSize: number;
  }) {
    const pageSize = Math.min(Math.max(q.pageSize, 1), 100);
    const page = Math.max(q.page, 1);
    const where: Prisma.SiteProductMappingWhereInput = {
      matchStatus: q.status ?? MatchStatus.PENDING_REVIEW,
      ...(q.siteId ? { siteId: q.siteId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.siteProductMapping.findMany({
        where,
        include: {
          product: { select: { skuMaster: true, name: true } },
          site: { select: { name: true } },
        },
        orderBy: [{ matchConfidence: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.siteProductMapping.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  // ─── Coverage gaps & duplicates ───────────────────────────────────────────

  async getCoverageGaps(q: { siteId?: string; page: number; pageSize: number }) {
    const pageSize = Math.min(Math.max(q.pageSize, 1), 100);
    const page = Math.max(q.page, 1);
    const sites = await this.prisma.siteConfig.findMany({
      where: { isActive: true, ...(q.siteId ? { id: q.siteId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (!sites.length) {
      return {
        hubNotOnSite: { data: [], total: 0, page, pageSize },
        siteNotInHub: { data: [], total: 0, page, pageSize },
        summary: { hubNotOnSiteTotal: 0, siteNotInHubTotal: 0 },
      };
    }

    const hubNotOnSiteAll: {
      productId: string;
      skuMaster: string;
      name: string;
      siteId: string;
      siteName: string;
      reason: 'NO_MAPPING' | 'NOT_SYNCED' | 'PENDING_REVIEW';
    }[] = [];

    for (const site of sites) {
      const products = await this.prisma.product.findMany({
        select: {
          id: true,
          skuMaster: true,
          name: true,
          siteMappings: {
            where: { siteId: site.id },
            select: { matchStatus: true, siteProductId: true },
          },
        },
        orderBy: { name: 'asc' },
      });
      for (const p of products) {
        const mapping = p.siteMappings[0];
        if (!mapping) {
          hubNotOnSiteAll.push({
            productId: p.id,
            skuMaster: p.skuMaster,
            name: p.name,
            siteId: site.id,
            siteName: site.name,
            reason: 'NO_MAPPING',
          });
        } else if (mapping.matchStatus === MatchStatus.PENDING_REVIEW) {
          hubNotOnSiteAll.push({
            productId: p.id,
            skuMaster: p.skuMaster,
            name: p.name,
            siteId: site.id,
            siteName: site.name,
            reason: 'PENDING_REVIEW',
          });
        } else if (!mapping.siteProductId) {
          hubNotOnSiteAll.push({
            productId: p.id,
            skuMaster: p.skuMaster,
            name: p.name,
            siteId: site.id,
            siteName: site.name,
            reason: 'NOT_SYNCED',
          });
        }
      }
    }

    const siteNotInHubAll = await this.collectSiteNotInHub(q.siteId);

    const hubSkip = (page - 1) * pageSize;
    const siteSkip = (page - 1) * pageSize;

    return {
      hubNotOnSite: {
        data: hubNotOnSiteAll.slice(hubSkip, hubSkip + pageSize),
        total: hubNotOnSiteAll.length,
        page,
        pageSize,
      },
      siteNotInHub: {
        data: siteNotInHubAll.slice(siteSkip, siteSkip + pageSize),
        total: siteNotInHubAll.length,
        page,
        pageSize,
      },
      summary: {
        hubNotOnSiteTotal: hubNotOnSiteAll.length,
        siteNotInHubTotal: siteNotInHubAll.length,
      },
    };
  }

  private async collectSiteNotInHub(siteId?: string) {
    const rows: {
      siteId: string;
      siteName: string;
      siteSku: string | null;
      siteTitle: string;
      siteProductId: string | null;
      source: 'ORDER' | 'UPLOAD';
      orderCount?: number;
    }[] = [];
    const seen = new Set<string>();

    const orderOrphans = await this.prisma.orderItem.groupBy({
      by: ['siteSku', 'lineName'],
      where: {
        productId: null,
        siteSku: { not: null },
        order: siteId ? { siteId } : undefined,
      },
      _count: { _all: true },
    });

    for (const g of orderOrphans) {
      const orders = await this.prisma.orderItem.findFirst({
        where: { productId: null, siteSku: g.siteSku, lineName: g.lineName },
        select: { order: { select: { siteId: true, site: { select: { name: true } } } } },
      });
      if (!orders) continue;
      const sid = orders.order.siteId;
      const key = `${sid}:${g.siteSku}:${g.lineName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        siteId: sid,
        siteName: orders.order.site.name,
        siteSku: g.siteSku,
        siteTitle: g.lineName ?? g.siteSku ?? '—',
        siteProductId: null,
        source: 'ORDER',
        orderCount: g._count._all,
      });
    }

    const jobs = await this.prisma.matchingJob.findMany({
      where: { siteId, status: 'COMPLETED', report: { not: Prisma.DbNull } },
      orderBy: { finishedAt: 'desc' },
      take: siteId ? 5 : 20,
      include: { site: { select: { name: true } } },
    });

    const latestJobBySite = new Map<string, (typeof jobs)[0]>();
    for (const job of jobs) {
      if (!latestJobBySite.has(job.siteId)) latestJobBySite.set(job.siteId, job);
    }

    for (const job of latestJobBySite.values()) {
      const report = job.report as MatchingReport | null;
      for (const orphan of report?.orphanRows ?? []) {
        const sku = orphan.siteSku ?? null;
        const key = `${job.siteId}:${sku ?? ''}:${orphan.siteTitle}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          siteId: job.siteId,
          siteName: job.site.name,
          siteSku: sku,
          siteTitle: orphan.siteTitle,
          siteProductId: orphan.siteProductId ?? null,
          source: 'UPLOAD',
        });
      }
    }

    return rows.sort((a, b) => a.siteName.localeCompare(b.siteName) || a.siteTitle.localeCompare(b.siteTitle));
  }

  async getDuplicateWarnings() {
    const [skuDupes, idDupes, hubBarcodeDupes] = await Promise.all([
      this.prisma.$queryRaw<
        { siteId: string; siteName: string; siteSku: string; count: number; productIds: string }[]
      >`
        SELECT
          m."siteId",
          s.name AS "siteName",
          m."siteSku",
          COUNT(*)::int AS count,
          string_agg(m."productId", ',') AS "productIds"
        FROM "SiteProductMapping" m
        JOIN "SiteConfig" s ON s.id = m."siteId"
        WHERE m."siteSku" IS NOT NULL AND m."siteSku" <> ''
        GROUP BY m."siteId", s.name, m."siteSku"
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `,
      this.prisma.$queryRaw<
        { siteId: string; siteName: string; siteProductId: string; count: number; productIds: string }[]
      >`
        SELECT
          m."siteId",
          s.name AS "siteName",
          m."siteProductId",
          COUNT(*)::int AS count,
          string_agg(m."productId", ',') AS "productIds"
        FROM "SiteProductMapping" m
        JOIN "SiteConfig" s ON s.id = m."siteId"
        WHERE m."siteProductId" IS NOT NULL AND m."siteProductId" <> ''
        GROUP BY m."siteId", s.name, m."siteProductId"
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `,
      this.prisma.$queryRaw<{ barcode: string; count: number; skus: string }[]>`
        SELECT
          barcode,
          COUNT(*)::int AS count,
          string_agg("skuMaster", ',') AS skus
        FROM "Product"
        WHERE barcode IS NOT NULL AND barcode <> ''
        GROUP BY barcode
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `,
    ]);

    return {
      siteSkuDuplicates: skuDupes.map((r) => ({
        siteId: r.siteId,
        siteName: r.siteName,
        siteSku: r.siteSku,
        count: Number(r.count),
        productIds: r.productIds.split(','),
      })),
      siteProductIdDuplicates: idDupes.map((r) => ({
        siteId: r.siteId,
        siteName: r.siteName,
        siteProductId: r.siteProductId,
        count: Number(r.count),
        productIds: r.productIds.split(','),
      })),
      hubBarcodeDuplicates: hubBarcodeDupes.map((r) => ({
        barcode: r.barcode,
        count: Number(r.count),
        skus: r.skus.split(','),
      })),
      total:
        skuDupes.length + idDupes.length + hubBarcodeDupes.length,
    };
  }

  async approve(mappingId: string): Promise<void> {
    const m = await this.prisma.siteProductMapping.findUnique({ where: { id: mappingId } });
    if (!m) throw new NotFoundException('Mapping not found');
    await this.prisma.siteProductMapping.update({
      where: { id: mappingId },
      data: { matchStatus: MatchStatus.APPROVED },
    });
  }

  async reject(mappingId: string): Promise<void> {
    const m = await this.prisma.siteProductMapping.findUnique({ where: { id: mappingId } });
    if (!m) throw new NotFoundException('Mapping not found');
    if (m.matchStatus === MatchStatus.APPROVED) {
      throw new BadRequestException('Cannot reject an already approved mapping');
    }
    await this.prisma.siteProductMapping.delete({ where: { id: mappingId } });
  }

  async bulkApprove(siteId?: string): Promise<{ approved: number }> {
    const threshold = this.config.get('MATCH_BULK_APPROVE', { infer: true });
    const res = await this.prisma.siteProductMapping.updateMany({
      where: {
        matchStatus: MatchStatus.PENDING_REVIEW,
        matchConfidence: { gte: threshold },
        ...(siteId ? { siteId } : {}),
      },
      data: { matchStatus: MatchStatus.APPROVED },
    });
    return { approved: res.count };
  }

  async updateManual(
    mappingId: string,
    dto: { productId?: string; siteSpecificTitle?: string; siteSku?: string },
  ) {
    const m = await this.prisma.siteProductMapping.findUnique({ where: { id: mappingId } });
    if (!m) throw new NotFoundException('Mapping not found');
    return this.prisma.siteProductMapping.update({
      where: { id: mappingId },
      data: {
        ...dto,
        matchStatus: MatchStatus.MANUAL,
      },
      include: {
        product: { select: { skuMaster: true, name: true } },
        site: { select: { name: true } },
      },
    });
  }

  async getJob(id: string) {
    const job = await this.prisma.matchingJob.findUnique({
      where: { id },
      include: { site: { select: { name: true } } },
    });
    if (!job) throw new NotFoundException('Matching job not found');
    return job;
  }

  async listJobs(q: { siteId?: string; page: number; pageSize: number }) {
    const pageSize = Math.min(Math.max(q.pageSize, 1), 100);
    const page = Math.max(q.page, 1);
    const where: Prisma.MatchingJobWhereInput = q.siteId ? { siteId: q.siteId } : {};
    const [data, total] = await Promise.all([
      this.prisma.matchingJob.findMany({
        where,
        include: { site: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.matchingJob.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  // ─── Parse helpers ────────────────────────────────────────────────────────

  private async parseFile(buffer: Buffer, fileName: string): Promise<SiteProductRow[]> {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.csv')) return this.parseCsv(buffer);
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return this.parseXlsx(buffer);
    throw new BadRequestException('Unsupported file type (use .csv or .xlsx)');
  }

  private async parseXlsx(buffer: Buffer): Promise<SiteProductRow[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new BadRequestException('Workbook has no sheets');

    const headerRow = sheet.getRow(1);
    const colMap = this.mapHeaders(headerRow);
    const rows: SiteProductRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const title = this.cellStr(row, colMap.title);
      if (!title) return;
      rows.push({
        row: rowNumber,
        siteTitle: title,
        siteSku: colMap.sku ? this.cellStr(row, colMap.sku) : undefined,
        siteProductId: colMap.id ? this.cellStr(row, colMap.id) : undefined,
      });
    });
    return rows;
  }

  private parseCsv(buffer: Buffer): SiteProductRow[] {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = this.splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const colMap = this.mapHeaderNames(headers);
    const rows: SiteProductRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCsvLine(lines[i]);
      const title = cols[colMap.title]?.trim();
      if (!title) continue;
      rows.push({
        row: i + 1,
        siteTitle: title,
        siteSku: colMap.sku !== undefined ? cols[colMap.sku]?.trim() : undefined,
        siteProductId: colMap.id !== undefined ? cols[colMap.id]?.trim() : undefined,
      });
    }
    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  private mapHeaders(headerRow: ExcelJS.Row): { title: number; sku?: number; id?: number } {
    const names: string[] = [];
    headerRow.eachCell((cell, col) => {
      names[col - 1] = String(cell.value ?? '').trim().toLowerCase();
    });
    return this.mapHeaderNames(names);
  }

  private mapHeaderNames(headers: string[]): { title: number; sku?: number; id?: number } {
    let title = headers.findIndex((h) => TITLE_ALIASES.has(h));
    if (title < 0) title = 0;
    const sku = headers.findIndex((h) => SKU_ALIASES.has(h));
    const id = headers.findIndex((h) => ID_ALIASES.has(h));
    return {
      title,
      sku: sku >= 0 ? sku : undefined,
      id: id >= 0 ? id : undefined,
    };
  }

  private cellStr(row: ExcelJS.Row, col: number): string {
    const v = row.getCell(col + 1).value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: string }).text);
    return String(v).trim();
  }

  private toPreview(
    jobId: string,
    fileName: string,
    result: Awaited<ReturnType<MatchingService['runAnalysis']>>,
  ): MatchingPreview {
    return {
      jobId,
      fileName,
      status: 'COMPLETED',
      totalRows: result.suggestions.length + result.rejectedCount,
      suggestedCount: result.suggestedCount,
      reviewCount: result.reviewCount,
      rejectedCount: result.rejectedCount,
      aiReviewCount: result.aiReviewCount,
      errors: result.errors,
      suggestions: result.suggestions,
    };
  }

  /** Site-only rows from matching/order orphans (view=site|all). */
  async listSiteOrphans(siteId?: string) {
    return this.collectSiteNotInHub(siteId);
  }

  /** Side-by-side hub vs site product comparison for one store. */
  async getProductComparison(q: {
    siteId: string;
    page: number;
    pageSize: number;
    filter?: 'all' | 'linked' | 'hub_only' | 'site_only' | 'pending';
  }) {
    const pageSize = Math.min(Math.max(q.pageSize, 1), 100);
    const page = Math.max(q.page, 1);
    const site = await this.prisma.siteConfig.findUnique({
      where: { id: q.siteId },
      select: { id: true, name: true },
    });
    if (!site) throw new NotFoundException('Site not found');

    const products = await this.prisma.product.findMany({
      include: {
        siteMappings: { where: { siteId: q.siteId }, take: 1 },
        parent: { select: { skuMaster: true } },
      },
      orderBy: { skuMaster: 'asc' },
    });

    type Row = {
      kind: 'HUB' | 'SITE_ONLY';
      linkStatus: 'LINKED' | 'NO_MAPPING' | 'PENDING' | 'NOT_SYNCED' | 'SITE_ONLY';
      productId?: string;
      hubSku?: string;
      hubName?: string;
      hubPrice?: string;
      hubStock?: number;
      productType?: string;
      parentSku?: string | null;
      siteSku?: string | null;
      siteTitle?: string | null;
      siteProductId?: string | null;
      matchStatus?: string | null;
      lastSyncedAt?: string | null;
      source?: string;
    };

    const hubRows: Row[] = products.map((p) => {
      const m = p.siteMappings[0];
      let linkStatus: Row['linkStatus'] = 'NO_MAPPING';
      if (m) {
        if (m.matchStatus === MatchStatus.PENDING_REVIEW) linkStatus = 'PENDING';
        else if (!m.siteProductId) linkStatus = 'NOT_SYNCED';
        else linkStatus = 'LINKED';
      }
      return {
        kind: 'HUB',
        linkStatus,
        productId: p.id,
        hubSku: p.skuMaster,
        hubName: p.name,
        hubPrice: p.basePrice.toString(),
        hubStock: p.totalStock,
        productType: (p as { productType?: string }).productType ?? 'SIMPLE',
        parentSku: (p.parent as { skuMaster?: string } | null)?.skuMaster ?? null,
        siteSku: m?.siteSku ?? null,
        siteTitle: m?.siteSpecificTitle ?? null,
        siteProductId: m?.siteProductId ?? null,
        matchStatus: m?.matchStatus ?? null,
        lastSyncedAt: m?.lastSyncedAt?.toISOString() ?? null,
      };
    });

    const orphans = await this.collectSiteNotInHub(q.siteId);
    const siteRows: Row[] = orphans.map((o) => ({
      kind: 'SITE_ONLY',
      linkStatus: 'SITE_ONLY',
      siteSku: o.siteSku,
      siteTitle: o.siteTitle,
      siteProductId: o.siteProductId,
      source: o.source,
    }));

    let all: Row[] = [...hubRows, ...siteRows];
    switch (q.filter) {
      case 'linked':
        all = hubRows.filter((r) => r.linkStatus === 'LINKED');
        break;
      case 'hub_only':
        all = hubRows.filter((r) => r.linkStatus === 'NO_MAPPING' || r.linkStatus === 'NOT_SYNCED');
        break;
      case 'site_only':
        all = siteRows;
        break;
      case 'pending':
        all = hubRows.filter((r) => r.linkStatus === 'PENDING');
        break;
      default:
        break;
    }

    const skip = (page - 1) * pageSize;
    return {
      site,
      data: all.slice(skip, skip + pageSize),
      total: all.length,
      page,
      pageSize,
      summary: {
        hubTotal: products.length,
        linked: hubRows.filter((r) => r.linkStatus === 'LINKED').length,
        hubOnly: hubRows.filter((r) => r.linkStatus !== 'LINKED').length,
        siteOnly: siteRows.length,
      },
    };
  }
}
