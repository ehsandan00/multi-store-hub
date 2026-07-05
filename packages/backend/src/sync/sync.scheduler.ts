import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';
import { OrderPullService } from './order-pull.service';
import { SYNC_QUEUE_NAME } from './sync.types';

/**
 * Periodic sync scheduler.
 *
 * On boot, registers a single repeatable BullMQ job (the "tick") that fires
 * every minute. On each tick it:
 *   1. Enqueues a PUSH sync for sites with syncEnabled=true whose lastSyncAt
 *      is older than their syncIntervalMs (Phase 3: hub → site products).
 *   2. Enqueues a PULL sync for sites with orderPullEnabled=true whose
 *      lastOrderPullAt is older than syncIntervalMs (Phase 4: site → hub orders).
 *
 * This design (one fast tick + per-site gating in the DB) keeps the scheduler
 * trivial and lets admins change intervals per site without redeploying or
 * re-registering repeatable jobs.
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
    private readonly orderPull: OrderPullService,
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
   * Called by the BullMQ processor when a tick job fires. Enqueues PUSH and
   * PULL syncs for all due sites. Exposed publicly so it's testable without BullMQ.
   */
  async runTick(): Promise<{ enqueued: number; siteIds: string[] }> {
    const now = Date.now();
    const enqueued: string[] = [];

    // ─── PUSH: sites due for a product push ────────────────────────────────
    const pushSites = await this.prisma.siteConfig.findMany({
      where: { isActive: true, syncEnabled: true },
      select: { id: true, name: true, syncIntervalMs: true, lastSyncAt: true },
    });
    for (const s of pushSites) {
      const due = !s.lastSyncAt || now - s.lastSyncAt.getTime() >= s.syncIntervalMs;
      if (!due) continue;
      try {
        await this.sync.enqueuePush(s.id, 'ALL');
        enqueued.push(s.id);
      } catch (err) {
        this.logger.warn(`Failed to enqueue scheduled push for site ${s.name}: ${(err as Error).message}`);
      }
    }

    // ─── PULL: sites due for an order pull ──────────────────────────────────
    const pullSites = await this.prisma.siteConfig.findMany({
      where: { isActive: true, orderPullEnabled: true },
      select: { id: true, name: true, syncIntervalMs: true, lastOrderPullAt: true },
    });
    for (const s of pullSites) {
      const due = !s.lastOrderPullAt || now - s.lastOrderPullAt.getTime() >= s.syncIntervalMs;
      if (!due) continue;
      try {
        await this.orderPull.enqueuePull(s.id);
        enqueued.push(s.id);
      } catch (err) {
        this.logger.warn(`Failed to enqueue scheduled order pull for site ${s.name}: ${(err as Error).message}`);
      }
    }

    if (enqueued.length) {
      this.logger.log(`Scheduler tick: enqueued ${enqueued.length} sync(s)`);
    }
    return { enqueued: enqueued.length, siteIds: enqueued };
  }
}
