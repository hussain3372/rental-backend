import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplicationStatus,
  UserRole,
  CertificationStatus,
} from '@prisma/client';
import { ApplicationService } from '../application/application.service';
import { CertificationService } from '../certification/certification.service';
import { CertificationWithDetails } from '../certification/certification.service';

export interface AdminDashboardStats {
  applications: {
    total: number;
    pending: number;
    underReview: number;
    approved: number;
    rejected: number;
    moreInfoRequested: number;
  };
  certifications: {
    total: number;
    active: number;
    expired: number;
    revoked: number;
    expiringSoon: number;
  };
  users: {
    totalHosts: number;
    totalAdmins: number;
    totalSuperAdmins: number;
    activeHosts: number;
  };
  recentActivity: {
    applications: Array<{
      id: string;
      hostName: string;
      status: ApplicationStatus;
      submittedAt: Date;
      currentStep: string;
    }>;
    certifications: Array<{
      id: string;
      certificateNumber: string;
      hostName: string;
      status: CertificationStatus;
      issuedAt: Date;
    }>;
  };
}

export interface ApplicationQueueItem {
  id: string;
  hostName: string;
  hostEmail: string;
  submittedAt: Date;
  currentStep: string;
  status: ApplicationStatus;
  priority: 'high' | 'medium' | 'low';
  daysWaiting: number;
  documentsCount: number;
  assignedTo?: string;
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private applicationService: ApplicationService,
    private certificationService: CertificationService
  ) {}

  async getDashboardStats(): Promise<AdminDashboardStats> {
    // Get application statistics
    const applicationStats = await this.getApplicationStats();

    // Get certification statistics
    const certificationStats =
      await this.certificationService.getCertificationStats();

    // Get user statistics
    const userStats = await this.getUserStats();

    // Get recent activity
    const recentActivity = await this.getRecentActivity();

    return {
      applications: applicationStats,
      certifications: certificationStats,
      users: userStats,
      recentActivity,
    };
  }

  async getApplicationQueue(
    adminId?: number,
    filters?: {
      status?: ApplicationStatus;
      priority?: 'high' | 'medium' | 'low';
      assignedToMe?: boolean;
    }
  ): Promise<{
    applications: ApplicationQueueItem[];
    total: number;
    summary: {
      urgent: number; // Waiting > 7 days
      overdue: number; // Waiting > 14 days
      assigned: number;
      unassigned: number;
    };
  }> {
    const where: any = {};

    // Apply filters
    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.assignedToMe && adminId) {
      where.reviewedBy = adminId;
    }

    // Only show applications that need admin attention
    where.status = {
      in: [
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.UNDER_REVIEW,
        ApplicationStatus.MORE_INFO_REQUESTED,
      ],
    };

    const [applications, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
          host: {
            select: {
              name: true,
              email: true,
            },
          },
          reviewer: {
            select: {
              name: true,
            },
          },
          _count: {
            select: {
              documents: true,
            },
          },
        },
        orderBy: [
          { submittedAt: 'asc' }, // Oldest first
        ],
        take: 50, // Limit for performance
      }),
      this.prisma.application.count({ where }),
    ]);

    const queueItems: ApplicationQueueItem[] = applications.map(app => {
      const submittedAt = app.submittedAt || new Date();
      const daysWaiting = Math.floor(
        (Date.now() - submittedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      let priority: 'high' | 'medium' | 'low' = 'low';
      if (daysWaiting > 14) priority = 'high';
      else if (daysWaiting > 7) priority = 'medium';

      return {
        id: app.id,
        hostName: app.host.name || 'Unknown',
        hostEmail: app.host.email,
        submittedAt,
        currentStep: app.currentStep,
        status: app.status,
        priority,
        daysWaiting,
        documentsCount: app._count.documents,
        assignedTo: app.reviewer?.name,
      };
    });

    // Calculate summary statistics
    const urgent = queueItems.filter(item => item.priority === 'high').length;
    const overdue = queueItems.filter(item => item.daysWaiting > 14).length;
    const assigned = queueItems.filter(item => item.assignedTo).length;
    const unassigned = queueItems.filter(item => !item.assignedTo).length;

    return {
      applications: queueItems,
      total,
      summary: {
        urgent,
        overdue,
        assigned,
        unassigned,
      },
    };
  }

  async assignApplicationToAdmin(
    applicationId: string,
    adminId: number,
    adminName: string
  ): Promise<void> {
    await this.applicationService.assignReviewer(
      applicationId,
      adminId,
      adminId
    );

    // Log the assignment
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'APPLICATION_ASSIGNED',
        resource: 'application',
        resourceId: applicationId,
        oldValues: JSON.stringify({}),
        newValues: JSON.stringify({
          assignedTo: adminId,
          assignedBy: adminName,
        }),
        severity: 'LOW',
        status: 'SUCCESS',
      },
    });
  }

  async getAdminWorkload(): Promise<{
    admins: Array<{
      id: number;
      name: string;
      email: string;
      assignedApplications: number;
      completedThisWeek: number;
      averageCompletionTime: number;
    }>;
  }> {
    // Get all admins
    const admins = await this.prisma.user.findMany({
      where: {
        role: {
          in: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    const adminWorkload = await Promise.all(
      admins.map(async admin => {
        // Count currently assigned applications
        const assignedCount = await this.prisma.application.count({
          where: {
            reviewedBy: admin.id,
            status: {
              in: [
                ApplicationStatus.UNDER_REVIEW,
                ApplicationStatus.MORE_INFO_REQUESTED,
              ],
            },
          },
        });

        // Count applications completed this week
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const completedThisWeek = await this.prisma.application.count({
          where: {
            reviewedBy: admin.id,
            status: {
              in: [ApplicationStatus.APPROVED, ApplicationStatus.REJECTED],
            },
            reviewedAt: {
              gte: oneWeekAgo,
            },
          },
        });

        // Calculate average completion time (simplified)
        const avgCompletionTime = 3.5; // Placeholder - would need more complex calculation

        return {
          id: admin.id,
          name: admin.name || 'Unknown',
          email: admin.email,
          assignedApplications: assignedCount,
          completedThisWeek,
          averageCompletionTime: avgCompletionTime,
        };
      })
    );

    return { admins: adminWorkload };
  }

  async searchCertifications(options: {
    certificateNumber?: string;
    hostName?: string;
    status?: CertificationStatus;
    expiryBefore?: Date;
    expiryAfter?: Date;
    skip?: number;
    take?: number;
  }): Promise<{ certifications: CertificationWithDetails[]; total: number }> {
    const {
      certificateNumber,
      hostName,
      status,
      expiryBefore,
      expiryAfter,
      skip = 0,
      take = 20,
    } = options;

    const where: any = {};

    if (certificateNumber) {
      where.certificateNumber = {
        contains: certificateNumber,
        mode: 'insensitive',
      };
    }

    if (hostName) {
      where.host = {
        name: {
          contains: hostName,
          mode: 'insensitive',
        },
      };
    }

    if (status) {
      where.status = status;
    }

    if (expiryBefore || expiryAfter) {
      where.expiresAt = {};
      if (expiryBefore) where.expiresAt.lte = expiryBefore;
      if (expiryAfter) where.expiresAt.gte = expiryAfter;
    }

    const [certifications, total] = await Promise.all([
      this.prisma.certification.findMany({
        where,
        include: {
          application: {
            select: {
              id: true,
              hostId: true,
              propertyDetails: true,
            },
          },
          host: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          revoker: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.certification.count({ where }),
    ]);

    return {
      certifications: certifications as CertificationWithDetails[],
      total,
    };
  }

  async bulkRevokeCertifications(
    certificationIds: string[],
    reason: string,
    adminId: number,
    adminName: string
  ): Promise<{ success: number; failed: number; results: any[] }> {
    const results = [];

    let success = 0;
    let failed = 0;

    for (const certificationId of certificationIds) {
      try {
        const result = await this.certificationService.revokeCertification(
          certificationId,
          reason,
          adminId,
          adminName
        );
        results.push({ certificationId, status: 'success', result });
        success++;
      } catch (error) {
        results.push({
          certificationId,
          status: 'failed',
          error: error.message,
        });
        failed++;
      }
    }

    return { success, failed, results };
  }

  async bulkRenewCertifications(
    certificationIds: string[],
    adminId: number
  ): Promise<{ success: number; failed: number; results: any[] }> {
    const results = [];

    let success = 0;
    let failed = 0;

    for (const certificationId of certificationIds) {
      try {
        const result = await this.certificationService.renewCertification(
          certificationId,
          adminId
        );
        results.push({ certificationId, status: 'success', result });
        success++;
      } catch (error) {
        results.push({
          certificationId,
          status: 'failed',
          error: error.message,
        });
        failed++;
      }
    }

    return { success, failed, results };
  }

  async getExpiringCertifications(days: number = 30): Promise<{
    certifications: CertificationWithDetails[];
    total: number;
  }> {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    const [certifications, total] = await Promise.all([
      this.prisma.certification.findMany({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: {
            lte: expiryDate,
            gt: new Date(),
          },
        },
        include: {
          application: {
            select: {
              id: true,
              hostId: true,
              propertyDetails: true,
            },
          },
          host: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: {
            lte: expiryDate,
            gt: new Date(),
          },
        },
      }),
    ]);

    return {
      certifications: certifications as CertificationWithDetails[],
      total,
    };
  }

  async getRevokedCertifications(options: {
    skip?: number;
    take?: number;
  }): Promise<{ certifications: CertificationWithDetails[]; total: number }> {
    const { skip = 0, take = 20 } = options;

    const [certifications, total] = await Promise.all([
      this.prisma.certification.findMany({
        where: { status: CertificationStatus.REVOKED },
        include: {
          application: {
            select: {
              id: true,
              hostId: true,
              propertyDetails: true,
            },
          },
          host: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          revoker: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { revokedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.certification.count({
        where: { status: CertificationStatus.REVOKED },
      }),
    ]);

    return {
      certifications: certifications as CertificationWithDetails[],
      total,
    };
  }

  async getCertificationStatistics(
    period: 'week' | 'month' | 'quarter' | 'year'
  ): Promise<{
    issued: number;
    revoked: number;
    expired: number;
    active: number;
    renewalRate: string;
    averageValidityDays: number;
  }> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStart, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }

    const [issued, revoked, expired, active, renewedCount] = await Promise.all([
      this.prisma.certification.count({
        where: {
          issuedAt: { gte: startDate },
        },
      }),
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.REVOKED,
          revokedAt: { gte: startDate },
        },
      }),
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.EXPIRED,
          updatedAt: { gte: startDate },
        },
      }),
      this.prisma.certification.count({
        where: { status: CertificationStatus.ACTIVE },
      }),
      // This would need a more complex query to count renewals
      Promise.resolve(0), // Placeholder
    ]);

    const renewalRate =
      issued > 0 ? ((renewedCount / issued) * 100).toFixed(1) + '%' : '0%';

    // Calculate average validity (simplified)
    const avgValidityDays = 365; // Default 1 year

    return {
      issued,
      revoked,
      expired,
      active,
      renewalRate,
      averageValidityDays: avgValidityDays,
    };
  }

  async getSystemHealth(): Promise<{
    database: 'healthy' | 'warning' | 'error';
    storage: 'healthy' | 'warning' | 'error';
    pendingApplications: number;
    expiringCertifications: number;
    systemLoad: 'low' | 'medium' | 'high';
  }> {
    try {
      // Check database connectivity
      await this.prisma.$queryRaw`SELECT 1`;

      // Get pending applications count
      const pendingApplications = await this.prisma.application.count({
        where: {
          status: {
            in: [ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW],
          },
        },
      });

      // Get expiring certifications count
      const expiringCertifications = await this.certificationService
        .getCertificationStats()
        .then(stats => stats.expiringSoon);

      // Determine system load
      let systemLoad: 'low' | 'medium' | 'high' = 'low';
      if (pendingApplications > 50 || expiringCertifications > 20) {
        systemLoad = 'high';
      } else if (pendingApplications > 20 || expiringCertifications > 10) {
        systemLoad = 'medium';
      }

      return {
        database: 'healthy',
        storage: 'healthy', // Would need actual storage health check
        pendingApplications,
        expiringCertifications,
        systemLoad,
      };
    } catch (error) {
      return {
        database: 'error',
        storage: 'warning',
        pendingApplications: 0,
        expiringCertifications: 0,
        systemLoad: 'high',
      };
    }
  }

  private async getApplicationStats(): Promise<
    AdminDashboardStats['applications']
  > {
    const [total, pending, underReview, approved, rejected, moreInfoRequested] =
      await Promise.all([
        this.prisma.application.count(),
        this.prisma.application.count({
          where: { status: ApplicationStatus.SUBMITTED },
        }),
        this.prisma.application.count({
          where: { status: ApplicationStatus.UNDER_REVIEW },
        }),
        this.prisma.application.count({
          where: { status: ApplicationStatus.APPROVED },
        }),
        this.prisma.application.count({
          where: { status: ApplicationStatus.REJECTED },
        }),
        this.prisma.application.count({
          where: { status: ApplicationStatus.MORE_INFO_REQUESTED },
        }),
      ]);

    return {
      total,
      pending,
      underReview,
      approved,
      rejected,
      moreInfoRequested,
    };
  }

  private async getUserStats(): Promise<AdminDashboardStats['users']> {
    const [totalHosts, totalAdmins, totalSuperAdmins, activeHosts] =
      await Promise.all([
        this.prisma.user.count({ where: { role: UserRole.HOST } }),
        this.prisma.user.count({ where: { role: UserRole.ADMIN } }),
        this.prisma.user.count({ where: { role: UserRole.SUPER_ADMIN } }),
        this.prisma.user.count({
          where: {
            role: UserRole.HOST,
            status: 'ACTIVE',
          },
        }),
      ]);

    return {
      totalHosts,
      totalAdmins,
      totalSuperAdmins,
      activeHosts,
    };
  }

  private async getRecentActivity(): Promise<
    AdminDashboardStats['recentActivity']
  > {
    // Get recent applications (last 10)
    const recentApplications = await this.prisma.application.findMany({
      take: 10,
      orderBy: { submittedAt: 'desc' },
      where: { submittedAt: { not: null } },
      include: {
        host: {
          select: { name: true },
        },
      },
    });

    // Get recent certifications (last 10)
    const recentCertifications = await this.prisma.certification.findMany({
      take: 10,
      orderBy: { issuedAt: 'desc' },
      include: {
        host: {
          select: { name: true },
        },
      },
    });

    return {
      applications: recentApplications.map(app => ({
        id: app.id,
        hostName: app.host.name || 'Unknown',
        status: app.status,
        submittedAt: app.submittedAt!,
        currentStep: app.currentStep,
      })),
      certifications: recentCertifications.map(cert => ({
        id: cert.id,
        certificateNumber: cert.certificateNumber,
        hostName: cert.host.name || 'Unknown',
        status: cert.status,
        issuedAt: cert.issuedAt,
      })),
    };
  }
}
