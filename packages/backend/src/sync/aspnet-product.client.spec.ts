import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { encrypt } from '../config/crypto.util';
import type { HttpProxyService } from '../http-proxy/http-proxy.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AspNetProductClient } from './aspnet-product.client';
import contractFixture from './fixtures/aspnet-contract.fixture.json';

describe('AspNetProductClient', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
  });

  function setup(responseBody: unknown) {
    const prisma = {
      siteConfig: {
        findUnique: async () => ({
          id: 'asp1',
          baseUrl: 'https://asp.example',
          networkRoute: 'DIRECT',
          platform: 'NOPCOMMERCE_ASPNET',
          consumerKeyEncrypted: encrypt('client-key'),
          consumerSecretEncrypted: encrypt('signing-secret'),
        }),
      },
    } as unknown as PrismaService;
    const request = jest.fn(async () => ({
      status: 200,
      body: responseBody,
      routeUsed: 'DIRECT',
      latencyMs: 5,
      attempts: 1,
    }));
    const client = new AspNetProductClient({ request } as unknown as HttpProxyService, prisma);
    return { client, request };
  }

  it('signs the exact method, path, nonce, timestamp, and body hash', async () => {
    const { client, request } = setup({
      items: [],
      unresolvedSourceProductIds: [12],
      unresolvedSkus: ['SKU-12'],
      duplicateSkus: [],
    });

    await client.lookup('asp1', {
      sourceProductIds: [12],
      sourceCombinationIds: [],
      skus: ['SKU-12'],
    });

    const [, options] = request.mock.calls[0] as any[];
    const headers = options.headers as Record<string, string>;
    const bodyHash = createHash('sha256').update(options.body).digest('hex');
    const canonical = `${headers['x-hub-timestamp']}\n${headers['x-hub-nonce']}\nPOST\n${options.path}\n${bodyHash}`;
    const expected = createHmac('sha256', 'signing-secret').update(canonical).digest('hex');

    expect(options.path).toBe('/api/multi-store-hub/v1/products/lookup');
    expect(headers['x-hub-key']).toBe('client-key');
    expect(headers['x-hub-signature']).toBe(expected);
  });

  it('splits bulk updates into bounded batches of 100', async () => {
    const response = {
      results: Array.from({ length: 100 }, (_, index) => ({
        sku: `SKU-${index}`,
        status: 'updated',
      })),
    };
    const { client, request } = setup(response);
    const updates = Array.from({ length: 201 }, (_, index) => ({
      sku: `SKU-${index}`,
      price: '1000',
      stockQuantity: index,
    }));

    await client.bulkUpdate('asp1', updates);

    expect(request).toHaveBeenCalledTimes(3);
    const sizes = request.mock.calls.map((call: any) => JSON.parse(call[1].body).items.length);
    expect(sizes).toEqual([100, 100, 1]);
  });

  it('matches the product and combination contract exported from the restored backup', async () => {
    const lookupSetup = setup(contractFixture.lookupResponse);
    const lookup = await lookupSetup.client.lookup('asp1', contractFixture.lookupRequest);
    expect(lookup).toEqual(contractFixture.lookupResponse);

    const updateSetup = setup({
      results: contractFixture.updates.map((item) => ({
        ...item,
        status: 'updated',
      })),
    });
    await updateSetup.client.bulkUpdate('asp1', contractFixture.updates);
    const [, options] = updateSetup.request.mock.calls[0] as any[];
    expect(JSON.parse(options.body).items).toEqual(contractFixture.updates);
    expect(JSON.parse(options.body).items[1]).toMatchObject({
      sourceCombinationId: 6711,
      price: '3400000',
      stockQuantity: 95,
    });
  });
});
