// Mirrors @prisma/client enums on the backend.
export type Role = 'ADMIN' | 'WAREHOUSE_STAFF' | 'VIEWER';
export type NetworkRoute = 'DIRECT' | 'VIA_FOREIGN_PROXY';
export type ProductType = 'SIMPLE' | 'VARIABLE' | 'VARIATION';

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

export interface ProductExpiryBatchRow {
  id: string;
  expiryDate: string;
  quantity: number;
}

export type ProductExpiryBatchInput = {
  expiryDate: string;
  quantity?: number;
};

export interface ProductRow {
  id: string;
  skuMaster: string;
  name: string;
  description: string | null;
  category: string | null;
  basePrice: string; // decimal serialized as string
  expiryDate: string | null;
  expiryBatches: ProductExpiryBatchRow[];
  totalStock: number | null;
  lowStockThreshold: number;
  imageUrl: string | null;
  hasHubPhoto: boolean;
  barcode: string | null;
  productType: ProductType;
  parentId: string | null;
  parentSku: string | null;
  parentName: string | null;
  variationAttributes: Record<string, string> | null;
  catalogKind?: 'HUB' | 'SITE';
  siteId?: string | null;
  siteName?: string | null;
  siteSku?: string | null;
  siteTitle?: string | null;
  siteProductId?: string | null;
  linkStatus?: string | null;
  rowKey?: string;
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
  productType?: ProductType;
  view?: 'hub' | 'site' | 'all';
  siteId?: string;
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
  expiryBatches?: ProductExpiryBatchInput[];
  totalStock?: number;
  lowStockThreshold?: number;
  imageUrl?: string;
  barcode?: string;
  productType?: ProductType;
  parentId?: string | null;
  variationAttributes?: Record<string, string> | null;
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
  orderPullEnabled: boolean;
  lastOrderPullAt: string | null;
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
  mappingRowCount?: number;
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
  orderPullEnabled?: boolean;
}

export interface UpdateScheduleResult {
  syncEnabled: boolean;
  syncIntervalMs: number;
  orderPullEnabled: boolean;
}

// ─── Orders (Phase 4: aggregated order book) ────────────────────────────────

export interface OrderRow {
  id: string;
  orderNumber: string;
  siteId: string;
  customerId: string | null;
  status: string;
  totalAmount: string;
  remoteOrderId: number | null;
  dateCreated: string | null;
  dateModified: string | null;
  currency: string | null;
  paymentMethod: string | null;
  discountTotal: string;
  shippingTotal: string;
  billingName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  createdAt: string;
  updatedAt: string;
  site?: { id: string; name: string } | null;
  customer?: { id: string; name: string; email: string | null } | null;
}

export interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string | null;
  quantity: number;
  unitPrice: string;
  remoteLineId: string | null;
  siteSku: string | null;
  lineName: string | null;
  product?: { id: string; skuMaster: string; name: string } | null;
}

export interface OrderDetail extends OrderRow {
  items: OrderItemRow[];
  site?: { id: string; name: string; baseUrl: string } | null;
  customer?: { id: string; name: string; email: string | null; phone: string | null } | null;
}

