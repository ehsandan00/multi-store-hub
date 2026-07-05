import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { AUDIT_ACTION_KEY } from '../decorators/audit.decorator';
import { AuditLogService } from '../../audit-log/audit-log.service';

type AuthedRequest = Request & {
  user?: { id?: string; email?: string; role?: string };
};

/** Keys stripped from any body before being persisted to the audit log. */
const SENSITIVE_KEYS = ['password', 'passwordHash', 'consumerSecret', 'consumerKey', 'token'];

function sanitize(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s.toLowerCase()))) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitize(v);
    }
  }
  return out;
}

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0]!;
  return req.socket?.remoteAddress ?? req.ip ?? null;
}

/**
 * Interceptor that, when @Audit('ACTION') is present, records an audit entry
 * AFTER the handler succeeds. Failed handlers do not produce an audit row
 * (the action did not actually happen) — exception filter logs the failure.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string | undefined>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return next.handle();

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap((payload) => {
        // Try to derive a target like "Product:abc123" from the payload id + action.
        const targetId = (payload as any)?.id ?? req.params?.id;
        const entity = action.split('_')[0] ?? 'Entity';
        const target = targetId ? `${entity}:${targetId}` : null;

        void this.audit.record({
          userId: req.user?.id ?? null,
          action,
          target,
          details: {
            method: req.method,
            path: req.url,
            body: sanitize(req.body),
            statusCode: res.statusCode,
          },
          ipAddress: clientIp(req),
        });
      }),
    );
  }
}
