import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserRole } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '@/common/mail/mail.service';
import { RedisService } from '@/redis/redis.service';
import { randomInt } from 'crypto';
export interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthResult {
  user: {
    id: number;
    email: string;
    role: UserRole;
    emailVerified: boolean;
    isEmail: boolean;
    isNotification: boolean;
  };
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    private readonly redisService: RedisService
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user && (await bcrypt.compare(password, user.password))) {
      return user;
    }
    return null;
  }

  async login(loginDto: LoginDto): Promise<any> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Email not verified. Please check your email for verification link.'
      );
    }

    // ✅ Save FCM token if provided
    if (loginDto.fcmToken) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { fcmToken: loginDto.fcmToken },
      });
    }

    // ✅ MFA flow
    if (user.mfaEnabled) {
      const otp = randomInt(100000, 999999).toString();

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: otp,
          resetPasswordExpires: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      await this.mailService.sendOTPEmail(user.email, user.name, otp);

      return {
        message: 'OTP sent to your email for verification.',
        mfaRequired: true,
        email: user.email,
      };
    }

    // ✅ Normal login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user);

    return {
      message: 'Successfully logged in.',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        mfaEnabled: user.mfaEnabled,
        isEmail: user.isEmail,
        isNotification: user.isNotification,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async sendOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found.');

    const otp = randomInt(100000, 999999).toString();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: otp,
        resetPasswordExpires: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    await this.mailService.sendOTPEmail(user.email, user.name, otp);

    return { message: 'OTP sent successfully.' };
  }

  async verifyOtp(email: string, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found.');

    if (!user.resetPasswordToken || user.resetPasswordToken !== otp) {
      throw new UnauthorizedException('Invalid or expired OTP.');
    }

    if (user.resetPasswordExpires && user.resetPasswordExpires < new Date()) {
      throw new UnauthorizedException('OTP expired.');
    }

    // Clear OTP fields
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: null,
        resetPasswordExpires: null,
        lastLoginAt: new Date(),
      },
    });

    const tokens = await this.generateTokens(user);

    return {
      message: 'OTP verified successfully.',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        mfaEnabled: user.mfaEnabled,
        isEmail: user.isEmail,
        isNotification: user.isNotification,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async register(
    registerDto: RegisterDto
  ): Promise<{ message: string; userId: number }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email.toLowerCase(),
        password: hashedPassword,
        name: `${registerDto.firstName} ${registerDto.lastName}`.trim(),
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        companyName: registerDto.companyName,
        phone: registerDto.phone,
        role: UserRole.HOST, // Default role
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      },
    });

    // 🔑 Generate email verification token
    const token = this.jwtService.sign(
      { sub: user.id, email: user.email },
      {
        secret: this.configService.get<string>('JWT_EMAIL_SECRET'),
        expiresIn: '1d',
      }
    );

    // 📧 Send email verification
    if (user.isEmail === true) {
      await this.mailService.sendEmailVerification(
        user.email,
        token,
        registerDto.firstName
      );
    }

    return {
      message:
        'Registration successful. Please check your email for verification link.',
      userId: user.id,
    };
  }

  // change password from profile

  async changePassword(
    userId: number,
    changePasswordDto: ChangePasswordDto
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedNewPassword = await bcrypt.hash(
      changePasswordDto.newPassword,
      12
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedNewPassword,
        updatedAt: new Date(),
      },
    });

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email.toLowerCase() },
    });

    // Always return the same message for security
    const response = {
      message:
        'If an account with this email exists, a password reset link has been sent.',
    };

    if (!user) {
      return response;
    }

    // 🔑 Generate reset token (JWT like register)
    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email },
      {
        secret: this.configService.get<string>('JWT_RESET_SECRET'),
        expiresIn: '1h', // Token valid for 1 hour
      }
    );

    // 📧 Send password reset email
    if (user.isEmail === true) {
      await this.mailService.sendPasswordResetEmail(user.email, resetToken);
    }

    return response;
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto
  ): Promise<{ message: string }> {
    try {
      // 1️⃣ Ensure passwords match (extra layer of safety)
      if (resetPasswordDto.newPassword !== resetPasswordDto.confirmPassword) {
        throw new BadRequestException('Passwords do not match');
      }

      // 2️⃣ Verify the reset token
      const payload = this.jwtService.verify(resetPasswordDto.token, {
        secret: this.configService.get<string>('JWT_RESET_SECRET'),
      });

      // 3️⃣ Find user
      const user = await this.prisma.user.findUnique({
        where: { id: Number(payload.sub) },
      });

      if (!user) {
        throw new BadRequestException('Invalid or expired token');
      }

      // 4️⃣ Hash new password
      const hashedPassword = await bcrypt.hash(
        resetPasswordDto.newPassword,
        12
      );

      // 5️⃣ Update user password
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
      });

      return { message: 'Password reset successfully' };
    } catch (err) {
      throw new BadRequestException('Invalid or expired token');
    }
  }

  async refreshToken(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: Number(payload.sub) },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: number, token: string): Promise<{ message: string }> {
    // ⏱ Get token TTL (same as JWT expiry)
    const ttl = this.configService.get<number>('JWT_EXPIRATION', 3600);

    // ❌ Blacklist token in Redis until it naturally expires
    await this.redisService.set(`blacklist:${token}`, 'true', ttl);

    return { message: 'Logged out successfully' };
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const exists = await this.redisService.get(`blacklist:${token}`);
    return !!exists;
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_EMAIL_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: Number(payload.sub) },
      });

      if (!user) {
        throw new BadRequestException('Invalid token');
      }

      if (user.emailVerified) {
        return { message: 'Email already verified' };
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          status: 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      return { message: 'Email verified successfully' };
    } catch (err) {
      throw new BadRequestException('Invalid or expired token');
    }
  }

  private async generateTokens(
    user: User
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return { accessToken, refreshToken };
  }

  async findUserById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }
}
