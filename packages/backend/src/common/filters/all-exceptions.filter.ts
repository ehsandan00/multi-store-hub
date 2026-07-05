import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ZodError } from 'zod';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path?: string;
  timestamp: string;
  details?: unknown;
}

/**
 * Unified structured JSON error response. Never leaks stack traces in prod.
 * Handles: HttpException, Prisma errors, ZodError, generic Error.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProd: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let body: ErrorBody;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : (payload as any).message ?? payload ?? exception.message;
      body = {
        statusCode: status,
        error: (payload as any).error ?? HttpStatus[status] ?? 'Error',
        message,
        path: req.url,
        timestamp: new Date().toISOString(),
      };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const map: Record<string, { status: HttpStatus; error: string }> = {
        P2002: { status: HttpStatus.CONFLICT, error: 'Conflict' },
        P2025: { status: HttpStatus.NOT_FOUND, error: 'Not Found' },
        P2003: { status: HttpStatus.BAD_REQUEST, error: 'Foreign Key Violation' },
      };
      const entry = map[exception.code] ?? {
        status: HttpStatus.BAD_REQUEST,
        error: 'Database Error',
      };
      body = {
        statusCode: entry.status,
        error: entry.error,
        message: exception.message,
        path: req.url,
        timestamp: new Date().toISOString(),
        details: { code: exception.code },
      };
    } else if (exception instanceof ZodError) {
      body = {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Validation Error',
        message: 'Invalid environment / input schema',
        path: req.url,
        timestamp: new Date().toISOString(),
        details: exception.issues,
      };
    } else if (exception instanceof Error) {
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: this.isProd ? 'Unexpected error' : exception.message,
        path: req.url,
        timestamp: new Date().toISOString(),
      };
      this.logger.error(`Unhandled error on ${req.method} ${req.url}`, exception.stack);
    } else {
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'Unexpected non-error thrown',
        path: req.url,
        timestamp: new Date().toISOString(),
      };
    }

    if (body.statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${body.statusCode} ${body.error}: ${JSON.stringify(body.message)}`,
      );
    }

    res.status(body.statusCode).json(body);
  }
}
