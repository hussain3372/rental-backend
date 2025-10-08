import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

export interface AuditLogEntry {
  id: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  sessionId?: string;
  oldValues?: any;
  newValues?: any;
  metadata?: any;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  createdAt: Date;
}

@Injectable()
export class AuditService {
  constructor(
    private prisma: PrismaService,
    private logger: EnhancedLoggerService,
  ) {}

  async createAuditLog(auditData: CreateAuditLogDto): Promise<void> {
    try {
      // Store in database
      await this.prisma.auditLog.create({
        data: {
          userId: auditData.userId ? parseInt(auditData.userId.toString()) : null,
          action: auditData.action,
          resource: auditData.resource,
          resourceId: auditData.resourceId,
          ipAddress: auditData.ipAddress,
          userAgent: auditData.userAgent,
          oldValues: auditData.oldValues ? JSON.stringify(auditData.oldValues) : null,
          newValues: auditData.newValues ? JSON.stringify(auditData.newValues) : null,
          metadata: auditData.metadata ? JSON.stringify(auditData.metadata) : null,
          severity: auditData.severity,
          status: auditData.status,
        },
      });

      // Also log to enhanced logger for Elasticsearch/file storage
      this.logger.audit(
        auditData.action,
        auditData.resource,
        {
          userId: auditData.userId,
          userEmail: auditData.userEmail,
          userRole: auditData.userRole,
          ipAddress: auditData.ipAddress,
          userAgent: auditData.userAgent,
          requestId: auditData.requestId,
          sessionId: auditData.sessionId,
          resourceId: auditData.resourceId,
          metadata: {
            oldValues: auditData.oldValues,
            newValues: auditData.newValues,
            severity: auditData.severity,
            status: auditData.status,
            ...auditData.metadata,
          },
        },
        `${auditData.action} performed on ${auditData.resource} - Status: ${auditData.status}`
      );

      // Log critical events separately for security monitoring
      if (auditData.severity === 'CRITICAL') {
        this.logger.security(
          `CRITICAL AUDIT EVENT: ${auditData.action} on ${auditData.resource}`,
          {
            userId: auditData.userId,
            userEmail: auditData.userEmail,
            action: auditData.action,
            resource: auditData.resource,
            resourceId: auditData.resourceId,
            metadata: auditData.metadata,
          },
          'error'
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to create audit log',
        error.stack,
        'AuditService',
        {
          action: auditData.action,
          resource: auditData.resource,
          userId: auditData.userId,
        }
      );
    }
  }

  async getAuditLogs(query: AuditLogQueryDto) {
    const {
      page = 1,
      limit = 50,
      userId,
      action,
      resource,
      severity,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: any = {};

    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (resource) where.resource = { contains: resource, mode: 'insensitive' };
    if (severity) where.severity = severity;
    if (status) where.status = status;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs.map(log => ({
        ...log,
        oldValues: log.oldValues && typeof log.oldValues === 'string' ? JSON.parse(log.oldValues) : log.oldValues,
        newValues: log.newValues && typeof log.newValues === 'string' ? JSON.parse(log.newValues) : log.newValues,
        metadata: log.metadata && typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAuditStatistics() {
    const [totalLogs, todayLogs, criticalLogs, failedLogs] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      this.prisma.auditLog.count({
        where: { severity: 'CRITICAL' },
      }),
      this.prisma.auditLog.count({
        where: { status: 'FAILED' },
      }),
    ]);

    const actionCounts = await this.prisma.auditLog.groupBy({
      by: ['action'],
      _count: {
        action: true,
      },
      orderBy: {
        _count: {
          action: 'desc',
        },
      },
      take: 10,
    });

    const resourceCounts = await this.prisma.auditLog.groupBy({
      by: ['resource'],
      _count: {
        resource: true,
      },
      orderBy: {
        _count: {
          resource: 'desc',
        },
      },
      take: 10,
    });

    return {
      summary: {
        totalLogs,
        todayLogs,
        criticalLogs,
        failedLogs,
      },
      topActions: actionCounts.map(item => ({
        action: item.action,
        count: item._count.action,
      })),
      topResources: resourceCounts.map(item => ({
        resource: item.resource,
        count: item._count.resource,
      })),
    };
  }

  // Helper methods for common audit scenarios
  async auditAuthentication(action: string, userId: string, userEmail: string, success: boolean, metadata: any = {}) {
    await this.createAuditLog({
      userId: success ? userId : undefined,
      userEmail,
      action,
      resource: 'AUTHENTICATION',
      severity: success ? 'LOW' : 'MEDIUM',
      status: success ? 'SUCCESS' : 'FAILED',
      metadata,
    });
  }

  async auditDataModification(
    action: string,
    resource: string,
    resourceId: string,
    userId: string,
    userEmail: string,
    userRole: string,
    oldValues: any,
    newValues: any,
    metadata: any = {}
  ) {
    await this.createAuditLog({
      userId,
      userEmail,
      userRole,
      action,
      resource,
      resourceId,
      oldValues,
      newValues,
      severity: 'MEDIUM',
      status: 'SUCCESS',
      metadata,
    });
  }

  async auditApplicationAction(
    action: string,
    applicationId: string,
    userId: string,
    userEmail: string,
    userRole: string,
    oldValues: any = {},
    newValues: any = {},
    metadata: any = {}
  ) {
    const severity = action.includes('APPROVE') || action.includes('REJECT') ? 'HIGH' : 'MEDIUM';

    await this.createAuditLog({
      userId,
      userEmail,
      userRole,
      action,
      resource: 'APPLICATION',
      resourceId: applicationId,
      oldValues,
      newValues,
      severity,
      status: 'SUCCESS',
      metadata,
    });
  }

  async auditCertificationAction(
    action: string,
    certificationId: string,
    userId: string,
    userEmail: string,
    userRole: string,
    oldValues: any = {},
    newValues: any = {},
    metadata: any = {}
  ) {
    const severity = action.includes('APPROVE') || action.includes('REJECT') || action.includes('REVOKE') ? 'HIGH' : 'MEDIUM';

    await this.createAuditLog({
      userId,
      userEmail,
      userRole,
      action,
      resource: 'CERTIFICATION',
      resourceId: certificationId,
      oldValues,
      newValues,
      severity,
      status: 'SUCCESS',
      metadata,
    });
  }

  async auditFileOperation(
    action: string,
    fileName: string,
    userId: string,
    userEmail: string,
    userRole: string,
    metadata: any = {}
  ) {
    await this.createAuditLog({
      userId,
      userEmail,
      userRole,
      action,
      resource: 'FILE',
      resourceId: fileName,
      severity: action.includes('DELETE') ? 'HIGH' : 'LOW',
      status: 'SUCCESS',
      metadata,
    });
  }

  async auditPaymentAction(
    action: string,
    paymentId: string,
    userId: string,
    userEmail: string,
    amount: number,
    currency: string,
    success: boolean,
    metadata: any = {}
  ) {
    await this.createAuditLog({
      userId,
      userEmail,
      userRole: 'HOST',
      action,
      resource: 'PAYMENT',
      resourceId: paymentId,
      severity: success ? 'MEDIUM' : 'HIGH',
      status: success ? 'SUCCESS' : 'FAILED',
      metadata: {
        amount,
        currency,
        ...metadata,
      },
    });
  }

  async auditSystemConfiguration(
    action: string,
    configKey: string,
    userId: string,
    userEmail: string,
    userRole: string,
    oldValue: any,
    newValue: any,
    metadata: any = {}
  ) {
    await this.createAuditLog({
      userId,
      userEmail,
      userRole,
      action,
      resource: 'SYSTEM_CONFIG',
      resourceId: configKey,
      oldValues: { [configKey]: oldValue },
      newValues: { [configKey]: newValue },
      severity: 'CRITICAL',
      status: 'SUCCESS',
      metadata,
    });
  }
}