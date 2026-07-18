import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.validation';
import type { JwtPayload, AuthenticatedUser } from './auth.types';

/**
 * Verifies the access token (separate secret from refresh) and attaches
 * `request.user = { id, email, role }`. Refresh-token verification happens
 * in AuthService.refresh() directly.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Environment, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
