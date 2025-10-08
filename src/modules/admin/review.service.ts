import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationService, ApplicationWithDetails } from '../application/application.service';
import { DocumentService } from '../document/document.service';
import { CertificationService } from '../certification/certification.service';
import { ApplicationStatus, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';
import { DocumentWithDetails } from '../document/document.service';

export interface ReviewChecklistItem {
  id: string;
  category: string;
  requirement: string;
  status: 'pending' | 'approved' | 'rejected' | 'not_applicable';
  notes?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
}

export interface ApplicationReviewData {
  application: ApplicationWithDetails;
  documents: Array<{
    id: string;
    documentType: string;
    fileName: string;
    uploadedAt: Date;
    url: string;
  }>;
  reviewChecklist: ReviewChecklistItem[];
  reviewHistory: Array<{
    action: string;
    performedBy: string;
    performedAt: Date;
    notes?: string;
    oldStatus?: ApplicationStatus;
    newStatus?: ApplicationStatus;
  }>;
  riskAssessment: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
    recommendations: string[];
  };
}

export interface ReviewDecision {
  decision: 'approve' | 'reject' | 'request_more_info';
  notes: string;
  checklistUpdates?: Array<{
    id: string;
    status: 'approved' | 'rejected' | 'not_applicable';
    notes?: string;
  }>;
  riskAssessment?: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
}

@Injectable()
export class ReviewService {
  constructor(
    private prisma: PrismaService,
    private applicationService: ApplicationService,
    private documentService: DocumentService,
    private certificationService: CertificationService,
    private auditService: AuditService,
    private logger: EnhancedLoggerService,
  ) {}

  async getApplicationForReview(
    applicationId: string,
    adminId: number,
    adminRole: UserRole
  ): Promise<ApplicationReviewData> {
    // Get application with full details
    const application = await this.applicationService.findOne(applicationId, adminId, adminRole);

    // Get documents
    const documents = await this.documentService.getDocumentsForApplication(applicationId, adminId, adminRole);

    // Get or create review checklist
    const reviewChecklist = await this.getOrCreateReviewChecklist(applicationId);

    // Get review history
    const reviewHistory = await this.getReviewHistory(applicationId);

    // Assess risk
    const riskAssessment = await this.assessApplicationRisk(application, documents);

    return {
      application,
      documents: documents.map(doc => ({
        id: doc.id,
        documentType: doc.documentType,
        fileName: doc.originalName,
        uploadedAt: doc.uploadedAt,
        url: doc.url,
      })),
      reviewChecklist,
      reviewHistory,
      riskAssessment,
    };
  }

  async submitReviewDecision(
    applicationId: string,
    decision: ReviewDecision,
    adminId: number,
    adminName: string,
    adminRole: UserRole
  ): Promise<{ success: boolean; message: string; nextAction?: string }> {
    // Validate admin permissions
    if (adminRole !== UserRole.ADMIN && adminRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only administrators can review applications');
    }

    // Get application
    const application = await this.applicationService.findOne(applicationId, adminId, adminRole);

    if (application.status !== ApplicationStatus.UNDER_REVIEW) {
      throw new BadRequestException('Application must be under review to submit decision');
    }

    // Update checklist items if provided
    if (decision.checklistUpdates) {
      await this.updateReviewChecklist(applicationId, decision.checklistUpdates, adminName);
    }

    // Execute the decision
    switch (decision.decision) {
      case 'approve':
        return await this.approveApplication(applicationId, decision, adminId, adminName);

      case 'reject':
        return await this.rejectApplication(applicationId, decision, adminId, adminName);

      case 'request_more_info':
        return await this.requestMoreInfo(applicationId, decision, adminId, adminName);

      default:
        throw new BadRequestException('Invalid decision type');
    }
  }

  async assignReviewer(
    applicationId: string,
    reviewerId: number,
    adminId: number,
    adminName: string
  ): Promise<void> {
    await this.applicationService.assignReviewer(applicationId, reviewerId, adminId);

    // Log assignment
    await this.auditService.auditApplicationAction(
      'REVIEWER_ASSIGNED',
      applicationId,
      adminId.toString(),
      adminName,
      'ADMIN',
      {
        reviewerId,
        assignedBy: adminId,
      }
    );

    this.logger.log(
      `Application ${applicationId} assigned to reviewer ${reviewerId}`,
      'ReviewService',
      { applicationId, reviewerId, adminId }
    );
  }

