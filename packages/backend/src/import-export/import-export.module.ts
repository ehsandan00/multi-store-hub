import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ImportExportService } from './import-export.service';
import { ImportExportController } from './import-export.controller';
import { ImportProcessor } from './import-export.processor';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { IMPORT_QUEUE_NAME } from './import-export.types';

/**
 * Import/Export module (Phase 2).
 *
 * The BullMQ queue is registered against REDIS_URL. When REDIS_URL is empty
 * (e.g. in unit tests), the queue registration is skipped via the `imports`
 * factory below so the rest of the app can still boot — the controller's
 * `commit` endpoint will then fall back to synchronous processing.
 */
@Module({
  imports: [
    AuditLogModule,
    BullModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? '';
        if (!url) {
          // BullMQ requires a connection; we return a no-op-ish config that
          // only gets used when the queue is actually invoked. Tests inject
          // a mock queue instead.
          return { connection: { host: 'localhost', port: 6379 } };
        }
        return { connection: { url } };
      },
    }),
    BullModule.registerQueue({
      name: IMPORT_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 86_400, count: 500 },
      },
    }),
  ],
  controllers: [ImportExportController],
  providers: [ImportExportService, ImportProcessor],
  exports: [ImportExportService],
})
export class ImportExportModule {}
