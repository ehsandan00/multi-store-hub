import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { envSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
  ],
  providers: [
    // JwtAuthGuard as default global guard; controllers can opt out with @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
