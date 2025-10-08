import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CustomLogger } from './logger.service';
import { EnhancedLoggerService } from './enhanced-logger.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CustomLogger, EnhancedLoggerService],
  exports: [CustomLogger, EnhancedLoggerService],
})
export class LoggerModule {}
