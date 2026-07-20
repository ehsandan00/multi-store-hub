import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { OrderPullService } from './order-pull.service';
import { CustomerPullService } from './customer-pull.service';
import { ImportAspNetMappingsDto, ListSyncQuery, PushSyncDto, UpdateScheduleDto } from './sync.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('sync')
@ApiBearerAuth('access-token')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly orderPull: OrderPullService,
    private readonly customerPull: CustomerPullService,
  ) {}

  // ─── Push ─────────────────────────────────────────────────────────────────

  @Post('sites/:siteId/push')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('SYNC_PUSH')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary:
      'Enqueue a hub→site product push (BullMQ). Returns the SyncJob id so the client can poll status. Idempotent by SKU.',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async push(
    @Param('siteId') siteId: string,
    @Body() dto: PushSyncDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    return this.sync.enqueuePush(siteId, dto.scope ?? 'ALL', dto.productIds, req.user);
  }

  @Post('sites/:siteId/aspnet/preview')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('ASPNET_SYNC_PREVIEW')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary: 'Dry-run ASP.NET price/stock matching without writing to the remote site.',
  })
  async previewAspNet(@Param('siteId') siteId: string, @Body() dto: PushSyncDto) {
    return this.sync.previewAspNetPriceStock(siteId, dto.scope ?? 'PRICE_STOCK', dto.productIds);
  }

  @Post('sites/:siteId/aspnet/mappings')
  @Roles('ADMIN')
  @Audit('ASPNET_MAPPING_IMPORT')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Import ASP.NET source product ids matched to Hub SKUs.' })
  async importAspNetMappings(
    @Param('siteId') siteId: string,
    @Body() dto: ImportAspNetMappingsDto,
  ) {
    return this.sync.importAspNetMappings(siteId, dto.rows);
  }

  // ─── Order pull (Phase 4: site → hub) ─────────────────────────────────────

  @Post('sites/:siteId/pull')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('ORDER_PULL')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary:
      'Enqueue a site→hub order pull (BullMQ). Incremental via lastOrderPullAt cursor. Idempotent by (siteId, remoteOrderId).',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async pull(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.orderPull.enqueuePull(siteId, req.user);
  }

  @Post('sites/:siteId/pull-customers')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('CUSTOMER_PULL')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary:
      'Enqueue a site→hub customer pull (BullMQ). WooCommerce only. Incremental via lastCustomerPullAt.',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async pullCustomers(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.customerPull.enqueuePull(siteId, req.user);
  }

  // ─── Schedule config ──────────────────────────────────────────────────────

  @Patch('sites/:siteId/schedule')
  @Roles('ADMIN')
  @Audit('SYNC_SCHEDULE_UPDATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary: 'Enable/disable scheduled sync and set the interval (admin only, audited).',
  })
  async updateSchedule(@Param('siteId') siteId: string, @Body() dto: UpdateScheduleDto) {
    return this.sync.updateSiteSchedule(siteId, dto);
  }

  // ─── Status / history ─────────────────────────────────────────────────────

  @Get('jobs')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List recent sync jobs (paginated, optional site filter).' })
  async listJobs(@Query() q: ListSyncQuery) {
    return this.sync.listJobs({ siteId: q.siteId, page: q.page ?? 1, pageSize: q.pageSize ?? 25 });
  }

  @Get('jobs/:id')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get a sync job by id (status + final report).' })
  async getJob(@Param('id') id: string) {
    return this.sync.getJob(id);
  }

  @Get('logs')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List sync logs (paginated, optional site filter).' })
  async listLogs(@Query() q: ListSyncQuery) {
    return this.sync.listLogs({ siteId: q.siteId, page: q.page ?? 1, pageSize: q.pageSize ?? 25 });
  }

  @Delete('logs/failed')
  @Roles('ADMIN')
  @Audit('SYNC_LOG_CLEAR_FAILED')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete all failed/partial sync logs (optional site filter). Clears dashboard sync alerts.',
  })
  async clearFailedLogs(@Query() q: ListSyncQuery) {
    return this.sync.clearFailedLogs(q.siteId);
  }

  @Delete('logs/:id')
  @Roles('ADMIN')
  @Audit('SYNC_LOG_DELETE')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a single sync log entry (admin only).' })
  async deleteLog(@Param('id') id: string) {
    await this.sync.deleteLog(id);
  }
}
