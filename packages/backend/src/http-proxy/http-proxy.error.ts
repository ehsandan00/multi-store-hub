/**
 * Typed errors raised by HttpProxyService. Carries enough context to write
 * a useful SyncLog row (siteId, route, attempt) without leaking secrets.
 */
export type NetworkRoute = 'DIRECT' | 'VIA_FOREIGN_PROXY';

export class HttpProxyError extends Error {
  readonly code: string;
  readonly siteId?: string;
  readonly networkRoute: NetworkRoute;
  readonly attempt: number;
  readonly cause?: Error;

  constructor(opts: {
    code: string;
    message: string;
    siteId?: string;
    networkRoute: NetworkRoute;
    attempt: number;
    cause?: Error;
  }) {
    super(opts.message);
    this.name = 'HttpProxyError';
    this.code = opts.code;
    this.siteId = opts.siteId;
    this.networkRoute = opts.networkRoute;
    this.attempt = opts.attempt;
    if (opts.cause) this.cause = opts.cause;
  }

  /** Safe JSON-serializable form for SyncLog.details (no secrets). */
  toSafe(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      siteId: this.siteId,
      networkRoute: this.networkRoute,
      attempt: this.attempt,
      cause: this.cause ? this.cause.message : undefined,
    };
  }
}
