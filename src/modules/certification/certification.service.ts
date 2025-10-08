import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Certification,
  CertificationStatus,
  UserRole,
  ApplicationStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';
import { BadgeService } from './badge.service';
import { MailService } from '../../common/mail/mail.service';
import { NotificationService } from '../notification/notification.service';
import * as crypto from 'crypto';

export interface CertificationWithDetails extends Certification {
  application: {
    id: string;
    hostId: number;
    propertyDetails: any;
  };
  host: {
    id: number;
    name: string;
    email: string;
  };
  revoker?: {
    id: number;
    name: string;
    email: string;
  } | null;
}

@Injectable()
export class CertificationService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private auditService: AuditService,
    private logger: EnhancedLoggerService,
    private badgeService: BadgeService,
    private mailService: MailService,
    private notificationService: NotificationService
  ) {}

  async generateCertification(
    applicationId: string,
    adminId: number
  ): Promise<Certification> {
    // Validate application
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        host: true,
        payments: true,
        documents: true,
      },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (application.status !== ApplicationStatus.APPROVED) {
      throw new BadRequestException(
        'Application must be approved before certification can be generated'
      );
    }

    // Enforce Super Admin template per property type
    const propertyTypeId = (application.propertyDetails as any)?.propertyType;
    if (!propertyTypeId) {
      throw new BadRequestException('Application propertyType is missing');
    }
    console.log('propertyTypeIdpropertyTypeId', propertyTypeId);



    const activeTemplate = await (
      this.prisma as any
    ).superAdminCertificate.findFirst({
      where: { propertyTypeId, isActive: true }
    });
    console.log('activeTemplateactiveTemplate', activeTemplate);

    if (!activeTemplate) {
      throw new BadRequestException(
        'No active certificate template configured for this property type'
      );
    }

    // Check if certification already exists
    const existingCertification = await this.prisma.certification.findUnique({
      where: { applicationId },
    });

    if (existingCertification) {
      throw new BadRequestException(
        'Certification already exists for this application'
      );
    }

    // Verify all requirements are met
    await this.validateCertificationRequirements(application);

    // Generate unique certificate number
    const certificateNumber = await this.generateCertificateNumber();

    // Generate QR code data and verification URL
    const qrCodeData = crypto.randomBytes(16).toString('hex');
    const baseUrl = this.configService.get<string>(
      'APP_BASE_URL',
      'http://localhost:3000'
    );
    const verificationUrl = `${baseUrl}/verify/${qrCodeData}`;

    // Set expiration date (default 1 year from now)
    const validityMonths =
      activeTemplate.validityMonths ??
      this.configService.get<number>('CERTIFICATION_VALIDITY_MONTHS', 12);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + validityMonths);

    // Create certification first (placeholders for badge/qr)
    let certification = await this.prisma.certification.create({
      data: {
        applicationId,
        hostId: application.hostId,
        certificateNumber,
        status: CertificationStatus.ACTIVE,
        issuedAt: new Date(),
        expiresAt,
        qrCodeData,
        verificationUrl,
        badgeUrl: '',
        qrCodeUrl: '',
      },
    });

    // Generate badge + QR code with proper enriched object
    try {
      const certificationWithDetails = {
        ...certification,
        host: application.host,
        application,
      } as CertificationWithDetails;

      const badgeUrls = await this.badgeService.generateBadge(
        certificationWithDetails
      );

      // Persist URLs
      certification = await this.prisma.certification.update({
        where: { id: certification.id },
        data: {
          badgeUrl: badgeUrls.badgePngUrl,
          qrCodeUrl: badgeUrls.qrCodeUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate badge for certification ${certificateNumber}`,
        error.stack,
        'CertificationService'
      );
      // Continue without badge - certification is still valid
    }

    // Link certification to application
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        certification: {
          connect: { id: certification.id },
        },
      },
    });

    // Audit
    await this.auditService.auditCertificationAction(
      'CERTIFICATION_CREATED',
      certification.id,
      adminId.toString(),
      application.host.email,
      'ADMIN',
      {
        certificateNumber,
        applicationId,
        hostId: application.hostId,
        expiresAt: expiresAt.toISOString(),
      }
    );

    this.logger.log(
      `Certification generated: ${certificateNumber}`,
      'CertificationService',
      {
        certificationId: certification.id,
        applicationId,
        hostId: application.hostId,
        adminId,
      }
    );

    // Email + Push notify host
    try {
      const host = await this.prisma.user.findUnique({
        where: { id: application.hostId },
        select: {
          email: true,
          name: true,
          firstName: true,
          isEmail: true,
          id: true,
        },
      });
      if (host?.isEmail) {
        await this.mailService.sendMail({
          to: host.email,
          subject: 'Your Certification Has Been Issued',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Congratulations ${host.firstName || host.name || ''}!</h2>
              <p>Your application has been approved and your certification has been issued.</p>
              <ul>
                <li>Certificate Number: <strong>${certificateNumber}</strong></li>
                <li>Expires At: ${expiresAt.toDateString()}</li>
              </ul>
              <p>You can view your certification in your dashboard.</p>
            </div>
          `,
        });
      }
      await this.notificationService.createNotification({
        userId: host.id,
        type: 'APPLICATION_STATUS' as any,
        title: 'Certification Issued',
        message: `Your certification (${certificateNumber}) has been issued.`,
        data: { applicationId, certificateNumber },
        priority: 'high',
        sendPush: true,
      });
    } catch (e) {
      this.logger.warn(
        'Failed to send certification email/push',
        'CertificationService'
      );
    }

    return certification;
  }

  // Super Admin Template APIs
  async createTemplate(
    dto: {
      propertyTypeId: string;
      name: string;
      description?: string;
      imageUrl?: string;
      validityMonths?: number;
      isActive?: boolean;
    },
    superAdminId: number
  ) {
    // Ensure property type exists
    const propertyType = await (this.prisma as any).propertyType.findUnique({
      where: { id: dto.propertyTypeId },
    });
    if (!propertyType) {
      throw new BadRequestException('Invalid property type');
    }

    // If creating an active template, deactivate existing active for this type
    if (dto.isActive) {
      await (this.prisma as any).superAdminCertificate.updateMany({
        where: { propertyTypeId: dto.propertyTypeId, isActive: true },
        data: { isActive: false },
      });
    }

    return (this.prisma as any).superAdminCertificate.create({
      data: {
        propertyTypeId: dto.propertyTypeId,
        name: dto.name,
        description: dto.description,
        imageUrl: dto.imageUrl,
        validityMonths: dto.validityMonths ?? 12,
        isActive: dto.isActive ?? true,
        createdBy: superAdminId,
      },
    });
  }

  async updateTemplate(
    id: string,
    dto: {
      name?: string;
      description?: string;
      imageUrl?: string;
      validityMonths?: number;
      isActive?: boolean;
    }
  ) {
    return (this.prisma as any).superAdminCertificate.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        imageUrl: dto.imageUrl,
        validityMonths: dto.validityMonths,
        isActive: dto.isActive,
      },
    });
  }

  async activateTemplate(id: string) {
    const template = await (this.prisma as any).superAdminCertificate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');

    await (this.prisma as any).superAdminCertificate.updateMany({
      where: { propertyTypeId: template.propertyTypeId, isActive: true },
      data: { isActive: false },
    });

    return (this.prisma as any).superAdminCertificate.update({
      where: { id },
      data: { isActive: true },
    });
  }

  async listTemplates(options?: { propertyTypeId?: string }) {
    return (this.prisma as any).superAdminCertificate.findMany({
      where: {
        propertyTypeId: options?.propertyTypeId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyCertification(qrCodeData: string) {
    return this.prisma.certification.findFirst({
      where: { qrCodeData },
      include: {
        host: true,
        application: {
          include: { documents: true },
        },
      },
    });
  }

  async findAll(options: {
    status?: CertificationStatus;
    hostId?: number;
    skip?: number;
    take?: number;
    orderBy?: any;
  }): Promise<{ certifications: CertificationWithDetails[]; total: number }> {
    const {
      status,
      hostId,
      skip = 0,
      take = 10,
      orderBy = { issuedAt: 'desc' },
    } = options;

    const where: any = {};
    if (status) where.status = status;
    if (hostId) where.hostId = hostId;

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
        skip,
        take,
        orderBy,
      }),
      this.prisma.certification.count({ where }),
    ]);

    return {
      certifications: certifications as CertificationWithDetails[],
      total,
    };
  }

  async findOne(
    id: string,
    userId?: number,
    userRole?: UserRole
  ): Promise<CertificationWithDetails> {
    const certification = await this.prisma.certification.findUnique({
      where: { id },
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
    });

    if (!certification) {
      throw new NotFoundException('Certification not found');
    }

    // Check permissions
    if (userId && userRole !== UserRole.SUPER_ADMIN) {
      if (userRole === UserRole.HOST && certification.hostId !== userId) {
        throw new ForbiddenException(
          'You can only access your own certifications'
        );
      }
    }

    return certification as CertificationWithDetails;
  }

  async findByCertificateNumber(
    certificateNumber: string
  ): Promise<CertificationWithDetails | null> {
    const certification = await this.prisma.certification.findUnique({
      where: { certificateNumber },
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
    });

    return certification as CertificationWithDetails | null;
  }

  async revokeCertification(
    id: string,
    reason: string,
    adminId: number,
    adminEmail: string
  ): Promise<Certification> {
    const certification = await this.findOne(id, adminId, UserRole.ADMIN);

    if (certification.status === CertificationStatus.REVOKED) {
      throw new BadRequestException('Certification is already revoked');
    }

    if (certification.status === CertificationStatus.EXPIRED) {
      throw new BadRequestException('Cannot revoke an expired certification');
    }

    const revokedCertification = await this.prisma.certification.update({
      where: { id },
      data: {
        status: CertificationStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy: adminId,
        revokeReason: reason,
      },
    });

    // Audit the revocation
    await this.auditService.auditCertificationAction(
      'CERTIFICATION_REVOKED',
      id,
      adminId.toString(),
      adminEmail,
      'ADMIN',
      {
        certificateNumber: certification.certificateNumber,
        reason,
        hostId: certification.hostId,
      }
    );

    this.logger.log(
      `Certification revoked: ${certification.certificateNumber}`,
      'CertificationService',
      {
        certificationId: id,
        reason,
        adminId,
      }
    );

    return revokedCertification;
  }

  async renewCertification(
    id: string,
    adminId?: number
  ): Promise<Certification> {
    const certification = await this.findOne(
      id,
      adminId,
      adminId ? UserRole.ADMIN : undefined
    );

    if (
      certification.status !== CertificationStatus.ACTIVE &&
      certification.status !== CertificationStatus.EXPIRED
    ) {
      throw new BadRequestException(
        'Only active or expired certifications can be renewed'
      );
    }

    const validityMonths = this.configService.get<number>(
      'CERTIFICATION_VALIDITY_MONTHS',
      12
    );
    const newExpiresAt = new Date();
    newExpiresAt.setMonth(newExpiresAt.getMonth() + validityMonths);

    const renewedCertification = await this.prisma.certification.update({
      where: { id },
      data: {
        status: CertificationStatus.ACTIVE,
        expiresAt: newExpiresAt,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      },
    });

    // Audit the renewal
    if (adminId) {
      await this.auditService.auditCertificationAction(
        'CERTIFICATION_RENEWED',
        id,
        adminId.toString(),
        certification.host.email,
        'ADMIN',
        {
          certificateNumber: certification.certificateNumber,
          newExpiresAt: newExpiresAt.toISOString(),
        }
      );
    }

    this.logger.log(
      `Certification renewed: ${certification.certificateNumber}`,
      'CertificationService',
      {
        certificationId: id,
        newExpiresAt: newExpiresAt.toISOString(),
      }
    );

    return renewedCertification;
  }

  async checkExpiryStatus(): Promise<{
    expiringSoon: CertificationWithDetails[];
    expired: CertificationWithDetails[];
  }> {
    const now = new Date();
    const warningDays = this.configService.get<number>(
      'CERTIFICATION_RENEWAL_REMINDER_DAYS',
      30
    );
    const warningDate = new Date();
    warningDate.setDate(now.getDate() + warningDays);

    const [expiringSoon, expired] = await Promise.all([
      this.prisma.certification.findMany({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: {
            gte: now,
            lte: warningDate,
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
      }),
      this.prisma.certification.findMany({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: {
            lt: now,
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
      }),
    ]);

    // Update expired certifications
    if (expired.length > 0) {
      await this.prisma.certification.updateMany({
        where: {
          id: { in: expired.map(c => c.id) },
        },
        data: {
          status: CertificationStatus.EXPIRED,
        },
      });
    }

    return {
      expiringSoon: expiringSoon as CertificationWithDetails[],
      expired: expired as CertificationWithDetails[],
    };
  }

  private async validateCertificationRequirements(
    application: any
  ): Promise<void> {
    // Check if payment was completed
    const completedPayments = application.payments.filter(
      p => p.status === 'COMPLETED'
    );
    if (completedPayments.length === 0) {
      throw new BadRequestException(
        'Payment must be completed before certification can be generated'
      );
    }

    // Check if all required documents are uploaded
    const requiredDocuments = [
      'ID_DOCUMENT',
      'SAFETY_PERMIT',
      'INSURANCE_CERTIFICATE',
      'PROPERTY_DEED',
    ];
    const uploadedTypes = application.documents.map(d => d.documentType);

    for (const requiredType of requiredDocuments) {
      if (!uploadedTypes.includes(requiredType)) {
        throw new BadRequestException(
          `Required document missing: ${requiredType}`
        );
      }
    }

    // Additional validation can be added here
  }

  private async generateCertificateNumber(): Promise<string> {
    let certificateNumber: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      // Generate format: CERT-YYYY-NNNNNN (e.g., CERT-2024-000001)
      const year = new Date().getFullYear();
      const randomNum = Math.floor(Math.random() * 999999)
        .toString()
        .padStart(6, '0');
      certificateNumber = `CERT-${year}-${randomNum}`;

      attempts++;
      if (attempts >= maxAttempts) {
        throw new BadRequestException(
          'Unable to generate unique certificate number'
        );
      }
    } while (
      await this.prisma.certification.findUnique({
        where: { certificateNumber },
      })
    );

    return certificateNumber;
  }

  async getCertificationStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    revoked: number;
    expiringSoon: number;
  }> {
    const now = new Date();
    const warningDays = this.configService.get<number>(
      'CERTIFICATION_RENEWAL_REMINDER_DAYS',
      30
    );
    const warningDate = new Date();
    warningDate.setDate(now.getDate() + warningDays);

    const [total, active, expired, revoked, expiringSoon] = await Promise.all([
      this.prisma.certification.count(),
      this.prisma.certification.count({
        where: { status: CertificationStatus.ACTIVE, expiresAt: { gt: now } },
      }),
      this.prisma.certification.count({
        where: { status: CertificationStatus.EXPIRED },
      }),
      this.prisma.certification.count({
        where: { status: CertificationStatus.REVOKED },
      }),
      this.prisma.certification.count({
        where: {
          status: CertificationStatus.ACTIVE,
          expiresAt: { gte: now, lte: warningDate },
        },
      }),
    ]);

    return { total, active, expired, revoked, expiringSoon };
  }
}
