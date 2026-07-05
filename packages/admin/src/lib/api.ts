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
  DashboardSummary,
} from './types';
import { useAuthStore } from './auth-store';

// In dev, Vite proxies /api → http://localhost:3001 (see vite.config.ts).
// In production, set VITE_API_URL to the backend's public URL.
const baseURL = import.meta.env.VITE_API_URL ?? '/api';

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
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
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
      .then((r) => r.data),
  categories: () => api.get<string[]>('/products/categories').then((r) => r.data),
  get: (id: string) => api.get<ProductRow>(`/products/${id}`).then((r) => r.data),
  inventoryHistory: (id: string) =>
    api.get<InventoryLog[]>(`/products/${id}/inventory-history`).then((r) => r.data),
  create: (p: CreateProductPayload) =>
    api.post<ProductRow>('/products', p).then((r) => r.data),
  update: (id: string, p: UpdateProductPayload) =>
    api.patch<ProductRow>(`/products/${id}`, p).then((r) => r.data),
  remove: (id: string) => api.delete(`/products/${id}`).then((r) => r.data),
};

export const sitesApi = {
  list: (page = 1, pageSize = 100) =>
    api
      .get<PaginatedSites>('/sites', { params: { page, pageSize } })
      .then((r) => r.data),
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

  exportForWooCommerce: async (siteId: string, siteName?: string): Promise<void> => {
    const res = await api.get('/import-export/woo-commerce.csv', {
      params: { wooCommerceForSiteId: siteId },
      responseType: 'blob',
    });
    const slug = (siteName ?? 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
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
    api.post<{ jobId: string; queued: boolean }>(`/import-export/import/${jobId}/commit`).then((r) => r.data),

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
    api
      .post<EnqueuePushResult>(`/sync/sites/${siteId}/push`, payload)
      .then((r) => r.data),

  pull: (siteId: string) =>
    api
      .post<EnqueuePullResult>(`/sync/sites/${siteId}/pull`)
      .then((r) => r.data),

  updateSchedule: (siteId: string, payload: UpdateSchedulePayload) =>
    api.patch<UpdateScheduleResult>(`/sync/sites/${siteId}/schedule`, payload).then((r) => r.data),

  listJobs: (q: { siteId?: string; page?: number; pageSize?: number } = {}) =>
    api
      .get<PaginatedSyncJobs>('/sync/jobs', { params: q })
      .then((r) => r.data),

  getJob: (id: string) => api.get<SyncJob>(`/sync/jobs/${id}`).then((r) => r.data),

  listLogs: (q: { siteId?: string; page?: number; pageSize?: number } = {}) =>
    api
      .get<PaginatedSyncLogs>('/sync/logs', { params: q })
      .then((r) => r.data),
};

// ─── Orders (Phase 4) ─────────────────────────────────────────────────────────

export const ordersApi = {
  list: (q: ListOrdersQuery = {}) =>
    api
      .get<PaginatedOrders>('/orders', { params: q })
      .then((r) => r.data),
  get: (id: string) => api.get<OrderDetail>(`/orders/${id}`).then((r) => r.data),
};

// ─── Dashboard (Phase 4) ──────────────────────────────────────────────────────

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
};

function buildExportFileName(filters: ExportFilters): string {
  const parts = ['products'];
  if (filters.category) parts.push(`cat-${filters.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  if (filters.siteId) parts.push('site');
  if (filters.minStock !== undefined || filters.maxStock !== undefined) parts.push('filtered');
  return parts.join('-');
}
