import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { CertificationWithDetails } from './certification.service';
import * as QRCode from 'qrcode';
import * as sharp from 'sharp';

export interface BadgeUrls {
  badgePngUrl: string;
  badgePdfUrl?: string;
  qrCodeUrl: string;
}

@Injectable()
export class BadgeService {
  constructor(
    private configService: ConfigService,
    private storageService: StorageService,
  ) {}

  async generateBadge(certification: CertificationWithDetails): Promise<BadgeUrls> {
    // Generate badge (convert SVG → PNG buffer)
    const svgBadge = this.generateBadgeSVG(certification);
    const badgePngBuffer = await sharp(Buffer.from(svgBadge))
      .png()
      .toBuffer();

    // Generate QR code PNG buffer
    const qrCodeBuffer = await this.generateQRCodeImage(certification.verificationUrl);

    // Upload badge image
    const badgeUploadResult = await this.storageService.uploadFile(
      {
        buffer: badgePngBuffer,
        originalname: `badge-${certification.certificateNumber}.png`,
        mimetype: 'image/png',
      },
      `certifications/${certification.id}/badges`,
      certification.hostId.toString(),
      certification.host.email,
      'SYSTEM',
    );

    // Upload QR code image
    const qrUploadResult = await this.storageService.uploadFile(
      {
        buffer: qrCodeBuffer,
        originalname: `qrcode-${certification.certificateNumber}.png`,
        mimetype: 'image/png',
      },
      `certifications/${certification.id}/qrcodes`,
      certification.hostId.toString(),
      certification.host.email,
      'SYSTEM',
    );

    return {
      badgePngUrl: badgeUploadResult.url,
      qrCodeUrl: qrUploadResult.url,
    };
  }

  private generateBadgeSVG(certification: CertificationWithDetails): string {
    const propertyDetails = certification.application.propertyDetails || {};
    const propertyName = propertyDetails.propertyName || 'Property';
    const issuedDate = certification.issuedAt.toLocaleDateString();
    const expiryDate = certification.expiresAt.toLocaleDateString();
    const statusColor = certification.status === 'ACTIVE' ? '#28EB1D' : '#FF3F3F';

    return `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="600" fill="#1a1a1a"/>
      <text x="400" y="80" text-anchor="middle" fill="#EFFC76" font-size="36" font-weight="bold">
        OFFICIAL CERTIFICATION
      </text>
      <text x="400" y="120" text-anchor="middle" fill="#fff" font-size="24" font-weight="bold">
        Certificate #${certification.certificateNumber}
      </text>
      <text x="100" y="280" fill="#fff" font-size="20" font-weight="bold">
        Property: ${propertyName}
      </text>
      <text x="100" y="320" fill="#fff" font-size="20" font-weight="bold">
        Host: ${certification.host.name}
      </text>
      <text x="100" y="360" fill="#fff" font-size="20" font-weight="bold">
        Issued: ${issuedDate}
      </text>
      <text x="100" y="400" fill="#fff" font-size="20" font-weight="bold">
        Expires: ${expiryDate}
      </text>
      <text x="100" y="440" fill="${statusColor}" font-size="18" font-weight="bold">
        Status: ${certification.status}
      </text>
    </svg>`;
  }

  private async generateQRCodeImage(verificationUrl: string): Promise<Buffer> {
    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
      width: 300,
      margin: 2,
    });
    const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  }
}
