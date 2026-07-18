import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigModule } from '@nestjs/config';
import { AppModule } from './app.module';

/**
 * Builds the OpenAPI document at build time and writes it to ./swagger.json,
 * so CI can publish it alongside the API.
 */
async function exportSwagger() {
  ConfigModule.forRoot({ isGlobal: true });
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const config = new DocumentBuilder()
    .setTitle('Multi-Store Hub API')
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  writeFileSync(resolve(process.cwd(), 'swagger.json'), JSON.stringify(doc, null, 2));
  await app.close();
}

void exportSwagger();
