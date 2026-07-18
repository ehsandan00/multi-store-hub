import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CustomersReportQuery,
  ExpiryReportQuery,
  InventoryReportQuery,
  SalesReportQuery,
  SyncReportQuery,
} from './reports.dto';

const EXPORT_ROW_CAP = 10_000;

/**
 * Phase 6 reporting: inventory, expiry, sales, sync history, and customers.
 * JSON endpoints power the admin Reports page; `.xlsx` siblings export the
 * same filtered dataset via ExcelJS (same library as import/export).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Inventory ─────────────────────────────────────────────────────────────

  async inventory(q: InventoryReportQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const { whereSql, params } = this.inventoryWhere(q);

    const countRows = await this.prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM "Product" p WHERE ${whereSql}`,
      ...params,
    );
    const total = countRows[0]?.c ?? 0;

    const rows = await this.prisma.$queryRawUnsafe<InventoryRow[]>(
      `SELECT p.id, p."skuMaster", p.name, p.category, p."basePrice"::text AS "basePrice",
              p."totalStock", p."lowStockThreshold", p."expiryDate"
       FROM "Product" p
       WHERE ${whereSql}
       ORDER BY p."totalStock" ASC, p.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );

    return {
      data: rows.map((r) => ({
        ...r,
        isLowStock: r.totalStock <= r.lowStockThreshold,
        expiryDate: r.expiryDate?.toISOString?.() ?? (r.expiryDate as unknown as string | null),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async inventoryXlsx(q: InventoryReportQuery): Promise<Buffer> {
    const { whereSql, params } = this.inventoryWhere(q);
    const rows = await this.prisma.$queryRawUnsafe<InventoryRow[]>(
      `SELECT p.id, p."skuMaster", p.name, p.category, p."basePrice"::text AS "basePrice",
              p."totalStock", p."lowStockThreshold", p."expiryDate"
       FROM "Product" p
       WHERE ${whereSql}
       ORDER BY p."totalStock" ASC, p.name ASC
       LIMIT $${params.length + 1}`,
      ...params,
      EXPORT_ROW_CAP,
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventory');
    ws.columns = [
      { header: 'sku_master', key: 'skuMaster', width: 16 },
      { header: 'name', key: 'name', width: 32 },
      { header: 'category', key: 'category', width: 16 },
      { header: 'base_price', key: 'basePrice', width: 12 },
      { header: 'total_stock', key: 'totalStock', width: 12 },
      { header: 'low_stock_threshold', key: 'lowStockThreshold', width: 18 },
      { header: 'low_stock', key: 'lowStock', width: 10 },
      { header: 'expiry_date', key: 'expiryDate', width: 14 },
    ];
    styleHeader(ws);
    for (const r of rows) {
      ws.addRow({
        skuMaster: r.skuMaster,
        name: r.name,
        category: r.category ?? '',
        basePrice: r.basePrice,
        totalStock: r.totalStock,
        lowStockThreshold: r.lowStockThreshold,
        lowStock: r.totalStock <= r.lowStockThreshold ? 'yes' : 'no',
        expiryDate: r.expiryDate ? new Date(r.expiryDate as Date).toISOString().slice(0, 10) : '',
      });
    }
    return workbookBuffer(wb);
  }

  private inventoryWhere(q: InventoryReportQuery) {
    const parts = ['1=1'];
    const params: unknown[] = [];
    if (q.category) {
      params.push(q.category);
      parts.push(`p.category = $${params.length}`);
    }
    if (q.siteId) {
      params.push(q.siteId);
      parts.push(
        `EXISTS (SELECT 1 FROM "SiteProductMapping" m WHERE m."productId" = p.id AND m."siteId" = $${params.length})`,
      );
    }
    if (q.lowStockOnly) {
      parts.push(`p."totalStock" <= p."lowStockThreshold"`);
    }
    return { whereSql: parts.join(' AND '), params };
  }

  // ─── Expiry ────────────────────────────────────────────────────────────────

  async expiry(q: ExpiryReportQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const { from, to } = this.expiryRange(q);

    const where: Prisma.ProductWhereInput = {
      expiryDate: { gte: from, lte: to },
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { expiryDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          skuMaster: true,
          name: true,
          category: true,
          totalStock: true,
          expiryDate: true,
        },
      }),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        expiryDate: r.expiryDate?.toISOString() ?? null,
        daysUntilExpiry: r.expiryDate
          ? Math.ceil((r.expiryDate.getTime() - Date.now()) / 86_400_000)
          : null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
    };
  }

  async expiryXlsx(q: ExpiryReportQuery): Promise<Buffer> {
    const { from, to } = this.expiryRange(q);
    const rows = await this.prisma.product.findMany({
      where: { expiryDate: { gte: from, lte: to } },
      orderBy: { expiryDate: 'asc' },
      take: EXPORT_ROW_CAP,
      select: {
        skuMaster: true,
        name: true,
        category: true,
        totalStock: true,
        expiryDate: true,
      },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Expiry');
    ws.columns = [
      { header: 'sku_master', key: 'skuMaster', width: 16 },
      { header: 'name', key: 'name', width: 32 },
      { header: 'category', key: 'category', width: 16 },
      { header: 'total_stock', key: 'totalStock', width: 12 },
      { header: 'expiry_date', key: 'expiryDate', width: 14 },
      { header: 'days_until', key: 'daysUntil', width: 12 },
    ];
    styleHeader(ws);
    for (const r of rows) {
      const days = r.expiryDate
        ? Math.ceil((r.expiryDate.getTime() - Date.now()) / 86_400_000)
        : '';
      ws.addRow({
        skuMaster: r.skuMaster,
        name: r.name,
        category: r.category ?? '',
        totalStock: r.totalStock,
        expiryDate: r.expiryDate?.toISOString().slice(0, 10) ?? '',
        daysUntil: days,
      });
    }
    return workbookBuffer(wb);
  }

  private expiryRange(q: ExpiryReportQuery) {
    if (q.dateFrom && q.dateTo) {
      return { from: new Date(q.dateFrom), to: new Date(q.dateTo) };
    }
    const days = q.days ?? 30;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  // ─── Sales ─────────────────────────────────────────────────────────────────

  async sales(q: SalesReportQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const groupBy = q.groupBy ?? 'site';
    const { clauses, params } = this.salesFilters(q);

    if (groupBy === 'site') {
      return this.salesBySite(q, page, pageSize, clauses, params);
    }
    if (groupBy === 'product') {
      return this.salesByProduct(q, page, pageSize, clauses, params);
    }
    return this.salesByDay(q, page, pageSize, clauses, params);
  }

  private async salesBySite(
    q: SalesReportQuery,
    page: number,
    pageSize: number,
    clauses: string[],
    params: unknown[],
  ) {
    const countRows = await this.prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM (
         SELECT o."siteId"
         FROM "Order" o
         WHERE ${clauses.join(' AND ')}
         GROUP BY o."siteId"
       ) sub`,
      ...params,
    );
    const total = countRows[0]?.c ?? 0;
    const rows = await this.prisma.$queryRawUnsafe<SalesSiteRow[]>(
      `SELECT o."siteId", s.name AS "siteName",
              COUNT(*)::int AS "orderCount",
              COALESCE(SUM(o."totalAmount"), 0)::text AS revenue
       FROM "Order" o
       JOIN "SiteConfig" s ON s.id = o."siteId"
       WHERE ${clauses.join(' AND ')}
       GROUP BY o."siteId", s.name
       ORDER BY revenue DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    return this.salesResult(rows, total, page, pageSize, q, 'site');
  }

  private async salesByProduct(
    q: SalesReportQuery,
    page: number,
    pageSize: number,
    clauses: string[],
    params: unknown[],
  ) {
    const countRows = await this.prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM (
         SELECT oi."productId"
         FROM "OrderItem" oi
         JOIN "Order" o ON o.id = oi."orderId"
         WHERE ${clauses.join(' AND ')} AND oi."productId" IS NOT NULL
         GROUP BY oi."productId"
       ) sub`,
      ...params,
    );
    const total = countRows[0]?.c ?? 0;
    const rows = await this.prisma.$queryRawUnsafe<SalesProductRow[]>(
      `SELECT oi."productId", p."skuMaster", p.name AS "productName",
              COUNT(DISTINCT o.id)::int AS "orderCount",
              COALESCE(SUM(oi.quantity), 0)::int AS "unitsSold",
              COALESCE(SUM(oi.quantity * oi."unitPrice"), 0)::text AS revenue
       FROM "OrderItem" oi
       JOIN "Order" o ON o.id = oi."orderId"
       LEFT JOIN "Product" p ON p.id = oi."productId"
       WHERE ${clauses.join(' AND ')} AND oi."productId" IS NOT NULL
       GROUP BY oi."productId", p."skuMaster", p.name
       ORDER BY revenue DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    return this.salesResult(rows, total, page, pageSize, q, 'product');
  }

  private async salesByDay(
    q: SalesReportQuery,
    page: number,
    pageSize: number,
    clauses: string[],
    params: unknown[],
  ) {
    const countRows = await this.prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM (
         SELECT date_trunc('day', o."dateCreated")
         FROM "Order" o
         WHERE ${clauses.join(' AND ')}
         GROUP BY 1
       ) sub`,
      ...params,
    );
    const total = countRows[0]?.c ?? 0;
    const rows = await this.prisma.$queryRawUnsafe<SalesDayRow[]>(
      `SELECT to_char(date_trunc('day', o."dateCreated"), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS "orderCount",
              COALESCE(SUM(o."totalAmount"), 0)::text AS revenue
       FROM "Order" o
       WHERE ${clauses.join(' AND ')}
       GROUP BY day
       ORDER BY day ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
    return this.salesResult(rows, total, page, pageSize, q, 'day');
  }

  private salesResult<T>(
    data: T[],
    total: number,
    page: number,
    pageSize: number,
    q: SalesReportQuery,
    groupBy: 'site' | 'product' | 'day',
  ) {
    return {
      groupBy,
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      filters: {
        siteId: q.siteId ?? null,
        dateFrom: q.dateFrom ?? null,
        dateTo: q.dateTo ?? null,
        productId: q.productId ?? null,
      },
    };
  }

  private salesFilters(q: SalesReportQuery) {
    const clauses = ['o."dateCreated" IS NOT NULL'];
    const params: unknown[] = [];
    if (q.siteId) {
      params.push(q.siteId);
      clauses.push(`o."siteId" = $${params.length}`);
    }
    if (q.dateFrom) {
      params.push(q.dateFrom);
      clauses.push(`o."dateCreated" >= $${params.length}`);
    }
    if (q.dateTo) {
      params.push(q.dateTo);
      clauses.push(`o."dateCreated" <= $${params.length}`);
    }
    if (q.productId) {
      params.push(q.productId);
      clauses.push(
        `EXISTS (SELECT 1 FROM "OrderItem" oi2 WHERE oi2."orderId" = o.id AND oi2."productId" = $${params.length})`,
      );
    }
    return { clauses, params };
  }

  async salesXlsx(q: SalesReportQuery): Promise<Buffer> {
    const full = await this.sales({ ...q, page: 1, pageSize: EXPORT_ROW_CAP });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sales');
    if (full.groupBy === 'site') {
      ws.columns = [
        { header: 'site', key: 'siteName', width: 24 },
        { header: 'orders', key: 'orderCount', width: 10 },
        { header: 'revenue', key: 'revenue', width: 14 },
      ];
      styleHeader(ws);
      for (const r of full.data as SalesSiteRow[]) {
        ws.addRow({ siteName: r.siteName, orderCount: r.orderCount, revenue: r.revenue });
      }
    } else if (full.groupBy === 'product') {
      ws.columns = [
        { header: 'sku_master', key: 'skuMaster', width: 16 },
        { header: 'product', key: 'productName', width: 32 },
        { header: 'orders', key: 'orderCount', width: 10 },
        { header: 'units_sold', key: 'unitsSold', width: 12 },
        { header: 'revenue', key: 'revenue', width: 14 },
      ];
      styleHeader(ws);
      for (const r of full.data as SalesProductRow[]) {
        ws.addRow(r);
      }
    } else {
      ws.columns = [
        { header: 'day', key: 'day', width: 14 },
        { header: 'orders', key: 'orderCount', width: 10 },
        { header: 'revenue', key: 'revenue', width: 14 },
      ];
      styleHeader(ws);
      for (const r of full.data as SalesDayRow[]) {
        ws.addRow(r);
      }
    }
    return workbookBuffer(wb);
  }

  // ─── Sync history ──────────────────────────────────────────────────────────

  async syncHistory(q: SyncReportQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const where = this.syncWhere(q);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.syncLog.count({ where }),
      this.prisma.syncLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { site: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        siteName: r.site.name,
        syncType: r.syncType,
        status: r.status,
        details: r.details,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async syncHistoryXlsx(q: SyncReportQuery): Promise<Buffer> {
    const where = this.syncWhere(q);
    const rows = await this.prisma.syncLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_CAP,
      include: { site: { select: { name: true } } },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sync');
    ws.columns = [
      { header: 'timestamp', key: 'createdAt', width: 22 },
      { header: 'site', key: 'siteName', width: 24 },
      { header: 'sync_type', key: 'syncType', width: 18 },
      { header: 'status', key: 'status', width: 12 },
    ];
    styleHeader(ws);
    for (const r of rows) {
      ws.addRow({
        createdAt: r.createdAt.toISOString(),
        siteName: r.site.name,
        syncType: r.syncType,
        status: r.status,
      });
    }
    return workbookBuffer(wb);
  }

  private syncWhere(q: SyncReportQuery): Prisma.SyncLogWhereInput {
    const where: Prisma.SyncLogWhereInput = {};
    if (q.siteId) where.siteId = q.siteId;
    if (q.syncType) where.syncType = q.syncType;
    if (q.status) where.status = q.status;
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(q.dateFrom);
      if (q.dateTo) where.createdAt.lte = new Date(q.dateTo);
    }
    return where;
  }

  // ─── Customers ─────────────────────────────────────────────────────────────

  async customers(q: CustomersReportQuery) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 500);
    const sortBy = q.sortBy ?? 'totalSpent';
    const sortDir = q.sortDir ?? 'desc';
    const where: Prisma.CustomerWhereInput = {};
    if (q.siteId) where.siteId = q.siteId;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.CustomerOrderByWithRelationInput = { [sortBy]: sortDir };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { site: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        siteId: c.siteId,
        siteName: c.site?.name ?? null,
        totalOrdersCount: c.totalOrdersCount,
        totalSpent: c.totalSpent.toString(),
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async customersXlsx(q: CustomersReportQuery): Promise<Buffer> {
    const full = await this.customers({ ...q, page: 1, pageSize: EXPORT_ROW_CAP });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Customers');
    ws.columns = [
      { header: 'name', key: 'name', width: 28 },
      { header: 'email', key: 'email', width: 28 },
      { header: 'phone', key: 'phone', width: 16 },
      { header: 'site', key: 'siteName', width: 20 },
      { header: 'orders', key: 'totalOrdersCount', width: 10 },
      { header: 'total_spent', key: 'totalSpent', width: 14 },
    ];
    styleHeader(ws);
    for (const r of full.data) {
      ws.addRow(r);
    }
    return workbookBuffer(wb);
  }
}

interface InventoryRow {
  id: string;
  skuMaster: string;
  name: string;
  category: string | null;
  basePrice: string;
  totalStock: number;
  lowStockThreshold: number;
  expiryDate: Date | null;
}

export interface SalesSiteRow {
  siteId: string;
  siteName: string;
  orderCount: number;
  revenue: string;
}

export interface SalesProductRow {
  productId: string;
  skuMaster: string | null;
  productName: string | null;
  orderCount: number;
  unitsSold: number;
  revenue: string;
}

export interface SalesDayRow {
  day: string;
  orderCount: number;
  revenue: string;
}

function styleHeader(ws: ExcelJS.Worksheet): void {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
}

async function workbookBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
