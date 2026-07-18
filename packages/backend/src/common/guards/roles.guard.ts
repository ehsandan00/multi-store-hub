import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type Role } from '../decorators/roles.decorator';

/**
 * Reads @Roles(...) metadata and verifies request.user.role is in the list.
 * Must run after JwtAuthGuard has populated request.user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: { role?: Role } }>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(`Role ${role ?? 'none'} not permitted (requires: ${required.join(', ')})`);
    }
    return true;
  }
}
