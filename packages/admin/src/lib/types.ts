// Mirrors @prisma/client enums on the backend.
export type Role = 'ADMIN' | 'WAREHOUSE_STAFF' | 'VIEWER';
export type NetworkRoute = 'DIRECT' | 'VIA_FOREIGN_PROXY';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRow {
  id: string;
  skuMaster: string;
  name: string;
  description: string | null;
  category: string | null;
  basePrice: string; // decimal serialized as string
  expiryDate: string | null;
  totalStock: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  barcode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedProducts {
  data: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListProductsQuery {
  search?: string;
  category?: string;
  lowStock?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateProductPayload {
  skuMaster: string;
  name: string;
  description?: string;
  category?: string;
  basePrice: number;
  expiryDate?: string | null;
  totalStock?: number;
  lowStockThreshold?: number;
  imageUrl?: string;
  barcode?: string;
}

export type UpdateProductPayload = Partial<Omit<CreateProductPayload, 'skuMaster'>> & {
  skuMaster?: never;
};

export interface InventoryLog {
  id: string;
  productId: string;
  changeAmount: number;
  reason: 'SALE' | 'MANUAL_ADJUSTMENT' | 'IMPORT' | 'SYNC';
  sourceSiteId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface SafeSite {
  id: string;
  name: string;
  baseUrl: string;
  consumerKeyMasked: string;
  consumerSecretMasked: string;
  networkRoute: NetworkRoute;
  isActive: boolean;
  syncEnabled: boolean;
  syncIntervalMs: number;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSites {
  data: SafeSite[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSitePayload {
  name: string;
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  networkRoute?: NetworkRoute;
  isActive?: boolean;
  syncEnabled?: boolean;
  syncIntervalMs?: number;
}

export type UpdateSitePayload = Partial<Omit<CreateSitePayload, 'name'>> & {
  name?: string;
};

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  routeUsed: NetworkRoute;
  attempts: number;
  status?: number;
  error?: { code: string; message: string };
}

export interface CreateUserPayload {
  email: string;
  password: string;
  fullName: string;
  role?: Role;
}

export interface UpdateUserPayload {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
  details?: unknown;
}

// ─── Import / Export (Phase 2) ───────────────────────────────────────────────

export type ImportJobStatus = 'PREVIEW' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ImportError {
  row: number;
  sku?: string;
  message: string;
}

export interface ValidatedImportRow {
  row: number;
  skuMaster: string;
  name?: string;
  category?: string | null;
  basePrice?: number;
  totalStock?: number;
  lowStockThreshold?: number;
  expiryDate?: string | null;
  barcode?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  siteSkus?: Record<string, string>;
  action: 'create' | 'update';
  productId?: string;
}

export interface ImportPreview {
  jobId: string;
  fileName: string;
  status: ImportJobStatus;
  totalRows: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
  errors: ImportError[];
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

export interface ImportJob {
  id: string;
  kind: string;
  status: ImportJobStatus;
  fileName: string;
  totalRows: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  errors: ImportError[] | null;
  rows: unknown;
  report: ImportReport | null;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  user?: { email: string; fullName: string } | null;
}

export interface PaginatedImportJobs {
  data: ImportJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExportFilters {
  category?: string;
  siteId?: string;
  minStock?: number;
  maxStock?: number;
}

// ─── Sync (Phase 3: WooCommerce hub → site) ─────────────────────────────────

export type SyncJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type SyncDirection = 'PUSH' | 'PULL';
export type SyncScope = 'ALL' | 'MAPPING' | 'PRODUCT_IDS';

export interface SyncItemError {
  sku: string;
  message: string;
  code?: string;
  statusCode?: number;
}

export interface SyncReport {
  pushed: number;
  failed: number;
  created: number;
  updated: number;
  errors: SyncItemError[];
  startedAt: string;
  finishedAt: string;
  routeUsed: string;
}

export interface SyncJob {
  id: string;
  siteId: string;
  direction: SyncDirection;
  status: SyncJobStatus;
  scope: SyncScope;
  totalItems: number;
  pushedCount: number;
  failedCount: number;
  errors: SyncItemError[] | null;
  payload: { productIds?: string[] } | null;
  report: SyncReport | null;
  createdByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  site?: { name: string } | null;
}

export interface PaginatedSyncJobs {
  data: SyncJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SyncLogRow {
  id: string;
  siteId: string;
  syncType: string;
  status: 'success' | 'failed' | 'partial';
  details: unknown;
  createdAt: string;
  site?: { name: string } | null;
}

export interface PaginatedSyncLogs {
  data: SyncLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EnqueuePushResult {
  id: string;
  status: SyncJobStatus;
  queued: boolean;
}

export interface UpdateSchedulePayload {
  syncEnabled?: boolean;
  syncIntervalMs?: number;
}

export interface UpdateScheduleResult {
  syncEnabled: boolean;
  syncIntervalMs: number;
}
