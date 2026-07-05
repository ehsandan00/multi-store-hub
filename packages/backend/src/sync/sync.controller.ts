import {
  Body,
  Controller,
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
import { ListSyncQuery, PushSyncDto, UpdateScheduleDto } from './sync.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('sync')
@ApiBearerAuth('access-token')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

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

  // ─── Schedule config ──────────────────────────────────────────────────────

  @Patch('sites/:siteId/schedule')
  @Roles('ADMIN')
  @Audit('SYNC_SCHEDULE_UPDATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Enable/disable scheduled sync and set the interval (admin only, audited).' })
  async updateSchedule(
    @Param('siteId') siteId: string,
    @Body() dto: UpdateScheduleDto,
  ) {
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
}
