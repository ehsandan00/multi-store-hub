import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type {
  ApiError,
  LoginResult,
  PaginatedProducts,
  PaginatedSites,
  SafeSite,
  SafeUser,
  TestConnectionResult,
  ProductRow,
  InventoryLog,
  CreateProductPayload,
  UpdateProductPayload,
  CreateSitePayload,
  UpdateSitePayload,
  CreateUserPayload,
  UpdateUserPayload,
  ListProductsQuery,
  ImportPreview,
  ImportJob,
  PaginatedImportJobs,
  ExportFilters,
  SyncScope,
  AspNetDryRunReport,
  EnqueuePushResult,
  EnqueuePullResult,
  UpdateSchedulePayload,
  UpdateScheduleResult,
  SyncJob,
  PaginatedSyncJobs,
  PaginatedSyncLogs,
  OrderDetail,
  PaginatedOrders,
  ListOrdersQuery,
  CreateLogisticsOrderPayload,
  ListLogisticsOrdersQuery,
  LogisticsOrderRow,
  LogisticsOrderStatus,
  LogisticsEmployee,
  PaginatedLogisticsOrders,
  DashboardSummary,
  MatchingPreview,
  MatchingGapsResult,
  ProductCompareResult,
  DuplicateWarnings,
  PaginatedMappingSuggestions,
  PaginatedAuditLogs,
  MatchStatus,
  InventoryReportQuery,
  PaginatedReport,
  InventoryReportRow,
  ExpiryReportQuery,
  ExpiryReportRow,
  SalesReportQuery,
  SalesReportResult,
  SyncReportQuery,
  SyncReportRow,
  CustomersReportQuery,
  CustomerReportRow,
  ListCustomersQuery,
  PaginatedCustomers,
  CrossSiteDuplicatesResult,
  EnqueueCustomerPullResult,
} from './types';
import { useAuthStore } from './auth-store';

// In dev, call the NestJS API directly (CORS_ORIGIN in backend .env must include
// the admin origin). On a phone/LAN test, use the same host as the admin page.
// In production, set VITE_API_URL to `/api` (nginx rewrite) or the public API URL.
function resolveDevBaseURL(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  const { hostname } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return `http://${hostname}:3001`;
  }
  return 'http://127.0.0.1:3001';
}

const baseURL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? resolveDevBaseURL() : '/api');

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// ─── Request interceptor: attach access token ────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken && !config.headers?.Authorization) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// ─── Response interceptor: 401 → try refresh once, else logout ───────────────
let refreshing: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const { refreshToken, setTokens, clear } = useAuthStore.getState();
  if (!refreshToken) {
    clear();
    return false;
  }
  try {
    const res = await axios.post<LoginResult>(
      `${baseURL}/auth/refresh`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' } },
    );
    setTokens(res.data.accessToken, res.data.refreshToken);
    return true;
  } catch {
    clear();
    return false;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as
      (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;

    // Skip refresh for /auth/* endpoints (avoid infinite loop on bad login)
    const isAuthEndpoint = original?.url?.includes('/auth/');

    if (status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      refreshing = refreshing ?? refreshAccessToken();
      const ok = await refreshing;
      refreshing = null;
      if (ok) {
        const accessToken = useAuthStore.getState().accessToken;
        original.headers!.Authorization = `Bearer ${accessToken}`;
        return api.request(original);
      }
    }
    return Promise.reject(error);
  },
);

export function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError<ApiError>(err)) {
    return (
      err.response?.data ?? {
        statusCode: err.response?.status ?? 0,
        message: err.message,
      }
    );
  }
  return { statusCode: 0, message: (err as Error)?.message ?? 'Unknown error' };
}

function normalizeProduct(p: ProductRow): ProductRow {
  return {
    ...p,
    expiryBatches: p.expiryBatches ?? [],
    hasHubPhoto: p.hasHubPhoto ?? false,
    productType: p.productType ?? 'SIMPLE',
    parentId: p.parentId ?? null,
    parentSku: p.parentSku ?? null,
    parentName: p.parentName ?? null,
    variationAttributes: p.variationAttributes ?? null,
  };
}

function normalizeProductsPage(page: PaginatedProducts): PaginatedProducts {
  return { ...page, data: page.data.map(normalizeProduct) };
}

