import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Regression coverage for the Phase 1 fix where the guard was a bare
 * CanActivate that never invoked Passport, so request.user stayed undefined
 * and every authenticated request returned 401.
 *
 * The guard now extends AuthGuard('jwt') and delegates to super.canActivate()
 * for non-@Public routes. We stub the inherited super.canActivate so we can
 * assert the delegation happens, without needing a live Passport strategy.
 */
function ctxWithHandler(handler: () => any, klass: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({}) }),
    getHandler: () => handler,
    getClass: () => klass,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard (regression for the Phase 1 401-everywhere bug)', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;
  // The parent class (AuthGuard('jwt')) provides canActivate; spy on it so we
  // can assert the guard delegates instead of short-circuiting.
  let parentCanActivate: any;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
    parentCanActivate = Object.getPrototypeOf(
      Object.getPrototypeOf(guard),
    );
  });

  it('short-circuits with true for @Public() routes without touching Passport', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const spy = jest.spyOn(parentCanActivate, 'canActivate');
    const ctx = ctxWithHandler(() => {}, class {});
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('delegates to Passport (super.canActivate) for protected routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const spy = jest
      .spyOn(parentCanActivate, 'canActivate')
      .mockResolvedValue(true);
    const ctx = ctxWithHandler(() => {}, class {});
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('handleRequest throws UnauthorizedException when there is no user', () => {
    expect(() => (guard as any).handleRequest(null, null)).toThrow(
      UnauthorizedException,
    );
  });

  it('handleRequest throws UnauthorizedException when Passport passes an error', () => {
    expect(() => (guard as any).handleRequest(new Error('jwt expired'), null)).toThrow(
      UnauthorizedException,
    );
  });

  it('handleRequest returns the user when authentication succeeds (populates req.user)', () => {
    const user = { id: 'u1', email: 'a@b.c', role: 'ADMIN' };
    expect((guard as any).handleRequest(null, user)).toBe(user);
  });

  it('reads the IS_PUBLIC_KEY metadata from handler then class', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const handler = () => {};
    const klass = class Handler {};
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    guard.canActivate(ctxWithHandler(handler, klass));
    const [key, path] = spy.mock.calls[0];
    expect(key).toBe(IS_PUBLIC_KEY);
    expect(path).toEqual([handler, klass]);
  });
});
