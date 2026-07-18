import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProxyAgent, getGlobalDispatcher, type Dispatcher } from 'undici';
import type { Environment } from '../config/env.validation';
import { HttpProxyError, type NetworkRoute } from './http-proxy.error';

export interface SiteEndpoint {
  siteId?: string;
  networkRoute: NetworkRoute;
  baseUrl: string;
  /** Basic-auth credentials (for WooCommerce consumer key/secret). */
  auth?: { username: string; password: string };
}

export interface ProxyRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // appended to baseUrl; may start with '/'
  body?: string | Buffer;
  headers?: Record<string, string>;
  /** Override per-call timeout (ms). */
  timeoutMs?: number;
}

export interface ProxyResponse<T = unknown> {
  status: number;
  body: T;
  routeUsed: NetworkRoute;
  latencyMs: number;
  attempts: number;
}

const DEFAULT_HEADERS = { 'content-type': 'application/json', accept: 'application/json' } as const;

/**
 * Centralized HTTP client that applies the correct proxy, timeout, and retry
 * policy based on a site's `network_route`. All outgoing WooCommerce traffic
 * flows through here so network issues can be diagnosed in one place.
 *
 * DIRECT   → undici default dispatcher
 * PROXY    → undici ProxyAgent pointed at FOREIGN_PROXY_URL (with optional
 *            basic auth via FOREIGN_PROXY_USERNAME / PASSWORD)
 *
 * Retries: only on network errors and 5xx/429. Never on 4xx (other than 429)
 * since those represent application-level failures that won't fix themselves.
 */
@Injectable()
export class HttpProxyService {
  private readonly logger = new Logger(HttpProxyService.name);
  private proxyAgent: ProxyAgent | null = null;

  private readonly timeoutDirect: number;
  private readonly timeoutProxy: number;
  private readonly retriesDirect: number;
  private readonly retriesProxy: number;
  private readonly proxyUrl: string;
  private readonly proxyUser: string;
  private readonly proxyPass: string;

  constructor(config: ConfigService<Environment, true>) {
    this.timeoutDirect = config.get('HTTP_TIMEOUT_DIRECT_MS', { infer: true });
    this.timeoutProxy = config.get('HTTP_TIMEOUT_PROXY_MS', { infer: true });
    this.retriesDirect = config.get('HTTP_RETRIES_DIRECT', { infer: true });
    this.retriesProxy = config.get('HTTP_RETRIES_PROXY', { infer: true });
    this.proxyUrl = config.get('FOREIGN_PROXY_URL', { infer: true });
    this.proxyUser = config.get('FOREIGN_PROXY_USERNAME', { infer: true });
    this.proxyPass = config.get('FOREIGN_PROXY_PASSWORD', { infer: true });
  }

  /** Test-only seam: inject a custom dispatcher. */
  // @internal
  _dispatcherForTesting?: Dispatcher;

