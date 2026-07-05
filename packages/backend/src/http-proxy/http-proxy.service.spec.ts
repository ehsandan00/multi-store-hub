import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { HttpProxyService } from './http-proxy.service';
import { HttpProxyError } from './http-proxy.error';
import type { Dispatcher } from 'undici';

function mockConfig(overrides: Record<string, unknown> = {}): ConfigService<any, true> {
  return {
    get: (key: string) => {
      const env: Record<string, unknown> = {
        HTTP_TIMEOUT_DIRECT_MS: 1000,
        HTTP_TIMEOUT_PROXY_MS: 2000,
        HTTP_RETRIES_DIRECT: 1,
        HTTP_RETRIES_PROXY: 2,
        FOREIGN_PROXY_URL: 'http://proxy.example.com:8080',
        FOREIGN_PROXY_USERNAME: '',
        FOREIGN_PROXY_PASSWORD: '',
        ...overrides,
      };
      return env[key];
    },
  } as unknown as ConfigService<any, true>;
}

function makeFakeDispatcher(handlers: ((req: any) => any)[]): Dispatcher {
  let i = 0;
  return {
    request: async (opts: any) => {
      const handler = handlers[i++] ?? handlers[handlers.length - 1];
      return handler(opts);
    },
  } as unknown as Dispatcher;
}

describe('HttpProxyService', () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.FOREIGN_PROXY_URL = 'http://proxy.example.com:8080';
  });
  beforeEach(() => {
    process.env = originalEnv;
  });

  it('uses the proxy dispatcher for VIA_FOREIGN_PROXY', async () => {
    let calledTimes = 0;
    const svc = new HttpProxyService(mockConfig());
    const fake = makeFakeDispatcher([
      (req) => {
        calledTimes++;
        // The request must be routed through the injected (proxy) dispatcher,
        // and basic-auth header must be present from site.auth.
        expect(req.headers.authorization).toMatch(/^Basic /);
        return {
          statusCode: 200,
          body: { text: async () => '{"ok":true}' },
        };
      },
    ]);
    svc._dispatcherForTesting = fake;

    const res = await svc.request(
      {
        networkRoute: 'VIA_FOREIGN_PROXY',
        baseUrl: 'https://example.com',
        auth: { username: 'k', password: 's' },
      },
      { method: 'GET', path: '/wp-json/wc/v3/products?per_page=1' },
    );

    expect(res.status).toBe(200);
    expect(res.routeUsed).toBe('VIA_FOREIGN_PROXY');
    expect((res.body as any).ok).toBe(true);
    expect(calledTimes).toBe(1);
  });

  it('retries on 5xx then succeeds', async () => {
    const svc = new HttpProxyService(mockConfig({ HTTP_RETRIES_DIRECT: 2 }));
    svc._dispatcherForTesting = makeFakeDispatcher([
      () => ({ statusCode: 503, body: { text: async () => 'oops' } }),
      () => ({ statusCode: 503, body: { text: async () => 'oops' } }),
      () => ({ statusCode: 200, body: { text: async () => '{"ok":true}' } }),
    ]);

    const res = await svc.request(
      { networkRoute: 'DIRECT', baseUrl: 'https://example.com' },
      { method: 'GET', path: '/x' },
    );
    expect(res.status).toBe(200);
    expect(res.attempts).toBe(3);
  });

  it('does NOT retry on 4xx (other than 429) — throws immediately', async () => {
    const svc = new HttpProxyService(mockConfig({ HTTP_RETRIES_DIRECT: 3 }));
    let calls = 0;
    svc._dispatcherForTesting = makeFakeDispatcher([
      () => {
        calls++;
        return { statusCode: 404, body: { text: async () => 'not found' } };
      },
    ]);

    await expect(
      svc.request({ networkRoute: 'DIRECT', baseUrl: 'https://example.com' }, { method: 'GET', path: '/x' }),
    ).rejects.toThrow(HttpProxyError);
    expect(calls).toBe(1);
  });

  it('retries on network errors and ultimately throws HttpProxyError with safe payload', async () => {
    const svc = new HttpProxyService(mockConfig({ HTTP_RETRIES_DIRECT: 1 }));
    svc._dispatcherForTesting = makeFakeDispatcher([
      () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
      () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    ]);

    try {
      await svc.request(
        { siteId: 's1', networkRoute: 'DIRECT', baseUrl: 'https://example.com' },
        { method: 'GET', path: '/x' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpProxyError);
      const safe = (err as HttpProxyError).toSafe();
      expect(safe.code).toBe('ECONNREFUSED');
      expect(safe.siteId).toBe('s1');
      expect(safe.networkRoute).toBe('DIRECT');
      expect(safe.attempt).toBe(2);
    }
  });

  it('throws a typed error when proxy is required but FOREIGN_PROXY_URL is unset', async () => {
    const svc = new HttpProxyService(mockConfig({ FOREIGN_PROXY_URL: '' }));
    await expect(
      svc.request(
        { networkRoute: 'VIA_FOREIGN_PROXY', baseUrl: 'https://example.com' },
        { method: 'GET', path: '/x' },
      ),
    ).rejects.toMatchObject({ code: 'PROXY_NOT_CONFIGURED' });
  });
});
