import { Module, Global } from '@nestjs/common';
import { envSchema, type Environment } from './env.validation';

/**
 * ConfigModule is set up globally in AppModule via ConfigModule.forRoot({ validate }).
 * This module re-exports typed helpers. Importing ConfigService<Environment, true>
 * anywhere gives fully-typed config access.
 */
@Global()
@Module({
  providers: [
    {
      provide: 'ENV_VALIDATED',
      useFactory: () => envSchema.parse(process.env),
    },
  ],
  exports: ['ENV_VALIDATED'],
})
export class ConfigModule {}
