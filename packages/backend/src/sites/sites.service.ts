import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { NetworkRoute } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HttpProxyService } from '../http-proxy/http-proxy.service';
import { HttpProxyError } from '../http-proxy/http-proxy.error';
import { decrypt, encrypt, maskSecret } from '../config/crypto.util';
import type { CreateSiteDto, ListSitesQuery, SafeSite, UpdateSiteDto } from './sites.dto';

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  routeUsed: NetworkRoute;
  attempts: number;
  status?: number;
  error?: { code: string; message: string };
}

interface RawSite {
  id: string;
  name: string;
  baseUrl: string;
  consumerKeyEncrypted: string;
  consumerSecretEncrypted: string;
  networkRoute: NetworkRoute;
  isActive: boolean;
  syncEnabled: boolean;
  syncIntervalMs: number;
  lastSyncAt: Date | null;
  orderPullEnabled: boolean;
  lastOrderPullAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSafe(s: RawSite): SafeSite {
  let keyMasked = '';
  let secretMasked = '';
  try {
    keyMasked = maskSecret(decrypt(s.consumerKeyEncrypted));
    secretMasked = maskSecret(decrypt(s.consumerSecretEncrypted));
  } catch {
    // If decryption fails (e.g. wrong key), still return row with placeholder.
    keyMasked = '••••';
    secretMasked = '••••';
  }
  return {
    id: s.id,
    name: s.name,
    baseUrl: s.baseUrl,
    consumerKeyMasked: keyMasked,
    consumerSecretMasked: secretMasked,
    networkRoute: s.networkRoute,
    isActive: s.isActive,
    syncEnabled: s.syncEnabled,
    syncIntervalMs: s.syncIntervalMs,
    lastSyncAt: s.lastSyncAt,
    orderPullEnabled: s.orderPullEnabled,
    lastOrderPullAt: s.lastOrderPullAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpProxyService,
  ) {}

  async list(q: ListSitesQuery): Promise<{ data: SafeSite[]; total: number; page: number; pageSize: number }> {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.siteConfig.count(),
      this.prisma.siteConfig.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { data: rows.map(toSafe), total, page, pageSize };
  }

  async get(id: string): Promise<SafeSite> {
    const s = await this.prisma.siteConfig.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Site not found');
    return toSafe(s);
  }

  async create(dto: CreateSiteDto): Promise<SafeSite> {
    const dup = await this.prisma.siteConfig.findFirst({ where: { name: dto.name } });
    if (dup) throw new ConflictException(`Site with name "${dto.name}" already exists`);

    const created = await this.prisma.siteConfig.create({
      data: {
        name: dto.name,
        baseUrl: dto.baseUrl,
        consumerKeyEncrypted: encrypt(dto.consumerKey),
        consumerSecretEncrypted: encrypt(dto.consumerSecret),
        networkRoute: dto.networkRoute ?? NetworkRoute.DIRECT,
        isActive: dto.isActive ?? true,
      },
    });
    return toSafe(created);
  }

  async update(id: string, dto: UpdateSiteDto): Promise<SafeSite> {
    const existing = await this.prisma.siteConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Site not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl;
    if (dto.networkRoute !== undefined) data.networkRoute = dto.networkRoute;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.syncEnabled !== undefined) data.syncEnabled = dto.syncEnabled;
    if (dto.orderPullEnabled !== undefined) data.orderPullEnabled = dto.orderPullEnabled;
    if (dto.syncIntervalMs !== undefined) {
      if (dto.syncIntervalMs < 60_000 || dto.syncIntervalMs > 86_400_000) {
        throw new BadRequestException('syncIntervalMs must be between 60000 and 86400000 (1 min – 24 h)');
      }
      data.syncIntervalMs = dto.syncIntervalMs;
    }
    if (dto.consumerKey !== undefined) data.consumerKeyEncrypted = encrypt(dto.consumerKey);
    if (dto.consumerSecret !== undefined)
      data.consumerSecretEncrypted = encrypt(dto.consumerSecret);

    const updated = await this.prisma.siteConfig.update({ where: { id }, data });
    return toSafe(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.siteConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Site not found');
    await this.prisma.siteConfig.delete({ where: { id } });
  }

  /**
   * Tests connectivity to a site's WooCommerce API. Hits a cheap endpoint
   * (products?per_page=1) and records the result to SyncLog for diagnostics.
   * Credentials are decrypted in-memory; never returned.
   */
  async testConnection(id: string): Promise<TestConnectionResult> {
    const s = await this.prisma.siteConfig.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Site not found');

    let consumerKey = '';
    let consumerSecret = '';
    try {
      consumerKey = decrypt(s.consumerKeyEncrypted);
      consumerSecret = decrypt(s.consumerSecretEncrypted);
    } catch (err) {
      const result: TestConnectionResult = {
        ok: false,
        latencyMs: 0,
        routeUsed: s.networkRoute,
        attempts: 0,
        error: { code: 'DECRYPT_FAILED', message: (err as Error).message },
      };
      await this.recordSyncLog(s.id, 'test_connection', 'failed', result);
      return result;
    }

    try {
      const res = await this.http.request({
        siteId: s.id,
        networkRoute: s.networkRoute,
        baseUrl: s.baseUrl,
        auth: { username: consumerKey, password: consumerSecret },
      }, {
        method: 'GET',
        path: '/wp-json/wc/v3/products?per_page=1',
      });

      const body = res.body;
      const validJson =
        Array.isArray(body) ||
        (body !== null && typeof body === 'object' && !('code' in (body as object)));
      const result: TestConnectionResult = {
        ok: res.status >= 200 && res.status < 300 && validJson,
        latencyMs: res.latencyMs,
        routeUsed: res.routeUsed,
        attempts: res.attempts,
        status: res.status,
        ...(validJson
          ? {}
          : {
              error: {
                code: 'INVALID_WC_RESPONSE',
                message:
                  'WooCommerce did not return JSON (check permalinks, HTTPS, and REST API keys)',
              },
            }),
      };
      await this.recordSyncLog(
        s.id,
        'test_connection',
        result.ok ? 'success' : 'failed',
        result,
      );
      return result;
    } catch (err) {
      const proxyErr =
        err instanceof HttpProxyError
          ? err
          : new HttpProxyError({
              code: 'UNKNOWN',
              message: (err as Error).message,
              siteId: s.id,
              networkRoute: s.networkRoute,
              attempt: 0,
            });
      const result: TestConnectionResult = {
        ok: false,
        latencyMs: 0,
        routeUsed: s.networkRoute,
        attempts: proxyErr.attempt,
        error: { code: proxyErr.code, message: proxyErr.message },
      };
      await this.recordSyncLog(s.id, 'test_connection', 'failed', {
        ...result,
        proxyError: proxyErr.toSafe(),
      });
      return result;
    }
  }

  private async recordSyncLog(
    siteId: string,
    syncType: string,
    status: string,
    details: unknown,
  ): Promise<void> {
    try {
      await this.prisma.syncLog.create({
        data: {
          siteId,
          syncType,
          status,
          details: details as any,
        },
      });
    } catch {
      // syncLog write must not bubble up from test-connection
    }
  }
}
