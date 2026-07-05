import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication, Controller, Get, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth.types';

/**
 * End-to-end auth regression suite.
 *
 * Boots a minimal Nest app with the real AuthController, the real JwtStrategy,
 * and the global JwtAuthGuard + RolesGuard (the same wiring AppModule uses),
 * but with PrismaService replaced by an in-memory fake so no PostgreSQL is
 * required. This is the test that would have caught the Phase 1 bug where the
 * guard never invoked Passport and every authenticated request returned 401.
 */

const JWT_ACCESS_SECRET = 'a'.repeat(40);
const JWT_REFRESH_SECRET = 'b'.repeat(40);

function fakeConfig(): ConfigService {
  return {
    get: (key: string) => {
      const env: Record<string, any> = {
        JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET,
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
      };
      return env[key];
    },
  } as unknown as ConfigService;
}

@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  public() {
    return { ok: true };
  }

  /** Requires a valid JWT but no specific role. */
  @Get('me')
  me(@Req() req: { user: AuthenticatedUser }) {
    return req.user;
  }

  /** ADMIN-only — used to exercise RolesGuard against a viewer token. */
  @Get('admin')
  @Roles('ADMIN')
  adminOnly(@Req() req: { user: AuthenticatedUser }) {
    return { role: req.user.role };
  }
}

describe('Auth e2e (JwtAuthGuard + RolesGuard + Passport JWT, no DB)', () => {
  let app: INestApplication;
  let adminLogin: { accessToken: string; refreshToken: string };
  let viewerLogin: { accessToken: string };

  beforeAll(async () => {
    const admin = {
      id: 'u-admin',
      email: 'admin@hub.local',
      passwordHash: await bcrypt.hash('Admin@12345', 12),
      role: Role.ADMIN,
      isActive: true,
    };
    const viewer = {
      id: 'u-viewer',
      email: 'viewer@hub.local',
      passwordHash: await bcrypt.hash('Viewer@12345', 12),
      role: Role.VIEWER,
      isActive: true,
    };
    const prisma: any = {
      user: {
        findUnique: async ({ where }: any) => {
          if (where.id === admin.id) return admin;
          if (where.id === viewer.id) return viewer;
          if (where.email === admin.email) return admin;
          if (where.email === viewer.email) return viewer;
          return null;
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: JWT_ACCESS_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [AuthController, ProbeController],
      providers: [
        AuthService,
        JwtStrategy,
        RolesGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: fakeConfig() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Log in both users once — these tokens are reused across assertions.
    const adminRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@hub.local', password: 'Admin@12345' })
      .expect(200);
    adminLogin = { accessToken: adminRes.body.accessToken, refreshToken: adminRes.body.refreshToken };

    const viewerRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'viewer@hub.local', password: 'Viewer@12345' })
      .expect(200);
    viewerLogin = { accessToken: viewerRes.body.accessToken };
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ─── Login ──────────────────────────────────────────────────────────────
  it('POST /auth/login rejects wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@hub.local', password: 'wrong' })
      .expect(401);
  });

  it('POST /auth/login returns access + refresh tokens with the user payload', async () => {
    expect(adminLogin.accessToken).toBeTruthy();
    expect(adminLogin.refreshToken).toBeTruthy();
    const payload = JSON.parse(
      Buffer.from(adminLogin.accessToken.split('.')[1], 'base64').toString('utf-8'),
    );
    expect(payload.sub).toBe('u-admin');
    expect(payload.role).toBe('ADMIN');
    expect(payload.type).toBe('access');
  });

  // ─── The regression: protected routes now populate req.user ─────────────
  it('GET /probe/me WITHOUT a bearer returns 401', async () => {
    await request(app.getHttpServer()).get('/probe/me').expect(401);
  });

  it('GET /probe/me WITH a valid bearer returns 200 and the authenticated user (regression for the guard fix)', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/me')
      .set('Authorization', `Bearer ${adminLogin.accessToken}`)
      .expect(200);
    expect(res.body).toEqual({ id: 'u-admin', email: 'admin@hub.local', role: 'ADMIN' });
  });

  it('GET /probe/me with a malformed bearer returns 401', async () => {
    await request(app.getHttpServer())
      .get('/probe/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
  });

  it('GET /auth/me with a valid bearer returns the authenticated user (no redundant @UseGuards needed)', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminLogin.accessToken}`)
      .expect(200);
    expect(res.body).toEqual({ id: 'u-admin', email: 'admin@hub.local', role: 'ADMIN' });
  });

  // ─── @Public routes bypass auth ─────────────────────────────────────────
  it('GET /probe/public WITHOUT a bearer returns 200', async () => {
    await request(app.getHttpServer()).get('/probe/public').expect(200);
  });

  // ─── RBAC ───────────────────────────────────────────────────────────────
  it('GET /probe/admin with an ADMIN token returns 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${adminLogin.accessToken}`)
      .expect(200);
    expect(res.body.role).toBe('ADMIN');
  });

  it('GET /probe/admin with a VIEWER token returns 403 (RolesGuard enforces)', async () => {
    await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${viewerLogin.accessToken}`)
      .expect(403);
  });

  // ─── Refresh flow ───────────────────────────────────────────────────────
  it('POST /auth/refresh with the refresh token issues new access + refresh tokens', async () => {
    // JWT iat is in seconds, so a refresh issued in the same second as the
    // login produces a byte-identical token. Wait just over a second so the
    // new access token carries a different iat and is observably distinct.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: adminLogin.refreshToken })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.accessToken).not.toBe(adminLogin.accessToken);
  });

  it('POST /auth/refresh with an access token (wrong type) returns 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: adminLogin.accessToken })
      .expect(401);
  });
});
