import { describe, it, expect, beforeEach } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

function fakePrisma(users: any[] = []): any {
  const byId = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const u of users) {
    byId.set(u.id, u);
    byEmail.set(u.email, u);
  }
  return {
    user: {
      findUnique: async ({ where }: any) => byId.get(where.id) ?? byEmail.get(where.email) ?? null,
      update: async ({ where, data }: any) => {
        const u = byId.get(where.id);
        const merged = { ...u, ...data };
        byId.set(where.id, merged);
        byEmail.set(merged.email, merged);
        return merged;
      },
    },
  };
}

function fakeConfig(): ConfigService<any, true> {
  return {
    get: (key: string) => {
      const env: Record<string, any> = {
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
      };
      return env[key];
    },
  } as unknown as ConfigService<any, true>;
}

function fakeJwt(): JwtService {
  const signed: any[] = [];
  return {
    signAsync: async (payload: any, opts: any) => {
      const token = `${opts.secret.slice(0, 4)}.${Buffer.from(JSON.stringify(payload)).toString(
        'base64',
      )}.${opts.expiresIn}`;
      signed.push({ payload, opts });
      return token;
    },
    verifyAsync: async (token: string) => {
      const [, payloadB64] = token.split('.');
      return JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    },
  } as unknown as JwtService;
}

describe('AuthService', () => {
  let svc: AuthService;
  let prisma: any;

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash('Password@123', 12);
    const user = {
      id: 'u1',
      email: 'admin@hub.local',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    };
    prisma = fakePrisma([user]);
    svc = new AuthService(prisma, fakeJwt(), fakeConfig());
  });

  it('issues access + refresh tokens with correct payload', async () => {
    const res = await svc.login('admin@hub.local', 'Password@123');
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(res.user.id).toBe('u1');
    expect(res.user.role).toBe('ADMIN');
  });

  it('rejects wrong password', async () => {
    await expect(svc.login('admin@hub.local', 'wrong')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects inactive users', async () => {
    prisma.user.findUnique = async () => ({
      id: 'u1',
      email: 'admin@hub.local',
      passwordHash: await bcrypt.hash('Password@123', 12),
      role: 'ADMIN',
      isActive: false,
    });
    await expect(svc.login('admin@hub.local', 'Password@123')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('me() throws if user not found', async () => {
    await expect(svc.me('missing')).rejects.toThrow(UnauthorizedException);
  });
});
