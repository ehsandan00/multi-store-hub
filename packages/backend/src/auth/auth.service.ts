import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { hash, compare } from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { Environment } from '../config/env.validation';
import type { JwtPayload, AuthenticatedUser } from './auth.types';
import type { Role } from '@prisma/client';

const SALT_ROUNDS = 12;

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user.id, user.email, user.role);
  }

  async refresh(token: string): Promise<LoginResult> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token is not a refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return this.issueTokens(user.id, user.email, user.role);
  }

  async me(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return { id: user.id, email: user.email, role: user.role };
  }

  async setPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new ConflictException('Password must be ≥ 8 characters');
    }
    const passwordHash = await hash(newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  private async issueTokens(userId: string, email: string, role: Role): Promise<LoginResult> {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true }) ?? '15m';
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true }) ?? '7d';

    const accessPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      role,
      type: 'access',
    };
    const refreshPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      role,
      type: 'refresh',
    };

    // refresh secret is separate from access secret (different verifier):
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: accessTtl,
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: refreshTtl,
    });

    return { user: { id: userId, email, role }, accessToken, refreshToken, expiresIn: accessTtl };
  }
}
