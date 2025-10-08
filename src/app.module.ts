import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';

// Core modules
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';

// Common modules
import { LoggerModule } from './common/logger/logger.module';
import { CacheModule } from './common/cache/cache.module';
import { MailModule } from './common/mail/mail.module';

// Health module
import { HealthModule } from './modules/health/health.module';

// Application module
import { ApplicationModule } from './modules/application/application.module';

// Document module
import { DocumentModule } from './modules/document/document.module';

// Certification module
import { CertificationModule } from './modules/certification/certification.module';

// Admin module
import { AdminModule } from './modules/admin/admin.module';

// Payment module
import { PaymentModule } from './modules/payment/payment.module';

// Public module
import { PublicModule } from './modules/public/public.module';

// Notification module
import { NotificationModule } from './modules/notification/notification.module';

// Support module
import { SupportModule } from './modules/support/support.module';

// Global exception filter
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { S3Module } from './modules/s3module/s3.module';
import { SettingModule } from './modules/setting/setting.module';
import { ChecklistModule } from './modules/checklist/checklist.module';
import { PropertyTypesModule } from './modules/propertyTypes/propertyTypes.module';
import { TwofaModule } from './modules/twofa/twofa.module';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('RATE_LIMIT_TTL', 60) * 1000, // Convert to milliseconds
          limit: config.get<number>('RATE_LIMIT_MAX', 100),
        },
      ],
    }),

    // Database
    PrismaModule,

    S3Module,

    SettingModule,

    // Caching
    CacheModule,

    // Logging
    LoggerModule,

    // Email
    MailModule,

    ChecklistModule,
    PropertyTypesModule,

    // Feature modules
    HealthModule,
    AuthModule,
    ApplicationModule,
    DocumentModule,
    CertificationModule,
    AdminModule,
    PaymentModule,
    PublicModule,
    NotificationModule,
    SupportModule,
    TwofaModule
  ],
  providers: [
    // Global guards
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Global filters
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply middleware if needed
  }
}
