import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';
export const AUDIT_ACTION_KEY = 'auditAction';

/**
 * Marks a mutating endpoint for audit logging. The AuditInterceptor will:
 *  - capture the user id (from request.user)
 *  - capture the IP (from request.ip / x-forwarded-for)
 *  - record action + target (entity:id derived from response if possible)
 *  - record sanitized details (DTO body without password fields)
 *
 * Usage:
 *   @Post()
 *   @Audit('PRODUCT_CREATE')
 *   create(@Body() dto: CreateProductDto) { ... }
 */
export const Audit = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
