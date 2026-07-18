import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { Environment } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService<Environment, true>);

  const port = config.get('PORT', { infer: true }) ?? 3001;
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true }) ?? 'http://localhost:5173';
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  // Security headers
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Body limits (guard against oversized payloads)
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  const corsOrigins = corsOrigin.split(',').map((o) => o.trim());
  const isPrivateLanOrigin = (origin: string) =>
    /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
      origin,
    );

  // CORS
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (!isProd && isPrivateLanOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Global validation: whitelist + forbid non-whitelisted + transform payloads
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter (structured JSON, no stack leak in prod)
  app.useGlobalFilters(new AllExceptionsFilter(isProd));

  // Strip @Exclude() fields from responses (e.g. passwordHash)
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Swagger / OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Multi-Store Hub API')
    .setDescription(
      'Centralized hub for managing products, inventory, and orders across 8 WooCommerce stores. ' +
        'Phase 1: auth + RBAC, products, sites, test-connection. ' +
        'Phase 2: Excel import/export with preview + BullMQ-queued commits. ' +
        'Phase 3: WooCommerce product sync (hub -> site) with idempotent upserts, ' +
        'per-site rate limiting, scheduled syncs, and sync job/log history. ' +
        'Phase 4: order pull (site -> hub), cross-store orders API, dashboard analytics. ' +
        'Phase 5: AI product matching (fuzzball + optional Claude) with admin review UI.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization', in: 'header' },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`\n🚀 Multi-Store Hub API listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`📚 Swagger UI:           http://localhost:${port}/api/docs\n`);
}

void bootstrap();
