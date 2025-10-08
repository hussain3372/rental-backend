import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Adjust path as needed
import * as crypto from 'crypto';
import { MailService } from '@/common/mail/mail.service';

@Injectable()
export class TwofaService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService
  ) {}

  // Generate a 6-digit OTP
  private generateOTP(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  // Send OTP to user's email
  async sendOTP(userId: number) {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate OTP
    const otp = this.generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // OTP expires in 10 minutes

    // Save OTP in TwoFA table
    await this.prisma.twoFA.upsert({
      where: { userId },
      update: {
        otp,
        expiresAt,
        isVerified: false,
      },
      create: {
        userId,
        otp,
        expiresAt,
        isVerified: false,
      },
    });

    // Send OTP via email
    await this.mailService.sendOTPEmail(user.email, user.name, otp);

    return {
      message: 'OTP sent successfully to your email',
      email: user.email,
    };
  }

  // Verify OTP and enable MFA
  async verifyOTP(userId: number, otp: string) {
    // Find TwoFA record
    const twoFARecord = await this.prisma.twoFA.findUnique({
      where: { userId },
    });

    if (!twoFARecord) {
      throw new BadRequestException('No OTP found for this user');
    }

    // Check if OTP is expired
    if (new Date() > twoFARecord.expiresAt) {
      throw new BadRequestException(
        'OTP has expired. Please request a new one'
      );
    }

    // Verify OTP
    if (twoFARecord.otp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }

    // Mark as verified and enable MFA
    await this.prisma.$transaction([
      this.prisma.twoFA.update({
        where: { userId },
        data: { isVerified: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      }),
    ]);

    return {
      message: 'OTP verified successfully. MFA has been enabled',
      mfaEnabled: true,
    };
  }

  // Update MFA status
  async updateMFAStatus(userId: number, mfaEnabled: boolean) {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // If enabling MFA, send OTP first
    if (mfaEnabled) {
      return await this.sendOTP(userId);
    }

    // If disabling MFA
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false },
    });

    // Optionally delete TwoFA record when disabling
    await this.prisma.twoFA.deleteMany({
      where: { userId },
    });

    return {
      message: 'MFA has been disabled',
      mfaEnabled: false,
    };
  }

  // Get MFA status
  async getMFAStatus(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        mfaEnabled: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      userId: user.id,
      email: user.email,
      mfaEnabled: user.mfaEnabled,
    };
  }
}
