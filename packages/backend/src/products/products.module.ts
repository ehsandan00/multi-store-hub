import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [AuditLogModule, MatchingModule],
  providers: [ProductsService],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}