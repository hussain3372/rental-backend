// src/modules/s3module/s3.module.ts
import { Module } from '@nestjs/common';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';
import { S3Controller } from '@/modules/s3module/s3.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule], // Import PrismaModule
  controllers: [S3Controller],
  providers: [
    {
      provide: 'S3_CLIENT',
      useFactory: (config: ConfigService) => {
        console.log('🔧 AWS S3 Configuration:', {
          region: config.get('AWS_REGION'),
          bucket: config.get('S3_BUCKET_NAME'),
          accessKeyId: config.get('AWS_ACCESS_KEY_ID')?.slice(0, 4) + '...',
          secretKey: config.get('AWS_SECRET_ACCESS_KEY') ? '✅ Loaded' : '❌ Missing',
        });

        return new S3Client({
          region: config.get('AWS_REGION'),
          credentials: {
            accessKeyId: config.get('AWS_ACCESS_KEY_ID'),
            secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY'),
          },
        });
      },
      inject: [ConfigService],
    },
    StorageService,
  ],
  exports: ['S3_CLIENT', StorageService],
})
export class S3Module {}