// ─── API namespaces ───────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResult>('/auth/login', { email, password }).then((r) => r.data),
  refresh: (refreshToken: string) =>
    api.post<LoginResult>('/auth/refresh', { refreshToken }).then((r) => r.data),
  me: () => api.get<SafeUser>('/auth/me').then((r) => r.data),
};

export const productsApi = {
  list: (q: ListProductsQuery = {}) =>
    api
      .get<PaginatedProducts>('/products', { params: q })
      .then((r) => normalizeProductsPage(r.data)),
  categories: () => api.get<string[]>('/products/categories').then((r) => r.data),
  get: (id: string) => api.get<ProductRow>(`/products/${id}`).then((r) => normalizeProduct(r.data)),
  inventoryHistory: (id: string) =>
    api.get<InventoryLog[]>(`/products/${id}/inventory-history`).then((r) => r.data),
  create: (p: CreateProductPayload) =>
    api.post<ProductRow>('/products', p).then((r) => normalizeProduct(r.data)),
  update: (id: string, p: UpdateProductPayload) =>
    api.patch<ProductRow>(`/products/${id}`, p).then((r) => normalizeProduct(r.data)),
  remove: (id: string) => api.delete(`/products/${id}`).then((r) => r.data),
  hubPhotoBlob: (id: string) =>
    api.get<Blob>(`/products/${id}/hub-photo`, { responseType: 'blob' }).then((r) => r.data),
  uploadHubPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return api
      .post<ProductRow>(`/products/${id}/hub-photo`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => normalizeProduct(r.data));
  },
  removeHubPhoto: (id: string) =>
    api.delete<ProductRow>(`/products/${id}/hub-photo`).then((r) => normalizeProduct(r.data)),
  lookup: (code: string) =>
    api
      .get<ProductRow>('/products/lookup', { params: { code } })
      .then((r) => normalizeProduct(r.data)),
};

export const sitesApi = {
  list: (page = 1, pageSize = 100) =>
    api.get<PaginatedSites>('/sites', { params: { page, pageSize } }).then((r) => r.data),
  get: (id: string) => api.get<SafeSite>(`/sites/${id}`).then((r) => r.data),
  create: (p: CreateSitePayload) => api.post<SafeSite>('/sites', p).then((r) => r.data),
  update: (id: string, p: UpdateSitePayload) =>
    api.patch<SafeSite>(`/sites/${id}`, p).then((r) => r.data),
  remove: (id: string) => api.delete(`/sites/${id}`).then((r) => r.data),
  testConnection: (id: string) =>
    api.post<TestConnectionResult>(`/sites/${id}/test-connection`).then((r) => r.data),
};

export const usersApi = {
  list: () => api.get<SafeUser[]>('/users').then((r) => r.data),
  get: (id: string) => api.get<SafeUser>(`/users/${id}`).then((r) => r.data),
  create: (p: CreateUserPayload) => api.post<SafeUser>('/users', p).then((r) => r.data),
  update: (id: string, p: UpdateUserPayload) =>
    api.patch<SafeUser>(`/users/${id}`, p).then((r) => r.data),
  changePassword: (id: string, newPassword: string) =>
    api.patch(`/users/${id}/password`, { newPassword }).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};

