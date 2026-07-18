import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { LogisticsOrdersController } from './logistics-orders.controller';
import { LogisticsOrdersService } from './logistics-orders.service';

@Module({
  imports: [AuditLogModule],
  controllers: [LogisticsOrdersController],
  providers: [LogisticsOrdersService],
})
export class LogisticsOrdersModule {}
