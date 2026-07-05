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
