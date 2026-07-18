import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ImportExportService } from './import-export.service';
import { IMPORT_QUEUE_NAME } from './import-export.types';

/**
 * BullMQ worker that applies a persisted PREVIEW import job to the database.
 * The job's `data` is just `{ jobId: string }`; the heavy payload lives on the
 * ImportJob row so the queue stays light and restart-safe.
 */
@Processor(IMPORT_QUEUE_NAME, { concurrency: 1 })
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly imports: ImportExportService) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<unknown> {
    this.logger.log(`Processing import job ${job.data.jobId} (bullmq id=${job.id})`);
    const report = await this.imports.commitJob(job.data.jobId);
    this.logger.log(
      `Import job ${job.data.jobId} done: created=${report.created} updated=${report.updated} failed=${report.failed}`,
    );
    return report;
  }
}
