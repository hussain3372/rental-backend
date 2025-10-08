import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { S3StorageProvider } from './providers/s3-storage.provider';
import { LoggerModule } from '../../common/logger/logger.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ConfigModule, LoggerModule, AuditModule],
  providers: [
    StorageService,
    S3StorageProvider,
  ],
  exports: [StorageService],
})
export class StorageModule {}