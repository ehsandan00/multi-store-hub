import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SyncService } from './sync.service';
import { SyncScheduler } from './sync.scheduler';
import { SYNC_QUEUE_NAME } from './sync.types';

/**
 * BullMQ worker for the sync queue. Handles two job shapes:
 *   - { syncJobId: string }  → run a PUSH sync (the heavy path)
 *   - { tick: true }          → scheduler tick: enqueue due site syncs
 *
 * Concurrency is 1 per worker so a single site's pushes are serialized (the
 * WooCommerceClient also rate-limits per site). Multiple worker processes
 * can scale horizontal throughput across *different* sites.
 */
@Processor(SYNC_QUEUE_NAME, { concurrency: 1 })
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly sync: SyncService,
    private readonly scheduler: SyncScheduler,
  ) {
    super();
  }

  async process(job: Job<{ syncJobId?: string; tick?: boolean }>): Promise<unknown> {
    if (job.data.tick) {
      return this.scheduler.runTick();
    }
    const syncJobId = job.data.syncJobId;
    if (!syncJobId) throw new Error('Sync job missing syncJobId');
    this.logger.log(`Processing sync job ${syncJobId} (bullmq id=${job.id})`);
    const report = await this.sync.runPush(syncJobId);
    this.logger.log(
      `Sync job ${syncJobId} done: pushed=${report.pushed} created=${report.created} updated=${report.updated} failed=${report.failed}`,
    );
    return report;
  }
}
