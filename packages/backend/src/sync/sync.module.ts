import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncProcessor } from './sync.processor';
import { SyncScheduler } from './sync.scheduler';
import { WooCommerceClient } from './woocommerce-client';
import { HttpProxyModule } from '../http-proxy/http-proxy.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SYNC_QUEUE_NAME } from './sync.types';

/**
 * WooCommerce sync module (Phase 3: hub → site push).
 *
 * Registers the SYNC_QUEUE against REDIS_URL via BullMQ. The processor hosts
 * both push jobs and the scheduler's per-minute tick. When REDIS_URL is empty
 * (unit tests), the queue registration still succeeds against a default
 * localhost connection — tests inject a mock queue instead of hitting it.
 */
@Module({
  imports: [
    HttpProxyModule,
    AuditLogModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? '';
        return { connection: url ? { url } : { host: 'localhost', port: 6379 } };
      },
    }),
    BullModule.registerQueue({
      name: SYNC_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 86_400, count: 500 },
      },
    }),
  ],
  controllers: [SyncController],
  providers: [SyncService, WooCommerceClient, SyncProcessor, SyncScheduler],
  exports: [SyncService, WooCommerceClient],
})
export class SyncModule {}
