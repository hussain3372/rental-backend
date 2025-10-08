import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

export interface LogContext {
  userId?: string | number;
  userEmail?: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  sessionId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  // Additional fields used throughout the application
  notificationId?: string;
  notificationIds?: number;
  totalRequested?: number;
  totalCreated?: number;
  daysOld?: number;
  deletedCount?: number;
  paymentId?: string;
  applicationId?: string;
  certificationId?: string;
  folder?: string;
  bucket?: string;
  key?: string;
  operation?: string;
  prefix?: string;
  expiresIn?: number;
  invoiceNumber?: string;
  amount?: any;
  reason?: string;
  reviewerId?: number;
  adminId?: number;
  adminName?: string;
  checklistItemId?: string;
  status?: string;
  oldStatus?: string;
  newStatus?: string;
  notes?: string;
  hostId?: number;
  newExpiresAt?: string | Date;
  documentType?: string;
  type?: string;
  count?: number;
  fileSize?: number;
  // FCM related fields
  fcmResponse?: string;
  multicastSuccessCount?: number;
  multicastFailureCount?: number;
  invalidTokensCount?: number;
  fcmErrorCode?: string;
  title?: string;
  refundAmount?: number | string;
  totalRefunded?: number;
  contentType?: string;
  etag?: string;
  ticketId?: string;
  faqId?: string;
  subject?: string;
  question?: string;
}

