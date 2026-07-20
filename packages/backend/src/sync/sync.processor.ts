import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SyncService } from './sync.service';
import { OrderPullService } from './order-pull.service';
import { CustomerPullService } from './customer-pull.service';
import { SyncScheduler } from './sync.scheduler';
import { SYNC_QUEUE_NAME } from './sync.types';

/**
 * BullMQ worker for the sync queue. Handles three job shapes:
 *   - { syncJobId: string } (name='push') → run a PUSH sync (hub → site products)
 *   - { syncJobId: string } (name='pull') → run a PULL sync (site → hub orders)
 *   - { tick: true }                       → scheduler tick: enqueue due syncs
 *
 * Concurrency is 1 per worker so a single site's calls are serialized (the
 * WooCommerceClient also rate-limits per site). Multiple worker processes can
 * scale horizontal throughput across *different* sites.
 */
@Processor(SYNC_QUEUE_NAME, { concurrency: 1 })
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private readonly sync: SyncService,
    private readonly orderPull: OrderPullService,
    private readonly customerPull: CustomerPullService,
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

    if (job.name === 'pull') {
      this.logger.log(`Processing order pull job ${syncJobId} (bullmq id=${job.id})`);
      const report = await this.orderPull.runPull(syncJobId);
      this.logger.log(
        `Order pull job ${syncJobId} done: pulled=${report.pulled} created=${report.created} updated=${report.updated} failed=${report.failed}`,
      );
      return report;
    }

    if (job.name === 'pull-customers') {
      this.logger.log(`Processing customer pull job ${syncJobId} (bullmq id=${job.id})`);
      const report = await this.customerPull.runPull(syncJobId);
      this.logger.log(
        `Customer pull job ${syncJobId} done: pulled=${report.pulled} created=${report.created} updated=${report.updated} failed=${report.failed}`,
      );
      return report;
    }

    this.logger.log(`Processing push sync job ${syncJobId} (bullmq id=${job.id})`);
    const report = await this.sync.runPush(syncJobId);
    this.logger.log(
      `Sync job ${syncJobId} done: pushed=${report.pushed} created=${report.created} updated=${report.updated} failed=${report.failed}`,
    );
    return report;
  }
}
