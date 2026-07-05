import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ImportExportService } from './import-export.service';
import { ExportProductsQuery, ListImportJobsQuery } from './import-export.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { IMPORT_QUEUE_NAME, IMPORT_MAX_FILE_BYTES } from './import-export.types';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('import-export')
@ApiBearerAuth('access-token')
@Controller('import-export')
export class ImportExportController {
  constructor(
    private readonly service: ImportExportService,
    @InjectQueue(IMPORT_QUEUE_NAME) private readonly importQueue: Queue,
  ) {}

  // ─── Export ────────────────────────────────────────────────────────────────

  @Get('products.xlsx')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({
    summary:
      'Download hub products as xlsx (Products + SiteMapping sheets). Optional filters: category, siteId, minStock, maxStock.',
  })
  async exportProducts(@Query() q: ExportProductsQuery, @Res() res: Response): Promise<void> {
    const buf = await this.service.exportProductsBuffer(q);
    const safeName = this.safeFileName(q);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    res.send(buf);
  }

  @Get('woo-commerce.csv')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({
    summary:
      'Download a WooCommerce-import-ready CSV for a single site. SKU uses the site mapping if present, else hub sku_master.',
  })
  async exportForWooCommerce(
    @Query('wooCommerceForSiteId') siteId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!siteId) throw new BadRequestException('wooCommerceForSiteId query param is required');
    const buf = await this.service.exportWooCommerceBuffer(siteId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="woocommerce-products.csv"`);
    res.send(buf);
  }

  // ─── Import: upload → preview ──────────────────────────────────────────────

  @Post('import/preview')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('IMPORT_PREVIEW')
  @UseInterceptors(AuditInterceptor)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMPORT_MAX_FILE_BYTES },
      storage: undefined, // in-memory; we don't persist the raw file
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary:
      'Upload an xlsx file. Parses + validates without writing to the DB. Returns a preview (creates/updates/errors) keyed by sku_master.',
  })
  @HttpCode(HttpStatus.OK)
  async uploadPreview(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthenticatedUser },
  ) {
    if (!file) throw new BadRequestException('No file uploaded (field name must be "file").');
    return this.service.createPreviewFromUpload(file.originalname, file.buffer, req.user);
  }

  // ─── Import: get preview / commit / cancel ─────────────────────────────────

  @Get('import/:jobId/preview')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({ summary: 'Fetch the persisted preview for an import job.' })
  async getPreview(@Param('jobId') jobId: string) {
    return this.service.getPreview(jobId);
  }

  @Post('import/:jobId/commit')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('IMPORT_COMMIT')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary:
      'Confirm a previewed import. Enqueues a BullMQ job that applies the changes; returns the jobId so the client can poll status.',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async commit(@Param('jobId') jobId: string) {
    // Verify the job exists and is in PREVIEW before enqueuing, for a clear 404/409.
    await this.service.getPreview(jobId);
    await this.importQueue.add('import', { jobId });
    return { jobId, queued: true };
  }

  @Post('import/:jobId/cancel')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({ summary: 'Cancel a PREVIEW job (dismiss without applying).' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Param('jobId') jobId: string): Promise<void> {
    await this.service.cancelJob(jobId);
  }

  // ─── Import: status + history ──────────────────────────────────────────────

  @Get('import/:jobId')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get the status + final report of an import job.' })
  async getJob(@Param('jobId') jobId: string) {
    return this.service.getJob(jobId);
  }

  @Get('import')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List recent import jobs (paginated).' })
  async listJobs(@Query() q: ListImportJobsQuery) {
    return this.service.listJobs({ page: q.page ?? 1, pageSize: q.pageSize ?? 25 });
  }

  private safeFileName(q: ExportProductsQuery): string {
    const parts = ['products'];
    if (q.category) parts.push(`cat-${this.slug(q.category)}`);
    if (q.siteId) parts.push('site');
    if (q.minStock !== undefined || q.maxStock !== undefined) parts.push('filtered');
    return parts.join('-');
  }

  private slug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
  }
}