  async getReviewQueueStats(adminId?: number): Promise<{
    totalPending: number;
    myAssigned: number;
    urgentReviews: number; // > 7 days old
    completedToday: number;
    averageReviewTime: string;
  }> {
    const baseWhere = {
      status: ApplicationStatus.UNDER_REVIEW,
    };

    const [totalPending, myAssigned, urgentReviews, completedToday] = await Promise.all([
      this.prisma.application.count({ where: baseWhere }),
      adminId ? this.prisma.application.count({
        where: { ...baseWhere, reviewedBy: adminId }
      }) : Promise.resolve(0),
      this.prisma.application.count({
        where: {
          ...baseWhere,
          submittedAt: {
            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
          },
        },
      }),
      this.prisma.application.count({
        where: {
          reviewedBy: adminId,
          reviewedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)), // Today
          },
        },
      }),
    ]);

    return {
      totalPending,
      myAssigned,
      urgentReviews,
      completedToday,
      averageReviewTime: '2.3 hours', // Would need calculation
    };
  }

  private async approveApplication(
    applicationId: string,
    decision: ReviewDecision,
    adminId: number,
    adminName: string
  ): Promise<{ success: boolean; message: string; nextAction: string }> {
    // Update application status
    await this.applicationService.approve(applicationId, decision.notes, adminId);

    // Generate certification
    try {
      const certification = await this.certificationService.generateCertification(applicationId, adminId);

      // Log approval
      await this.auditService.auditApplicationAction(
        'APPLICATION_APPROVED',
        applicationId,
        adminId.toString(),
        adminName,
        'ADMIN',
        {
          decision: 'approved',
          notes: decision.notes,
          certificationId: certification.id,
          certificateNumber: certification.certificateNumber,
        }
      );

      this.logger.log(
        `Application ${applicationId} approved and certification ${certification.certificateNumber} generated`,
        'ReviewService',
        { applicationId, certificationId: certification.id, adminId }
      );

      return {
        success: true,
        message: `Application approved successfully. Certification ${certification.certificateNumber} has been generated.`,
        nextAction: 'Certification generated and notification sent to host',
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate certification for approved application ${applicationId}`,
        error.stack,
        'ReviewService'
      );

      return {
        success: false,
        message: 'Application approved but certification generation failed. Please contact system administrator.',
        nextAction: 'contact_admin',
      };
    }
  }

  private async rejectApplication(
    applicationId: string,
    decision: ReviewDecision,
    adminId: number,
    adminName: string
  ): Promise<{ success: boolean; message: string }> {
    await this.applicationService.reject(applicationId, decision.notes, adminId);

    await this.auditService.auditApplicationAction(
      'APPLICATION_REJECTED',
      applicationId,
      adminId.toString(),
      adminName,
      'ADMIN',
      {
        decision: 'rejected',
        notes: decision.notes,
      }
    );

    this.logger.log(
      `Application ${applicationId} rejected`,
      'ReviewService',
      { applicationId, adminId, reason: decision.notes }
    );

    return {
      success: true,
      message: 'Application rejected successfully. Host has been notified.',
    };
  }

  private async requestMoreInfo(
    applicationId: string,
    decision: ReviewDecision,
    adminId: number,
    adminName: string
  ): Promise<{ success: boolean; message: string }> {
    await this.applicationService.requestMoreInfo(applicationId, decision.notes, adminId);

    await this.auditService.auditApplicationAction(
      'MORE_INFO_REQUESTED',
      applicationId,
      adminId.toString(),
      adminName,
      'ADMIN',
      {
        decision: 'more_info_requested',
        notes: decision.notes,
      }
    );

    this.logger.log(
      `More information requested for application ${applicationId}`,
      'ReviewService',
      { applicationId, adminId, notes: decision.notes }
    );

    return {
      success: true,
      message: 'Additional information requested. Host has been notified.',
    };
  }

  private async getOrCreateReviewChecklist(applicationId: string): Promise<ReviewChecklistItem[]> {
    // For now, return a default checklist. In production, this could be configurable
    const defaultChecklist: ReviewChecklistItem[] = [
      {
        id: 'property_verification',
        category: 'Property Verification',
        requirement: 'Property details match submitted documentation',
        status: 'pending',
      },
      {
        id: 'document_authenticity',
        category: 'Document Verification',
        requirement: 'All submitted documents are authentic and valid',
        status: 'pending',
      },
      {
        id: 'compliance_check',
        category: 'Compliance Check',
        requirement: 'Property meets all safety and regulatory requirements',
        status: 'pending',
      },
      {
        id: 'payment_verification',
        category: 'Payment Verification',
        requirement: 'Payment has been processed successfully',
        status: 'pending',
      },
      {
        id: 'background_check',
        category: 'Background Check',
        requirement: 'Host background check completed (if applicable)',
        status: 'pending',
      },
      {
        id: 'risk_assessment',
        category: 'Risk Assessment',
        requirement: 'Overall risk assessment completed',
        status: 'pending',
      },
    ];

    // In a real implementation, you'd store and retrieve checklist status from database
    // For now, return the default checklist
    return defaultChecklist;
  }

  private async updateReviewChecklist(
    applicationId: string,
    updates: Array<{
      id: string;
      status: 'approved' | 'rejected' | 'not_applicable';
      notes?: string;
    }>,
    adminName: string
  ): Promise<void> {
    // In a real implementation, you'd update checklist items in the database
    // For now, just log the updates
    for (const update of updates) {
      this.logger.log(
        `Checklist item ${update.id} updated to ${update.status} for application ${applicationId}`,
        'ReviewService',
        { applicationId, checklistItemId: update.id, status: update.status, adminName }
      );
    }
  }

  private async getReviewHistory(applicationId: string): Promise<Array<{
    action: string;
    performedBy: string;
    performedAt: Date;
    notes?: string;
    oldStatus?: ApplicationStatus;
    newStatus?: ApplicationStatus;
  }>> {
    // Get audit logs for this application
    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        resource: 'application',
        resourceId: applicationId,
      },
      include: {
        user: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    return auditLogs.map(log => ({
      action: log.action,
      performedBy: log.user?.name || log.user?.email || 'System',
      performedAt: log.createdAt,
      notes: log.newValues && typeof log.newValues === 'string' ? JSON.parse(log.newValues).notes : undefined,
      oldStatus: log.oldValues && typeof log.oldValues === 'string' ? JSON.parse(log.oldValues).status : undefined,
      newStatus: log.newValues && typeof log.newValues === 'string' ? JSON.parse(log.newValues).status : undefined,
    }));
  }

  private async assessApplicationRisk(
    application: ApplicationWithDetails,
    documents: any[]
  ): Promise<{
    level: 'low' | 'medium' | 'high';
    factors: string[];
    recommendations: string[];
  }> {
    const factors: string[] = [];
    const recommendations: string[] = [];
    let riskScore = 0;

    // Check application completeness
    if (!application.propertyDetails) {
      factors.push('Incomplete property details');
      riskScore += 2;
    }

    // Check document completeness
    const requiredDocs = ['ID_DOCUMENT', 'SAFETY_PERMIT', 'INSURANCE_CERTIFICATE', 'PROPERTY_DEED'];
    const uploadedTypes = documents.map(d => d.documentType);
    const missingDocs = requiredDocs.filter(type => !uploadedTypes.includes(type));

    if (missingDocs.length > 0) {
      factors.push(`Missing required documents: ${missingDocs.join(', ')}`);
      riskScore += missingDocs.length * 2;
    }

    // Check application age
    if (application.submittedAt) {
      const daysSinceSubmission = Math.floor(
        (Date.now() - application.submittedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceSubmission > 30) {
        factors.push('Application is over 30 days old');
        riskScore += 1;
        recommendations.push('Consider requesting updated documents');
      }
    }

    // Determine risk level
    let level: 'low' | 'medium' | 'high';
    if (riskScore >= 6) {
      level = 'high';
      recommendations.push('Detailed review required before approval');
    } else if (riskScore >= 3) {
      level = 'medium';
      recommendations.push('Additional verification may be needed');
    } else {
      level = 'low';
      recommendations.push('Standard review process applicable');
    }

    return { level, factors, recommendations };
  }
}
