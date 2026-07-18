import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { SitesModule } from './sites/sites.module';
import { HttpProxyModule } from './http-proxy/http-proxy.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { ImportExportModule } from './import-export/import-export.module';
import { SyncModule } from './sync/sync.module';
import { OrdersModule } from './orders/orders.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MatchingModule } from './matching/matching.module';
import { ReportsModule } from './reports/reports.module';
import { LogisticsOrdersModule } from './logistics-orders/logistics-orders.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { envSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '../../.env'),
        resolve(process.cwd(), '.env'),
      ],
      validate: (raw) => envSchema.parse(raw) as any,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          name: 'short',
          ttl: Number(process.env.THROTTLE_TTL ?? 60_000),
          limit: Number(process.env.THROTTLE_LIMIT ?? 5),
        },
      ],
    }),
    PrismaModule,
    AuditLogModule,
    HttpProxyModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    SitesModule,
    ImportExportModule,
    SyncModule,
    OrdersModule,
    DashboardModule,
    MatchingModule,
    ReportsModule,
    LogisticsOrdersModule,
  ],
  providers: [
    // JwtAuthGuard as default global guard; controllers can opt out with @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
