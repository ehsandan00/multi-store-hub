import { Injectable, Logger } from '@nestjs/common';
import { HttpProxyService, type ProxyResponse } from '../http-proxy/http-proxy.service';
import { HttpProxyError, type NetworkRoute } from '../http-proxy/http-proxy.error';
import { decrypt } from '../config/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import type { WcProductPayload, WcProductRemote } from './sync.types';
import { SYNC_DEFAULT_CONCURRENCY, SYNC_DEFAULT_MIN_INTERVAL_MS, WC_API_PREFIX, WC_LOOKUP_PAGE_SIZE } from './sync.types';

/**
 * Thin WooCommerce REST API v3 client built on top of HttpProxyService.
 *
 * Why not use the `woocommerce-rest-api` npm package directly?
 * The project's hard requirement is that *every* request to a site respects
 * that site's `network_route` (DIRECT vs VIA_FOREIGN_PROXY), with per-route
 * timeouts, retries, and SyncLog diagnostics. The official library uses axios
 * and has no first-class per-request proxy-selection hook that would let us
 * route some sites through the foreign proxy and others direct from one
 * process. Wrapping our own HttpProxyService keeps all WooCommerce traffic
 * flowing through the centralized, route-aware client — which is the
 * project-specific critical requirement. The WC REST v3 surface we need is
 * small (products CRUD + lookup by SKU), so the wrapper is minimal.
 *
 * Concurrency / rate limiting: a per-site semaphore caps in-flight requests
 * (default 1) and a min-interval gate spaces successive requests (default
 * ~1 req/s). This avoids getting blocked by WooCommerce servers, which the
 * spec calls out explicitly. Both are tunable via env in a future iteration.
 */
@Injectable()
export class WooCommerceClient {
  private readonly logger = new Logger(WooCommerceClient.name);

  /** Per-site in-flight counters for the concurrency limiter. */
  private readonly inFlight = new Map<string, number>();
  /** Per-site timestamp of the last dispatched request, for min-interval gating. */
  private readonly lastDispatchAt = new Map<string, number>();
  /** Per-site promise chain that serializes the dispatch gate. */
  private readonly gateQueue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly http: HttpProxyService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Looks up remote WC products by SKU. Returns a Map<sku, WcProductRemote>.
   * Used to make pushes idempotent: if a SKU already exists remotely, we PUT
   * an update instead of POSTing a duplicate.
   */
  async findProductsBySku(
    siteId: string,
    skus: string[],
  ): Promise<Map<string, WcProductRemote>> {
    const result = new Map<string, WcProductRemote>();
    if (skus.length === 0) return result;

    const creds = await this.loadCredentials(siteId);
    // WC's `sku` query param accepts a comma-separated list (max 100 chars per
    // element, but the list length is bounded by our SYNC page sizes). We
    // batch to keep URLs short.
    for (let i = 0; i < skus.length; i += WC_LOOKUP_PAGE_SIZE) {
      const batch = skus.slice(i, i + WC_LOOKUP_PAGE_SIZE);
      const skuParam = batch.join(',');
      const res = await this.dispatch<WcProductRemote[]>(siteId, creds, {
        method: 'GET',
        path: `${WC_API_PREFIX}/products?per_page=${WC_LOOKUP_PAGE_SIZE}&sku=${encodeURIComponent(skuParam)}`,
      });
      const rows = Array.isArray(res.body) ? res.body : [];
      for (const r of rows) {
        if (r.sku) result.set(r.sku, r);
      }
    }
    return result;
  }

  /** Creates a new WC product. Returns the remote product (with `id`). */
  async createProduct(siteId: string, payload: WcProductPayload): Promise<WcProductRemote> {
    const creds = await this.loadCredentials(siteId);
    const res = await this.dispatch<WcProductRemote>(siteId, creds, {
      method: 'POST',
      path: `${WC_API_PREFIX}/products`,
      body: JSON.stringify(payload),
    });
    return res.body;
  }

