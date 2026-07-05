/**
 * Shared types and constants for the WooCommerce sync module (Phase 3).
 *
 * The sync pipeline is:
 *   1. SyncService.enqueuePush(siteId, scope, productIds?) → SyncJob(QUEUED) + BullMQ job
 *   2. SyncProcessor.process(job) → SyncService.runPush(syncJobId)
 *   3. runPush: load hub products + site mappings → for each, upsert to the
 *      site's WooCommerce via WooCommerceClient (idempotent by SKU) → write
 *      SyncLog + update SyncJob + stamp lastSyncedAt on mappings
 *   4. SyncScheduler: repeatable BullMQ job enqueues PUSH for every site with
 *      syncEnabled=true at the site's syncIntervalMs
 */

export const SYNC_QUEUE_NAME = 'woo-sync';

/** Default per-site request concurrency (in-flight WC API calls). */
export const SYNC_DEFAULT_CONCURRENCY = 1;

/** Default minimum spacing between requests to a single site (ms). */
export const SYNC_DEFAULT_MIN_INTERVAL_MS = 1000; // ~1 req/s

/** Page size for listing existing WC products by SKU during idempotent upsert. */
export const WC_LOOKUP_PAGE_SIZE = 100;

/** Sync job scope options (stored on SyncJob.scope). */
export type SyncScope = 'ALL' | 'MAPPING' | 'PRODUCT_IDS';

/** WooCommerce REST API v3 path prefix. */
export const WC_API_PREFIX = '/wp-json/wc/v3';

export interface WcProductPayload {
  /** WooCommerce product id (set when updating an existing remote product). */
  id?: number;
  sku: string;
  name: string;
  type?: 'simple';
  regular_price?: string;
  description?: string;
  short_description?: string;
  categories?: { id?: number; name?: string; slug?: string }[];
  images?: { src?: string }[];
  barcode?: string;
  // Stock management
  manage_stock?: boolean;
  stock_quantity?: number;
  // low_stock_threshold has no native WC field — we don't push it.
  status?: 'publish' | 'draft' | 'pending' | 'private';
  /** WC's "menu_order" / visibility — kept default. */
}

export interface WcProductRemote {
  id: number;
  sku?: string;
  name?: string;
  regular_price?: string;
  stock_quantity?: number | null;
  manage_stock?: boolean;
  status?: string;
}

export interface SyncItemError {
  sku: string;
  message: string;
  code?: string;
  statusCode?: number;
}

export interface SyncReport {
  pushed: number;
  failed: number;
  created: number; // remote created (new WC product)
  updated: number; // remote updated
  errors: SyncItemError[];
  startedAt: string;
  finishedAt: string;
  routeUsed: string;
}

/** Internal: a hub product resolved for push, with its mapping context. */
export interface ResolvedPushItem {
  productId: string;
  skuMaster: string;
  name: string;
  description: string | null;
  category: string | null;
  basePrice: string; // decimal as string
  totalStock: number;
  imageUrl: string | null;
  barcode: string | null;
  /** Existing mapping for this (product, site); may be null on first push. */
  mappingId: string | null;
  siteSku: string | null;
  siteProductId: string | null;
  siteSpecificTitle: string | null;
}

// ─── Phase 4: order pull (site → hub) ───────────────────────────────────────

/** WooCommerce REST v3 order line item (subset we persist). */
export interface WcOrderItemRemote {
  id: number;
  name?: string;
  sku?: string;
  quantity: number;
  price?: string;
  total?: string;
  product_id?: number;
}

/** WooCommerce REST v3 billing address (subset). */
export interface WcBillingRemote {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

/** WooCommerce REST v3 order (subset we persist). */
export interface WcOrderRemote {
  id: number;
  number: string;
  status: string;
  total: string;
  total_shipping?: string;
  discount_total?: string;
  currency?: string;
  payment_method?: string;
  date_created?: string;
  date_modified?: string;
  customer_id?: number;
  billing?: WcBillingRemote;
  line_items?: WcOrderItemRemote[];
}

/** Per-order error recorded during a pull. */
export interface OrderPullItemError {
  remoteOrderId: number;
  orderNumber: string;
  message: string;
  code?: string;
  statusCode?: number;
}

/** Final report for an order-pull sync job. */
export interface OrderPullReport {
  pulled: number; // orders fetched from WC
  created: number; // new orders inserted into the hub
  updated: number; // existing orders updated
  failed: number; // orders that failed to upsert
  errors: OrderPullItemError[];
  startedAt: string;
  finishedAt: string;
  routeUsed: string;
  /** ISO timestamp of the most recent WC date_modified seen this run; stamped
   * onto SiteConfig.lastOrderPullAt as the next incremental cursor. */
  newestDateModified: string | null;
}

/** Default WC orders page size (WC max is 100). */
export const WC_ORDERS_PAGE_SIZE = 100;
