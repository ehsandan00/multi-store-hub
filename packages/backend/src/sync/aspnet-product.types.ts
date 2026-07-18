export const ASPNET_SYNC_API_PREFIX = '/api/multi-store-hub/v1';
export const ASPNET_SYNC_BATCH_SIZE = 100;

export interface AspNetHealthResponse {
  ok: boolean;
  platform: string;
  pluginVersion: string;
  storeUrl?: string;
}

export interface AspNetRemoteProduct {
  id: number;
  sku: string | null;
  name?: string;
  price: string;
  stockQuantity: number;
  kind: 'PRODUCT' | 'COMBINATION';
  parentProductId?: number | null;
}

export interface AspNetLookupRequest {
  sourceProductIds: number[];
  sourceCombinationIds: number[];
  skus: string[];
}

export interface AspNetLookupResponse {
  items: AspNetRemoteProduct[];
  unresolvedSourceProductIds: number[];
  unresolvedSourceCombinationIds: number[];
  unresolvedSkus: string[];
  duplicateSkus: string[];
}

export interface AspNetPriceStockUpdate {
  sourceProductId?: number;
  sourceCombinationId?: number;
  sku?: string;
  price: string;
  stockQuantity: number;
}

export interface AspNetUpdateResult {
  sourceProductId?: number;
  sourceCombinationId?: number;
  sku?: string;
  status: 'updated' | 'not_found' | 'ambiguous' | 'error';
  remote?: AspNetRemoteProduct;
  message?: string;
}

export interface AspNetBulkUpdateResponse {
  results: AspNetUpdateResult[];
}

export interface AspNetDryRunItem {
  productId: string;
  sku: string;
  sourceProductId: number | null;
  sourceCombinationId: number | null;
  status: 'matched_by_id' | 'matched_by_sku' | 'unresolved' | 'duplicate';
  remote?: AspNetRemoteProduct;
  wouldUpdate?: { price: string; stockQuantity: number };
}

export interface AspNetDryRunReport {
  siteId: string;
  total: number;
  matched: number;
  unresolved: number;
  duplicate: number;
  items: AspNetDryRunItem[];
}