  /** Updates an existing WC product by remote id. */
  async updateProduct(
    siteId: string,
    remoteId: number,
    payload: Partial<WcProductPayload>,
  ): Promise<WcProductRemote> {
    const creds = await this.loadCredentials(siteId);
    const res = await this.dispatch<WcProductRemote>(siteId, creds, {
      method: 'PUT',
      path: `${WC_API_PREFIX}/products/${remoteId}`,
      body: JSON.stringify(payload),
    });
    return res.body;
  }

  /**
   * Idempotent upsert by SKU: if `existing` is provided (or looked up), PUT;
   * otherwise POST. Returns `{ remote, created }` so the caller can record
   * whether a new WC product was created (and capture its id for the mapping).
   */
  async upsertProductBySku(
    siteId: string,
    payload: WcProductPayload,
    existing?: WcProductRemote,
  ): Promise<{ remote: WcProductRemote; created: boolean }> {
    if (existing && existing.id) {
      const remote = await this.updateProduct(siteId, existing.id, payload);
      return { remote, created: false };
    }
    const remote = await this.createProduct(siteId, payload);
    return { remote, created: true };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async loadCredentials(
    siteId: string,
  ): Promise<{ username: string; password: string; networkRoute: NetworkRoute; baseUrl: string }> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new HttpProxyError({
      code: 'SITE_NOT_FOUND',
      message: `Site ${siteId} not found`,
      siteId,
      networkRoute: 'DIRECT',
      attempt: 0,
    });
    return {
      username: decrypt(site.consumerKeyEncrypted),
      password: decrypt(site.consumerSecretEncrypted),
      networkRoute: site.networkRoute,
      baseUrl: site.baseUrl,
    };
  }

  /**
   * Serializes + rate-limits requests per site, then delegates to the
   * route-aware HttpProxyService. The gate guarantees (a) at most
   * SYNC_DEFAULT_CONCURRENCY in-flight requests per site, and (b) at least
   * SYNC_DEFAULT_MIN_INTERVAL_MS between successive dispatch starts.
   */
  private dispatch<T>(
    siteId: string,
    creds: { username: string; password: string; networkRoute: NetworkRoute; baseUrl: string },
    opts: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: string },
  ): Promise<ProxyResponse<T>> {
    // Chain onto this site's gate so requests are serialized in arrival order.
    const prev = this.gateQueue.get(siteId) ?? Promise.resolve();
    const next = prev.then(() => this.gatedDispatch<T>(siteId, creds, opts));
    this.gateQueue.set(siteId, next.catch(() => undefined)); // never let one failure break the chain
    return next;
  }

  private async gatedDispatch<T>(
    siteId: string,
    creds: { username: string; password: string; networkRoute: NetworkRoute; baseUrl: string },
    opts: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: string },
  ): Promise<ProxyResponse<T>> {
    // Concurrency limiter: wait until in-flight < max for this site.
    while ((this.inFlight.get(siteId) ?? 0) >= SYNC_DEFAULT_CONCURRENCY) {
      await new Promise((r) => setTimeout(r, 20));
    }
    // Min-interval gate: space successive starts.
    const last = this.lastDispatchAt.get(siteId) ?? 0;
    const elapsed = Date.now() - last;
    const wait = SYNC_DEFAULT_MIN_INTERVAL_MS - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    this.inFlight.set(siteId, (this.inFlight.get(siteId) ?? 0) + 1);
    this.lastDispatchAt.set(siteId, Date.now());
    try {
      return await this.http.request<T>(
        {
          siteId,
          networkRoute: creds.networkRoute,
          baseUrl: creds.baseUrl,
          auth: { username: creds.username, password: creds.password },
        },
        opts,
      );
    } finally {
      this.inFlight.set(siteId, (this.inFlight.get(siteId) ?? 1) - 1);
    }
  }
}
