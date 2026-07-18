import { Module } from '@nestjs/common';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { HttpProxyModule } from '../http-proxy/http-proxy.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [HttpProxyModule, AuditLogModule, SyncModule],
  providers: [SitesService],
  controllers: [SitesController],
  exports: [SitesService],
})
export class SitesModule {}