// ─── Import / Export ─────────────────────────────────────────────────────────
//
// Export endpoints return binary files — we request them with `responseType:
// 'blob'` and trigger a browser download via an object URL.

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const importExportApi = {
  exportProducts: async (filters: ExportFilters = {}): Promise<void> => {
    const res = await api.get('/import-export/products.xlsx', {
      params: filters,
      responseType: 'blob',
    });
    const name = buildExportFileName(filters);
    triggerDownload(res.data as Blob, `${name}.xlsx`);
  },

  downloadTemplate: async (): Promise<void> => {
    const res = await api.get('/import-export/template.xlsx', { responseType: 'blob' });
    triggerDownload(res.data as Blob, 'import-template.xlsx');
  },

  exportForWooCommerce: async (siteId: string, siteName?: string): Promise<void> => {
    const res = await api.get('/import-export/woo-commerce.csv', {
      params: { wooCommerceForSiteId: siteId },
      responseType: 'blob',
    });
    const slug =
      (siteName ?? 'site')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'site';
    triggerDownload(res.data as Blob, `woocommerce-${slug}.csv`);
  },

  uploadPreview: (file: File): Promise<ImportPreview> => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<ImportPreview>('/import-export/import/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  getPreview: (jobId: string) =>
    api.get<ImportPreview>(`/import-export/import/${jobId}/preview`).then((r) => r.data),

  commit: (jobId: string) =>
    api
      .post<{ jobId: string; queued: boolean }>(`/import-export/import/${jobId}/commit`)
      .then((r) => r.data),

  cancel: (jobId: string) =>
    api.post<void>(`/import-export/import/${jobId}/cancel`).then((r) => r.data),

  getJob: (jobId: string) =>
    api.get<ImportJob>(`/import-export/import/${jobId}`).then((r) => r.data),

  listJobs: (page = 1, pageSize = 25) =>
    api
      .get<PaginatedImportJobs>('/import-export/import', { params: { page, pageSize } })
      .then((r) => r.data),
};

// ─── Sync (Phase 3: WooCommerce hub → site) ──────────────────────────────────

export const syncApi = {
  push: (siteId: string, payload: { scope?: SyncScope; productIds?: string[] } = {}) =>
    api.post<EnqueuePushResult>(`/sync/sites/${siteId}/push`, payload).then((r) => r.data),

  previewAspNet: (
    siteId: string,
    payload: { scope?: SyncScope; productIds?: string[] } = { scope: 'PRICE_STOCK' },
  ) =>
    api
      .post<AspNetDryRunReport>(`/sync/sites/${siteId}/aspnet/preview`, payload)
      .then((r) => r.data),

  importAspNetMappings: (
    siteId: string,
    rows: {
      sourceProductId: number;
      sourceKind?: 'PRODUCT' | 'COMBINATION';
      sku: string;
    }[],
  ) =>
    api
      .post<{ imported: number; unresolved: number; duplicates: number }>(
        `/sync/sites/${siteId}/aspnet/mappings`,
        { rows },
      )
      .then((r) => r.data),

  pull: (siteId: string) =>
    api.post<EnqueuePullResult>(`/sync/sites/${siteId}/pull`).then((r) => r.data),

  pullCustomers: (siteId: string) =>
    api.post<EnqueueCustomerPullResult>(`/sync/sites/${siteId}/pull-customers`).then((r) => r.data),

  updateSchedule: (siteId: string, payload: UpdateSchedulePayload) =>
    api.patch<UpdateScheduleResult>(`/sync/sites/${siteId}/schedule`, payload).then((r) => r.data),

  listJobs: (q: { siteId?: string; page?: number; pageSize?: number } = {}) =>
    api.get<PaginatedSyncJobs>('/sync/jobs', { params: q }).then((r) => r.data),

  getJob: (id: string) => api.get<SyncJob>(`/sync/jobs/${id}`).then((r) => r.data),

  listLogs: (q: { siteId?: string; page?: number; pageSize?: number } = {}) =>
    api.get<PaginatedSyncLogs>('/sync/logs', { params: q }).then((r) => r.data),

  deleteLog: (id: string) => api.delete(`/sync/logs/${id}`).then((r) => r.data),

  clearFailedLogs: (siteId?: string) =>
    api
      .delete<{ deleted: number }>('/sync/logs/failed', { params: siteId ? { siteId } : {} })
      .then((r) => r.data),
};

// ─── Orders (Phase 4) ─────────────────────────────────────────────────────────

export const ordersApi = {
  list: (q: ListOrdersQuery = {}) =>
    api.get<PaginatedOrders>('/orders', { params: q }).then((r) => r.data),
  get: (id: string) => api.get<OrderDetail>(`/orders/${id}`).then((r) => r.data),
};

export const customersApi = {
  list: (q: ListCustomersQuery) =>
    api.get<PaginatedCustomers>('/customers', { params: q }).then((r) => r.data),
  crossSiteDuplicates: () =>
    api.get<CrossSiteDuplicatesResult>('/customers/cross-site-duplicates').then((r) => r.data),
};

export const logisticsOrdersApi = {
  employees: () => api.get<LogisticsEmployee[]>('/logistics-orders/employees').then((r) => r.data),
  list: (q: ListLogisticsOrdersQuery = {}) =>
    api.get<PaginatedLogisticsOrders>('/logistics-orders', { params: q }).then((r) => r.data),
  create: (payload: CreateLogisticsOrderPayload) =>
    api.post<LogisticsOrderRow>('/logistics-orders', payload).then((r) => r.data),
  updateStatus: (id: string, status: LogisticsOrderStatus) =>
    api.patch<LogisticsOrderRow>(`/logistics-orders/${id}/status`, { status }).then((r) => r.data),
};

// ─── Dashboard (Phase 4) ──────────────────────────────────────────────────────

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
};

