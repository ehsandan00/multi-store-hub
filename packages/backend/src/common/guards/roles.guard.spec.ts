import { describe, it, expect } from '@jest/globals';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function ctxWithUser(role: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows when no roles are required', () => {
    const ctx = ctxWithUser('VIEWER');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when user role is in the required list', () => {
    (guard as any).reflector.getAllAndOverride = () => ['ADMIN', 'WAREHOUSE_STAFF'];
    expect(guard.canActivate(ctxWithUser('WAREHOUSE_STAFF'))).toBe(true);
  });

  it('forbids when user role is not in the required list', () => {
    (guard as any).reflector.getAllAndOverride = () => ['ADMIN'];
    expect(() => guard.canActivate(ctxWithUser('VIEWER'))).toThrow();
  });

  it('forbids when there is no user', () => {
    (guard as any).reflector.getAllAndOverride = () => ['ADMIN'];
    expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow();
  });
});