  /**
   * Performs a request to `site.baseUrl + path`, applying the route-specific
   * proxy, timeout, and retry policy. Throws HttpProxyError on terminal failure.
   */
  async request<T = unknown>(site: SiteEndpoint, opts: ProxyRequestOptions): Promise<ProxyResponse<T>> {
    const route = site.networkRoute;
    const maxAttempts = 1 + (route === 'VIA_FOREIGN_PROXY' ? this.retriesProxy : this.retriesDirect);
    const timeoutMs = opts.timeoutMs ?? (route === 'VIA_FOREIGN_PROXY' ? this.timeoutProxy : this.timeoutDirect);
    const dispatcher = this.resolveDispatcher(route);
    const url = this.joinUrl(site.baseUrl, opts.path);
    const headers = this.mergeHeaders(opts.headers, site.auth);
    const startedAt = Date.now();

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const u = new URL(url);
        const { statusCode, body } = await dispatcher.request({
          origin: u.origin,
          path: `${u.pathname}${u.search}`,
          method: opts.method,
          headers,
          body: opts.body,
          headersTimeout: timeoutMs,
          bodyTimeout: timeoutMs,
          maxRedirections: 3,
        });
        const text = await body.text();
        const parsed = this.safeJson<T>(text);

        if (statusCode >= 200 && statusCode < 300) {
          return {
            status: statusCode,
            body: parsed as T,
            routeUsed: route,
            latencyMs: Date.now() - startedAt,
            attempts: attempt,
          };
        }

        // Retry on 429 and 5xx
        if (statusCode === 429 || statusCode >= 500) {
          lastErr = new HttpProxyError({
            code: `HTTP_${statusCode}`,
            message: `Upstream returned ${statusCode}`,
            siteId: site.siteId,
            networkRoute: route,
            attempt,
          });
          this.logger.warn(
            `Retryable upstream ${statusCode} on ${url} (attempt ${attempt}/${maxAttempts}, route=${route})`,
          );
          await this.backoff(attempt);
          continue;
        }

        // Non-retryable 4xx → terminal
        throw new HttpProxyError({
          code: `HTTP_${statusCode}`,
          message: `Upstream returned ${statusCode}`,
          siteId: site.siteId,
          networkRoute: route,
          attempt,
        });
      } catch (err) {
        // HttpProxyError thrown inside loop above: rethrow if non-retryable
        if (err instanceof HttpProxyError && !this.isRetryableCode(err.code)) {
          throw err;
        }
        lastErr = err;
        const code = this.errCode(err);
        this.logger.warn(
          `Network error ${code} on ${url} (attempt ${attempt}/${maxAttempts}, route=${route}): ${(err as Error).message}`,
        );
        if (attempt < maxAttempts) {
          await this.backoff(attempt);
          continue;
        }
        throw new HttpProxyError({
          code,
          message: (err as Error).message ?? 'Network error',
          siteId: site.siteId,
          networkRoute: route,
          attempt,
          cause: err as Error,
        });
      }
    }

    // Should be unreachable — last attempt always throws above.
    throw new HttpProxyError({
      code: 'UNKNOWN',
      message: 'Exhausted retries',
      siteId: site.siteId,
      networkRoute: route,
      attempt: maxAttempts,
      cause: lastErr as Error | undefined,
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private resolveDispatcher(route: NetworkRoute): Dispatcher {
    if (this._dispatcherForTesting) return this._dispatcherForTesting;
    if (route === 'VIA_FOREIGN_PROXY') {
      if (!this.proxyUrl) {
        throw new HttpProxyError({
          code: 'PROXY_NOT_CONFIGURED',
          message: 'FOREIGN_PROXY_URL is not set; cannot reach VIA_FOREIGN_PROXY site',
          networkRoute: route,
          attempt: 0,
        });
      }
      return this.getOrCreateProxyAgent();
    }
    // undici's global default dispatcher
    return getGlobalDispatcher();
  }

  private getOrCreateProxyAgent(): ProxyAgent {
    if (this.proxyAgent) return this.proxyAgent;
    const url = new URL(this.proxyUrl);
    if (this.proxyUser && this.proxyPass) {
      url.username = encodeURIComponent(this.proxyUser);
      url.password = encodeURIComponent(this.proxyPass);
    }
    this.proxyAgent = new ProxyAgent({ uri: url.toString() });
    return this.proxyAgent;
  }

  private joinUrl(base: string, path: string): string {
    if (!base) throw new Error('baseUrl is required');
    const trimmedBase = base.replace(/\/+$/, '');
    const trimmedPath = path.startsWith('/') ? path : `/${path}`;
    return `${trimmedBase}${trimmedPath}`;
  }

  private mergeHeaders(
    headers: Record<string, string> | undefined,
    auth: { username: string; password: string } | undefined,
  ): Record<string, string> {
    const merged: Record<string, string> = { ...DEFAULT_HEADERS, ...(headers ?? {}) };
    if (auth && auth.username) {
      merged.authorization =
        'Basic ' + Buffer.from(`${auth.username}:${auth.password ?? ''}`).toString('base64');
    }
    return merged;
  }

  private safeJson<T>(text: string): T | string {
    if (!text) return '' as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private isRetryableCode(code: string): boolean {
    return code === 'HTTP_429' || /^HTTP_5\d\d$/.test(code) || code !== code; // network errors are retryable
  }

  private errCode(err: unknown): string {
    if (err instanceof HttpProxyError) return err.code;
    const code = (err as any)?.code as string | undefined;
    if (typeof code === 'string') return code;
    if ((err as any)?.name === 'HeadersTimeoutError') return 'HEADERS_TIMEOUT';
    if ((err as any)?.name === 'BodyTimeoutError') return 'BODY_TIMEOUT';
    return 'NETWORK_ERROR';
  }

  private async backoff(attempt: number): Promise<void> {
    // exponential with jitter, capped at 2s
    const base = Math.min(200 * 2 ** (attempt - 1), 2000);
    const jitter = Math.floor(Math.random() * 100);
    await new Promise((r) => setTimeout(r, base + jitter));
  }
}