// ─── Reports (Phase 6) ────────────────────────────────────────────────────────

export const reportsApi = {
  inventory: (q: InventoryReportQuery = {}) =>
    api
      .get<PaginatedReport<InventoryReportRow>>('/reports/inventory', { params: q })
      .then((r) => r.data),

  exportInventory: async (q: InventoryReportQuery = {}) => {
    const res = await api.get('/reports/inventory.xlsx', { params: q, responseType: 'blob' });
    triggerDownload(res.data as Blob, 'inventory-report.xlsx');
  },

  expiry: (q: ExpiryReportQuery = {}) =>
    api
      .get<PaginatedReport<ExpiryReportRow> & { dateFrom: string; dateTo: string }>(
        '/reports/expiry',
        { params: q },
      )
      .then((r) => r.data),

  exportExpiry: async (q: ExpiryReportQuery = {}) => {
    const res = await api.get('/reports/expiry.xlsx', { params: q, responseType: 'blob' });
    triggerDownload(res.data as Blob, 'expiry-report.xlsx');
  },

  sales: (q: SalesReportQuery = {}) =>
    api.get<SalesReportResult>('/reports/sales', { params: q }).then((r) => r.data),

  exportSales: async (q: SalesReportQuery = {}) => {
    const res = await api.get('/reports/sales.xlsx', { params: q, responseType: 'blob' });
    triggerDownload(res.data as Blob, 'sales-report.xlsx');
  },

  sync: (q: SyncReportQuery = {}) =>
    api.get<PaginatedReport<SyncReportRow>>('/reports/sync', { params: q }).then((r) => r.data),

  exportSync: async (q: SyncReportQuery = {}) => {
    const res = await api.get('/reports/sync.xlsx', { params: q, responseType: 'blob' });
    triggerDownload(res.data as Blob, 'sync-report.xlsx');
  },

  customers: (q: CustomersReportQuery = {}) =>
    api
      .get<PaginatedReport<CustomerReportRow>>('/reports/customers', { params: q })
      .then((r) => r.data),

  exportCustomers: async (q: CustomersReportQuery = {}) => {
    const res = await api.get('/reports/customers.xlsx', { params: q, responseType: 'blob' });
    triggerDownload(res.data as Blob, 'customers-report.xlsx');
  },
};

// ─── Matching (Phase 5) ─────────────────────────────────────────────────────

export const matchingApi = {
  analyze: (siteId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<MatchingPreview>(`/matching/sites/${siteId}/analyze`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  listSuggestions: (
    q: { siteId?: string; status?: MatchStatus; page?: number; pageSize?: number } = {},
  ) =>
    api
      .get<PaginatedMappingSuggestions>('/matching/suggestions', { params: q })
      .then((r) => r.data),

  approve: (id: string) =>
    api.post<void>(`/matching/suggestions/${id}/approve`).then((r) => r.data),

  reject: (id: string) => api.post<void>(`/matching/suggestions/${id}/reject`).then((r) => r.data),

  bulkApprove: (siteId?: string) =>
    api
      .post<{ approved: number }>('/matching/suggestions/bulk-approve', null, {
        params: siteId ? { siteId } : {},
      })
      .then((r) => r.data),

  getGaps: (q: { siteId?: string; page?: number; pageSize?: number } = {}) =>
    api.get<MatchingGapsResult>('/matching/gaps', { params: q }).then((r) => r.data),

  getDuplicates: () => api.get<DuplicateWarnings>('/matching/duplicates').then((r) => r.data),

  compare: (q: {
    siteId: string;
    filter?: 'all' | 'linked' | 'hub_only' | 'site_only' | 'pending';
    page?: number;
    pageSize?: number;
  }) => api.get<ProductCompareResult>('/matching/compare', { params: q }).then((r) => r.data),
};

export const auditLogApi = {
  list: (q: { userId?: string; action?: string; page?: number; pageSize?: number } = {}) =>
    api.get<PaginatedAuditLogs>('/audit-log', { params: q }).then((r) => r.data),
};

function buildExportFileName(filters: ExportFilters): string {
  const parts = ['products'];
  if (filters.category)
    parts.push(`cat-${filters.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  if (filters.siteId) parts.push('site');
  if (filters.minStock !== undefined || filters.maxStock !== undefined) parts.push('filtered');
  return parts.join('-');
}
