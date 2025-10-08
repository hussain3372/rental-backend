import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CertificationService, CertificationWithDetails } from './certification.service';
import { CertificationStatus } from '@prisma/client';

interface VerificationResponse {
  valid: boolean;
  status: CertificationStatus;
  certificateNumber: string;
  issuedAt: Date;
  expiresAt: Date;
  isExpired: boolean;
  isRevoked: boolean;
  propertyDetails: any;
  hostInfo: {
    name: string;
    email: string;
  };
  message: string;
  badgeUrl?: string;
  qrCodeUrl?: string;
}

@Controller('verify')
export class VerificationController {
  constructor(private readonly certificationService: CertificationService) {}

  @Get(':qrCode')
  @HttpCode(HttpStatus.OK)
  async verifyByQrCode(@Param('qrCode') qrCode: string): Promise<VerificationResponse> {
    if (!qrCode || qrCode.trim().length === 0) {
      throw new BadRequestException('QR code is required');
    }

    // Try to find certification by QR code data first
    let certification: CertificationWithDetails | null = null;

    // Search by qrCodeData field
    certification = await this.certificationService.findByCertificateNumber(qrCode);

    // If not found, try searching by certificate number (fallback for older QR codes)
    if (!certification) {
      // Extract certificate number from QR code if it's embedded
      const certMatch = qrCode.match(/CERT-\d{4}-\d{6}/);
      if (certMatch) {
        certification = await this.certificationService.findByCertificateNumber(certMatch[0]);
      }
    }

    if (!certification) {
      return {
        valid: false,
        status: CertificationStatus.EXPIRED, // Default status for not found
        certificateNumber: '',
        issuedAt: new Date(),
        expiresAt: new Date(),
        isExpired: true,
        isRevoked: false,
        propertyDetails: null,
        hostInfo: { name: '', email: '' },
        message: 'Certification not found or invalid QR code',
      };
    }

    const now = new Date();
    const isExpired = certification.expiresAt < now;
    const isRevoked = certification.status === CertificationStatus.REVOKED;
    const isValid = !isExpired && !isRevoked && certification.status === CertificationStatus.ACTIVE;

    let message = '';
    if (isRevoked) {
      message = 'This certification has been revoked by the administrator';
    } else if (isExpired) {
      message = 'This certification has expired';
    } else if (certification.status === CertificationStatus.ACTIVE) {
      message = 'This certification is valid and active';
    } else {
      message = `This certification is ${certification.status.toLowerCase()}`;
    }

    return {
      valid: isValid,
      status: certification.status,
      certificateNumber: certification.certificateNumber,
      issuedAt: certification.issuedAt,
      expiresAt: certification.expiresAt,
      isExpired,
      isRevoked,
      propertyDetails: certification.application.propertyDetails,
      hostInfo: {
        name: certification.host.name,
        email: certification.host.email,
      },
      message,
      badgeUrl: certification.badgeUrl,
      qrCodeUrl: certification.qrCodeUrl,
    };
  }

  @Get('certificate/:certificateNumber')
  @HttpCode(HttpStatus.OK)
  async verifyByCertificateNumber(
    @Param('certificateNumber') certificateNumber: string
  ): Promise<VerificationResponse> {
    if (!certificateNumber || certificateNumber.trim().length === 0) {
      throw new BadRequestException('Certificate number is required');
    }

    const certification = await this.certificationService.findByCertificateNumber(certificateNumber);

    if (!certification) {
      throw new NotFoundException('Certificate not found');
    }

    const now = new Date();
    const isExpired = certification.expiresAt < now;
    const isRevoked = certification.status === CertificationStatus.REVOKED;
    const isValid = !isExpired && !isRevoked && certification.status === CertificationStatus.ACTIVE;

    let message = '';
    if (isRevoked) {
      message = 'This certification has been revoked by the administrator';
    } else if (isExpired) {
      message = 'This certification has expired';
    } else if (certification.status === CertificationStatus.ACTIVE) {
      message = 'This certification is valid and active';
    } else {
      message = `This certification is ${certification.status.toLowerCase()}`;
    }

    return {
      valid: isValid,
      status: certification.status,
      certificateNumber: certification.certificateNumber,
      issuedAt: certification.issuedAt,
      expiresAt: certification.expiresAt,
      isExpired,
      isRevoked,
      propertyDetails: certification.application.propertyDetails,
      hostInfo: {
        name: certification.host.name,
        email: certification.host.email,
      },
      message,
      badgeUrl: certification.badgeUrl,
      qrCodeUrl: certification.qrCodeUrl,
    };
  }

  @Get('check/:identifier')
  @HttpCode(HttpStatus.OK)
  async checkCertification(@Param('identifier') identifier: string): Promise<{
    found: boolean;
    certification?: Partial<VerificationResponse>;
  }> {
    if (!identifier || identifier.trim().length === 0) {
      throw new BadRequestException('Identifier is required');
    }

    try {
      // Try QR code verification first
      const qrResult = await this.verifyByQrCode(identifier);
      if (qrResult.certificateNumber) {
        return {
          found: true,
          certification: qrResult,
        };
      }
    } catch (error) {
      // Continue to certificate number check
    }

    try {
      // Try certificate number verification
      const certResult = await this.verifyByCertificateNumber(identifier);
      return {
        found: true,
        certification: certResult,
      };
    } catch (error) {
      // Not found
    }

    return {
      found: false,
    };
  }

  @Get('stats/public')
  @HttpCode(HttpStatus.OK)
  async getPublicStats(): Promise<{
    totalActiveCertifications: number;
    certificationsIssuedThisMonth: number;
    certificationsExpiringSoon: number;
  }> {
    const stats = await this.certificationService.getCertificationStats();

    // Calculate additional public stats
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // This would need to be implemented in the service for better performance
    // For now, return basic stats
    return {
      totalActiveCertifications: stats.active,
      certificationsIssuedThisMonth: 0, // Would need a query to calculate this
      certificationsExpiringSoon: stats.expiringSoon,
    };
  }
}