export interface PaginatedOrders {
  data: OrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListOrdersQuery {
  siteId?: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

// ─── Manual logistics orders ───────────────────────────────────────────────

export type LogisticsOrderStatus = 'SENT' | 'NEED_PRODUCT' | 'CANCELED';

export interface LogisticsEmployee {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface LogisticsOrderItemRow {
  id: string;
  logisticsOrderId: string;
  productId: string;
  quantity: number;
  productName: string;
  skuMaster: string;
  product?: Pick<ProductRow, 'id' | 'name' | 'skuMaster' | 'barcode'>;
}

export interface LogisticsOrderRow {
  id: string;
  orderNumber: string;
  receiverName: string;
  phone: string;
  city: string;
  status: LogisticsOrderStatus;
  createdByUserId: string | null;
  employeeId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items: LogisticsOrderItemRow[];
  createdBy?: { id: string; fullName: string; email: string } | null;
  employee?: { id: string; fullName: string; email: string; role: Role } | null;
}

export interface PaginatedLogisticsOrders {
  data: LogisticsOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListLogisticsOrdersQuery {
  status?: LogisticsOrderStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateLogisticsOrderPayload {
  employeeId: string;
  receiverName: string;
  phone: string;
  city: string;
  status: LogisticsOrderStatus;
  items: Array<{ productId: string; quantity: number }>;
}

// ─── Dashboard (Phase 4: backend-aggregated summary) ────────────────────────

export interface DashboardKpis {
  totalProducts: number;
  lowStockCount: number;
  totalSites: number;
  activeSites: number;
  totalOrders: number;
  ordersLast30d: number;
  inventoryUnits: number;
  inventoryValue: string;
  ordersToday: number;
  revenueToday: string;
  expiringSoonCount: number;
  pendingMappingReviews: number;
  failedSyncCount: number;
  duplicateOnSiteCount: number;
  activeAlerts: number;
}

export interface DashboardAlertBreakdown {
  lowStock: number;
  expiringSoon: number;
  failedSyncs: number;
  pendingMappingReviews: number;
  duplicateOnSite: number;
}

export interface RevenueSeriesPoint {
  day: string;
  revenue: string;
  orders: number;
}

export interface StatusBreakdownPoint {
  status: string;
  count: number;
}

export interface TopProductPoint {
  productId: string | null;
  skuMaster: string | null;
  name: string | null;
  quantity: number;
  revenue: string;
}

export interface LowStockProduct {
  id: string;
  skuMaster: string;
  name: string;
  totalStock: number;
  lowStockThreshold: number;
  category: string | null;
}

export interface RecentOrderPoint {
  id: string;
  orderNumber: string;
  siteId: string;
  siteName: string;
  status: string;
  totalAmount: string;
  dateCreated: string;
}

export interface ExpiringProductPoint {
  id: string;
  skuMaster: string;
  name: string;
  totalStock: number;
  expiryDate: string | null;
}

export interface LatestSyncPoint {
  siteId: string;
  siteName: string;
  syncType: string;
  status: string;
  createdAt: string;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  alertBreakdown: DashboardAlertBreakdown;
  revenueSeries: RevenueSeriesPoint[];
  statusBreakdown: StatusBreakdownPoint[];
  logisticsStatusCounts: Record<LogisticsOrderStatus, number>;
  topProducts: TopProductPoint[];
  lowStockProducts: LowStockProduct[];
  expiringSoonProducts: ExpiringProductPoint[];
  latestSyncs: LatestSyncPoint[];
  recentOrders: RecentOrderPoint[];
  since: string;
}

export interface EnqueuePullResult {
  id: string;
  status: SyncJobStatus;
  queued: boolean;
}

// ─── Matching (Phase 5: AI product matching) ────────────────────────────────

export type MatchStatus = 'PENDING_REVIEW' | 'APPROVED' | 'MANUAL';

export interface MappingSuggestionRow {
  id: string;
  productId: string;
  siteId: string;
  siteSku: string | null;
  siteProductId: string | null;
  siteSpecificTitle: string | null;
  matchConfidence: number | null;
  matchAiReasoning: string | null;
  matchStatus: MatchStatus;
  product: { skuMaster: string; name: string };
  site: { name: string };
}

export interface PaginatedMappingSuggestions {
  data: MappingSuggestionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MatchingPreview {
  jobId: string;
  fileName: string;
  status: string;
  totalRows: number;
  suggestedCount: number;
  reviewCount: number;
  rejectedCount: number;
  aiReviewCount: number;
  errors: { row: number; message: string }[];
  suggestions: {
    row: number;
    siteTitle: string;
    skuMaster: string;
    hubName: string;
    matchConfidence: number;
    tier: string;
    matchAiReasoning?: string;
    mappingId?: string;
  }[];
}

export interface HubNotOnSiteRow {
  productId: string;
  skuMaster: string;
  name: string;
  siteId: string;
  siteName: string;
  reason: 'NO_MAPPING' | 'NOT_SYNCED' | 'PENDING_REVIEW';
}

export interface SiteNotInHubRow {
  siteId: string;
  siteName: string;
  siteSku: string | null;
  siteTitle: string;
  siteProductId: string | null;
  source: 'ORDER' | 'UPLOAD';
  orderCount?: number;
}

export interface MatchingGapsResult {
  hubNotOnSite: PaginatedReport<HubNotOnSiteRow>;
  siteNotInHub: PaginatedReport<SiteNotInHubRow>;
  summary: { hubNotOnSiteTotal: number; siteNotInHubTotal: number };
}

export type CompareLinkStatus =
  | 'LINKED'
  | 'NO_MAPPING'
  | 'PENDING'
  | 'NOT_SYNCED'
  | 'SITE_ONLY';

export interface ProductCompareRow {
  kind: 'HUB' | 'SITE_ONLY';
  linkStatus: CompareLinkStatus;
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
}

export interface ProductCompareResult {
  site: { id: string; name: string };
  data: ProductCompareRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    hubTotal: number;
    linked: number;
    hubOnly: number;
    siteOnly: number;
  };
}

export interface DuplicateWarnings {
  siteSkuDuplicates: {
    siteId: string;
    siteName: string;
    siteSku: string;
    count: number;
    productIds: string[];
  }[];
  siteProductIdDuplicates: {
    siteId: string;
    siteName: string;
    siteProductId: string;
    count: number;
    productIds: string[];
  }[];
  hubBarcodeDuplicates: { barcode: string; count: number; skus: string[] }[];
  total: number;
}

export interface AuditLogRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userFullName: string | null;
  action: string;
  target: string | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  data: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Reports (Phase 6) ───────────────────────────────────────────────────────

export interface PaginatedReport<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InventoryReportRow {
  id: string;
  skuMaster: string;
  name: string;
  category: string | null;
  basePrice: string;
  totalStock: number;
  lowStockThreshold: number;
  expiryDate: string | null;
  isLowStock: boolean;
}

export interface InventoryReportQuery {
  category?: string;
  siteId?: string;
  lowStockOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ExpiryReportRow {
  id: string;
  skuMaster: string;
  name: string;
  category: string | null;
  totalStock: number;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
}

export interface ExpiryReportQuery {
  days?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export type SalesGroupBy = 'site' | 'product' | 'day';

export interface SalesReportQuery {
  siteId?: string;
  dateFrom?: string;
  dateTo?: string;
  productId?: string;
  groupBy?: SalesGroupBy;
  page?: number;
  pageSize?: number;
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

export interface SalesReportResult {
  groupBy: SalesGroupBy;
  data: SalesSiteRow[] | SalesProductRow[] | SalesDayRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: {
    siteId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    productId: string | null;
  };
}

export interface SyncReportRow {
  id: string;
  siteId: string;
  siteName: string;
  syncType: string;
  status: string;
  details: unknown;
  createdAt: string;
}

export interface SyncReportQuery {
  siteId?: string;
  syncType?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface CustomerReportRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  siteId: string | null;
  siteName: string | null;
  totalOrdersCount: number;
  totalSpent: string;
  createdAt: string;
}

export interface CustomersReportQuery {
  siteId?: string;
  search?: string;
  sortBy?: 'name' | 'totalOrdersCount' | 'totalSpent' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}
