import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SitePlatform } from '@prisma/client';
import { decrypt } from '../config/crypto.util';
import { HttpProxyService } from '../http-proxy/http-proxy.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASPNET_SYNC_API_PREFIX,
  ASPNET_SYNC_BATCH_SIZE,
  type AspNetBulkUpdateResponse,
  type AspNetHealthResponse,
  type AspNetLookupRequest,
  type AspNetLookupResponse,
  type AspNetPriceStockUpdate,
} from './aspnet-product.types';

interface AspNetCredentials {
  siteId: string;
  baseUrl: string;
  networkRoute: 'DIRECT' | 'VIA_FOREIGN_PROXY';
  apiKey: string;
  apiSecret: string;
}

@Injectable()
export class AspNetProductClient {
  constructor(
    private readonly http: HttpProxyService,
    private readonly prisma: PrismaService,
  ) {}

  async health(siteId: string): Promise<{
    body: AspNetHealthResponse;
    status: number;
    latencyMs: number;
    attempts: number;
    routeUsed: 'DIRECT' | 'VIA_FOREIGN_PROXY';
  }> {
    const credentials = await this.loadCredentials(siteId);
    const response = await this.request<AspNetHealthResponse>(credentials, 'GET', '/health');
    return response;
  }

  async lookup(siteId: string, request: AspNetLookupRequest): Promise<AspNetLookupResponse> {
    const credentials = await this.loadCredentials(siteId);
    const response = await this.request<AspNetLookupResponse>(
      credentials,
      'POST',
      '/products/lookup',
      request,
    );
    return response.body;
  }

  async bulkUpdate(
    siteId: string,
    items: AspNetPriceStockUpdate[],
  ): Promise<AspNetBulkUpdateResponse> {
    const credentials = await this.loadCredentials(siteId);
    const results: AspNetBulkUpdateResponse['results'] = [];

    for (let offset = 0; offset < items.length; offset += ASPNET_SYNC_BATCH_SIZE) {
      const batch = items.slice(offset, offset + ASPNET_SYNC_BATCH_SIZE);
      const response = await this.request<AspNetBulkUpdateResponse>(
        credentials,
        'PATCH',
        '/products/price-stock',
        {
          idempotencyKey: randomUUID(),
          items: batch,
        },
      );
      results.push(...response.body.results);
    }

    return { results };
  }

  private async loadCredentials(siteId: string): Promise<AspNetCredentials> {
    const site = await this.prisma.siteConfig.findUnique({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');
    if (site.platform !== SitePlatform.NOPCOMMERCE_ASPNET) {
      throw new Error(`Site ${siteId} is not an ASP.NET/nopCommerce site`);
    }
    return {
      siteId,
      baseUrl: site.baseUrl,
      networkRoute: site.networkRoute,
      apiKey: decrypt(site.consumerKeyEncrypted),
      apiSecret: decrypt(site.consumerSecretEncrypted),
    };
  }

  private async request<T>(
    credentials: AspNetCredentials,
    method: 'GET' | 'POST' | 'PATCH',
    relativePath: string,
    body?: unknown,
  ) {
    const path = `${ASPNET_SYNC_API_PREFIX}${relativePath}`;
    const serializedBody = body === undefined ? '' : JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const bodyHash = createHash('sha256').update(serializedBody).digest('hex');
    const canonical = `${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`;
    const signature = createHmac('sha256', credentials.apiSecret).update(canonical).digest('hex');

    return this.http.request<T>(
      {
        siteId: credentials.siteId,
        baseUrl: credentials.baseUrl,
        networkRoute: credentials.networkRoute,
      },
      {
        method,
        path,
        body: serializedBody || undefined,
        headers: {
          'x-hub-key': credentials.apiKey,
          'x-hub-timestamp': timestamp,
          'x-hub-nonce': nonce,
          'x-hub-signature': signature,
        },
      },
    );
  }
}
