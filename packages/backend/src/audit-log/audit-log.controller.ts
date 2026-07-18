import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogsQuery } from './audit-log.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('audit-log')
@ApiBearerAuth('access-token')
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List audit log entries (admin only)' })
  list(@Query() q: ListAuditLogsQuery) {
    return this.auditLog.list({
      userId: q.userId,
      action: q.action,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 50,
    });
  }
}
