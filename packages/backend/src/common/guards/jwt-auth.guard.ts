import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Default global guard. Validates a JWT on every request, EXCEPT routes
 * decorated with @Public(). Populates request.user = { id, email, role }.
 *
 * The actual JWT verification is delegated to Passport's jwt strategy via
 * @nestjs/passport (AuthModule). This guard just opts out for @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    if (!req.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return true;
  }
}
