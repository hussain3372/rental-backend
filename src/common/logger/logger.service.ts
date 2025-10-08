import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import * as path from 'path';

@Injectable()
export class CustomLogger implements LoggerService {
  private logger: winston.Logger;

  constructor(private configService: ConfigService) {
    this.initializeLogger();
  }

  private initializeLogger() {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const logLevel = this.configService.get<string>('LOG_LEVEL', 'info');

    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );

    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
        return `${timestamp} [${context || 'Application'}] ${level}: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta) : ''
        }`;
      }),
    );

    const transports: winston.transport[] = [
      new winston.transports.Console({
        level: logLevel,
        format: isProduction ? logFormat : consoleFormat,
      }),
    ];

    // Add file transport in production
    if (isProduction) {
      transports.push(
        new winston.transports.File({
          filename: path.join(process.cwd(), 'logs', 'error.log'),
          level: 'error',
          format: logFormat,
        }),
        new winston.transports.File({
          filename: path.join(process.cwd(), 'logs', 'combined.log'),
          format: logFormat,
        }),
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      format: logFormat,
      transports,
      exitOnError: false,
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }

  // Additional methods for specific use cases
  logRequest(method: string, url: string, userAgent: string, ip: string) {
    this.logger.info('HTTP Request', {
      context: 'HTTP',
      method,
      url,
      userAgent,
      ip,
    });
  }

  logDatabaseQuery(query: string, duration: number, model?: string) {
    this.logger.debug('Database Query', {
      context: 'Database',
      query,
      duration: `${duration}ms`,
      model,
    });
  }

  logAuthEvent(event: string, userId?: string, details?: any) {
    this.logger.info('Authentication Event', {
      context: 'Auth',
      event,
      userId,
      ...details,
    });
  }

  logSecurityEvent(event: string, details: any) {
    this.logger.warn('Security Event', {
      context: 'Security',
      event,
      ...details,
    });
  }

  logPerformanceMetric(metric: string, value: number, unit: string = 'ms') {
    this.logger.info('Performance Metric', {
      context: 'Performance',
      metric,
      value,
      unit,
    });
  }
}