@Injectable()
export class EnhancedLoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private isElasticsearchEnabled: boolean;

  constructor(private configService: ConfigService) {
    this.isElasticsearchEnabled = this.configService.get<boolean>('ELASTICSEARCH_ENABLED', false);
    
    const transports: winston.transport[] = [
      // Console transport with colorized output for development
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize({ all: true }),
          winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
            const contextStr = context ? `[${context}] ` : '';
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level}: ${contextStr}${message}${metaStr}`;
          }),
        ),
      }),

      // File transport for errors
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        maxsize: 50 * 1024 * 1024, // 50MB
        maxFiles: 5,
      }),

      // File transport for all logs
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        maxsize: 100 * 1024 * 1024, // 100MB
        maxFiles: 10,
      }),

      // File transport for audit logs
      new winston.transports.File({
        filename: 'logs/audit.log',
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
        maxsize: 50 * 1024 * 1024, // 50MB
        maxFiles: 20, // Keep more audit logs
      }),
    ];

    // Add Elasticsearch transport if enabled
    if (this.isElasticsearchEnabled) {
      const elasticsearchHost = this.configService.get<string>('ELASTICSEARCH_HOST', 'localhost:9200');
      
      transports.push(
        new ElasticsearchTransport({
          level: 'info',
          clientOpts: {
            node: `http://${elasticsearchHost}`,
          },
          index: 'rental-certification-logs',
          indexTemplate: {
            index_patterns: ['rental-certification-logs-*'],
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              index: {
                refresh_interval: '5s',
              },
            },
            mappings: {
              properties: {
                '@timestamp': { type: 'date' },
                level: { type: 'keyword' },
                message: { type: 'text' },
                context: { type: 'keyword' },
                userId: { type: 'keyword' },
                userEmail: { type: 'keyword' },
                userRole: { type: 'keyword' },
                action: { type: 'keyword' },
                resource: { type: 'keyword' },
                resourceId: { type: 'keyword' },
                ipAddress: { type: 'ip' },
                userAgent: { type: 'text' },
                requestId: { type: 'keyword' },
                sessionId: { type: 'keyword' },
                metadata: { type: 'object' },
              },
            },
          },
          transformer: (logData: any) => {
            return {
              '@timestamp': logData.timestamp,
              level: logData.level,
              message: logData.message,
              context: logData.context,
              ...logData.meta,
            };
          },
        })
      );
    }

    this.logger = winston.createLogger({
      level: this.configService.get<string>('LOG_LEVEL', 'info'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
      ),
      defaultMeta: {
        service: 'rental-certification-api',
        version: this.configService.get<string>('APP_VERSION', '1.0.0'),
        environment: this.configService.get<string>('NODE_ENV', 'development'),
      },
      transports,
    });

    this.log('Enhanced logger service initialized', 'EnhancedLoggerService');
  }

  log(message: string, context?: string, logContext?: LogContext) {
    this.logger.info(message, { context, ...logContext });
  }

  error(message: string, trace?: string, context?: string, logContext?: LogContext) {
    this.logger.error(message, { 
      context, 
      stack: trace,
      error: true,
      ...logContext 
    });
  }

  warn(message: string, context?: string, logContext?: LogContext) {
    this.logger.warn(message, { context, ...logContext });
  }

  debug(message: string, context?: string, logContext?: LogContext) {
    this.logger.debug(message, { context, ...logContext });
  }

  verbose(message: string, context?: string, logContext?: LogContext) {
    this.logger.verbose(message, { context, ...logContext });
  }

  // Audit-specific logging methods
  audit(action: string, resource: string, logContext: LogContext, message?: string) {
    this.logger.info(message || `${action} performed on ${resource}`, {
      context: 'AUDIT',
      action,
      resource,
      audit: true,
      ...logContext,
    });
  }

  security(message: string, logContext: LogContext, level: 'warn' | 'error' = 'warn') {
    this.logger[level](message, {
      context: 'SECURITY',
      security: true,
      ...logContext,
    });
  }

  performance(action: string, duration: number, logContext?: LogContext) {
    this.logger.info(`Performance: ${action} completed in ${duration}ms`, {
      context: 'PERFORMANCE',
      action,
      duration,
      performance: true,
      ...logContext,
    });
  }

  business(event: string, data: Record<string, any>, logContext?: LogContext) {
    this.logger.info(`Business Event: ${event}`, {
      context: 'BUSINESS',
      event,
      business: true,
      eventData: data,
      ...logContext,
    });
  }

  // Helper method to create log context from request
  createRequestContext(req: any): LogContext {
    return {
      userId: req.user?.id,
      userEmail: req.user?.email,
      userRole: req.user?.role,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent'),
      requestId: req.id,
      sessionId: req.sessionID,
    };
  }

  // HTTP Request logging
  logRequest(method: string, url: string, statusCode: number, duration: number, logContext?: LogContext) {
    this.logger.info(`${method} ${url} ${statusCode} - ${duration}ms`, {
      context: 'HTTP',
      method,
      url,
      statusCode,
      duration,
      http: true,
      ...logContext,
    });
  }

  // Database operation logging
  logDatabaseOperation(operation: string, model: string, duration: number, logContext?: LogContext) {
    this.logger.debug(`DB ${operation} on ${model} - ${duration}ms`, {
      context: 'DATABASE',
      operation,
      model,
      duration,
      database: true,
      ...logContext,
    });
  }

  // File operation logging
  logFileOperation(operation: string, fileName: string, fileSize?: number, logContext?: LogContext) {
    this.logger.info(`File ${operation}: ${fileName}${fileSize ? ` (${fileSize} bytes)` : ''}`, {
      context: 'FILE',
      operation,
      fileName,
      fileSize,
      file: true,
      ...logContext,
    });
  }

  // Payment logging
  logPayment(event: string, paymentId: string, amount: number, currency: string, logContext?: LogContext) {
    this.logger.info(`Payment ${event}: ${paymentId} - ${amount} ${currency}`, {
      context: 'PAYMENT',
      event,
      paymentId,
      amount,
      currency,
      payment: true,
      ...logContext,
    });
  }

  // Email logging
  logEmail(event: string, to: string, subject: string, success: boolean, logContext?: LogContext) {
    this.logger.info(`Email ${event}: ${subject} to ${to} - ${success ? 'SUCCESS' : 'FAILED'}`, {
      context: 'EMAIL',
      event,
      to,
      subject,
      success,
      email: true,
      ...logContext,
    });
  }
}