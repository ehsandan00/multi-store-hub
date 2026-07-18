import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MatchingService } from './matching.service';
import { ClaudeMatcherService } from './claude-matcher.service';
import { MatchingController } from './matching.controller';

@Module({
  imports: [AuditLogModule],
  controllers: [MatchingController],
  providers: [MatchingService, ClaudeMatcherService],
  exports: [MatchingService],
})
export class MatchingModule {}
