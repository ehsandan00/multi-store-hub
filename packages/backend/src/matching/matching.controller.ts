import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MatchingService } from './matching.service';
import {
  BulkApproveQuery,
  ListMatchingJobsQuery,
  ListMatchingSuggestionsQuery,
  UpdateMappingDto,
} from './matching.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { MATCHING_MAX_FILE_BYTES } from './matching.types';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('matching')
@ApiBearerAuth('access-token')
@Controller('matching')
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Post('sites/:siteId/analyze')
  @Roles('ADMIN')
  @Audit('MATCHING_ANALYZE')
  @UseInterceptors(AuditInterceptor)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MATCHING_MAX_FILE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Upload a site product export (csv/xlsx) and run fuzzy + optional AI matching. ' +
      'Creates PENDING_REVIEW SiteProductMapping rows — nothing is auto-approved.',
  })
  async analyze(
    @Param('siteId') siteId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: AuthenticatedUser },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    return this.matching.analyzeUpload(siteId, file.originalname, file.buffer, req.user);
  }

  @Get('suggestions')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List product mapping suggestions awaiting review' })
  listSuggestions(@Query() q: ListMatchingSuggestionsQuery) {
    return this.matching.listSuggestions({
      siteId: q.siteId,
      status: q.status,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 25,
    });
  }

  @Post('suggestions/:id/approve')
  @Roles('ADMIN')
  @Audit('MATCHING_APPROVE')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  approve(@Param('id') id: string) {
    return this.matching.approve(id);
  }

  @Post('suggestions/:id/reject')
  @Roles('ADMIN')
  @Audit('MATCHING_REJECT')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(@Param('id') id: string) {
    return this.matching.reject(id);
  }

  @Post('suggestions/bulk-approve')
  @Roles('ADMIN')
  @Audit('MATCHING_BULK_APPROVE')
  @UseInterceptors(AuditInterceptor)
  bulkApprove(@Query() q: BulkApproveQuery) {
    return this.matching.bulkApprove(q.siteId);
  }

  @Patch('suggestions/:id')
  @Roles('ADMIN')
  @Audit('MATCHING_MANUAL_EDIT')
  @UseInterceptors(AuditInterceptor)
  updateManual(@Param('id') id: string, @Body() dto: UpdateMappingDto) {
    return this.matching.updateManual(id, dto);
  }

  @Get('jobs')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  listJobs(@Query() q: ListMatchingJobsQuery) {
    return this.matching.listJobs({
      siteId: q.siteId,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 25,
    });
  }

  @Get('jobs/:id')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  getJob(@Param('id') id: string) {
    return this.matching.getJob(id);
  }
}
