import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';
import { SYNC_QUEUE_NAME } from './sync.types';

/**
 * Periodic sync scheduler.
 *
 * On boot, registers a single repeatable BullMQ job (the "tick") that fires
 * every minute. On each tick it queries the DB for sites with syncEnabled=true
 * whose lastSyncAt is older than their syncIntervalMs, and enqueues a PUSH
 * SyncJob for each. This design (one fast tick + per-site gating in the DB)
 * keeps the scheduler trivial and lets admins change intervals per site
 * without redeploying or re-registering repeatable jobs.
 *
 * Why polling instead of webhooks: the spec calls out that several sites are
 * behind filtering/proxies, so inbound webhooks are unreliable. Polling is
 * the primary mechanism; the architecture allows adding a webhook receiver
 * later that simply calls enqueuePush() on receipt.
 */
@Injectable()
export class SyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncScheduler.name);
  private static readonly TICK_ID = 'sync-scheduler-tick';
  private static readonly TICK_EVERY_MS = 60_000;

  constructor(
    @InjectQueue(SYNC_QUEUE_NAME) private readonly syncQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncQueue.add(
        SyncScheduler.TICK_ID,
        { tick: true },
        {
          repeat: { every: SyncScheduler.TICK_EVERY_MS },
          jobId: SyncScheduler.TICK_ID,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      this.logger.log(`Scheduler tick registered (every ${SyncScheduler.TICK_EVERY_MS}ms)`);
    } catch (err) {
      this.logger.warn(`Could not register scheduler tick: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.syncQueue.removeRepeatableByKey(SyncScheduler.TICK_ID);
    } catch {
      // best-effort
    }
  }

  /**
   * Called by the BullMQ processor when a tick job fires. Enqueues PUSH syncs
   * for all due sites. Exposed publicly so it's testable without BullMQ.
   */
  async runTick(): Promise<{ enqueued: number; siteIds: string[] }> {
    const dueSites = await this.prisma.siteConfig.findMany({
      where: { isActive: true, syncEnabled: true },
      select: { id: true, name: true, syncIntervalMs: true, lastSyncAt: true },
    });
    const now = Date.now();
    const due = dueSites.filter((s) => {
      if (!s.lastSyncAt) return true;
      return now - s.lastSyncAt.getTime() >= s.syncIntervalMs;
    });
    const enqueued: string[] = [];
    for (const s of due) {
      try {
        await this.sync.enqueuePush(s.id, 'ALL');
        enqueued.push(s.id);
      } catch (err) {
        this.logger.warn(`Failed to enqueue scheduled sync for site ${s.name}: ${(err as Error).message}`);
      }
    }
    if (enqueued.length) {
      this.logger.log(`Scheduler tick: enqueued ${enqueued.length} site sync(s)`);
    }
    return { enqueued: enqueued.length, siteIds: enqueued };
  }
}
