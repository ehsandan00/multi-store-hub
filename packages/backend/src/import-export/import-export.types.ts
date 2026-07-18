/**
 * Shared types for the Excel import/export module (Phase 2).
 *
 * The validation/preview/commit pipeline is:
 *   1. parseWorkbook()  → raw rows from the xlsx
 *   2. validateRows()   → classify each row as new/update/error by sku_master
 *   3. persist ImportJob(status=PREVIEW) with the validated rows + summary
 *   4. user reviews preview → POST commit → BullMQ job → applyCommit()
 *   5. ImportJob updated to COMPLETED with a final report
 */

import type { ImportJobStatus, ProductType } from '@prisma/client';

export type ImportJobKind = 'PRODUCT_IMPORT';

export interface RawImportRow {
  row: number; // 1-based, header row excluded; matches the spreadsheet row number for diagnostics
  skuMaster?: string;
  name?: string;
  category?: string;
  basePrice?: string | number;
  totalStock?: string | number;
  lowStockThreshold?: string | number;
  expiryDate?: string;
  barcode?: string;
  imageUrl?: string;
  description?: string;
  productType?: string;
  parentSku?: string;
  variationAttributes?: string;
  /** Site SKU overrides keyed by site name, e.g. { "Store IR": "IR-SKU-1" } */
  siteSkus?: Record<string, string>;
}

export interface RawSiteMappingRow {
  row: number;
  skuMaster?: string;
  siteName?: string;
  siteSku?: string;
  siteProductId?: string;
  siteSpecificTitle?: string;
  matchStatus?: string;
}

export interface ValidatedSiteMappingRow {
  row: number;
  skuMaster: string;
  siteName: string;
  siteSku?: string | null;
  siteProductId?: string | null;
  siteSpecificTitle?: string | null;
  matchStatus?: string | null;
}

export interface ValidatedImportRow {
  row: number;
  skuMaster: string;
  name?: string;
  category?: string | null;
  basePrice?: number;
  totalStock?: number;
  lowStockThreshold?: number;
  expiryDate?: string | null; // ISO date string
  barcode?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  productType?: ProductType;
  parentSku?: string | null;
  variationAttributes?: Record<string, string> | null;
  siteSkus?: Record<string, string>;
  /** "create" | "update" — resolved against current DB state at preview time */
  action: 'create' | 'update';
  productId?: string; // present when action=update
}

export interface ImportError {
  row: number;
  sku?: string;
  message: string;
}

export interface ImportPreview {
  jobId: string;
  fileName: string;
  status: ImportJobStatus;
  totalRows: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
  mappingRowCount?: number;
  errors: ImportError[];
  /** Sample of validated rows (first N) for UI display; full set stored on the job. */
  rowsPreview: ValidatedImportRow[];
}

export interface ImportReport {
  created: number;
  updated: number;
  failed: number;
  errors: ImportError[];
  startedAt: string;
  finishedAt: string;
}

export interface ExportFilters {
  category?: string;
  siteId?: string;
  minStock?: number;
  maxStock?: number;
}

export const IMPORT_QUEUE_NAME = 'product-import';
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const IMPORT_PREVIEW_ROW_SAMPLE = 25;
