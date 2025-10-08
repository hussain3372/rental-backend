import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    try {
      const smtpConfig = {
        host: this.configService.get<string>('MAIL_HOST'),
        port: this.configService.get<number>('MAIL_PORT'),
        secure: this.configService.get<string>('MAIL_ENCRYPTION') === 'ssl', // true if 465
        auth: {
          user: this.configService.get<string>('MAIL_USERNAME'),
          pass: this.configService.get<string>('MAIL_PASSWORD'),
        },
      };

      this.transporter = nodemailer.createTransport(smtpConfig);

      this.logger.log('✅ Email transporter initialized');
    } catch (error) {
      this.logger.error('❌ Failed to initialize email transporter', error);
      throw error;
    }
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    from?: string;
  }): Promise<boolean> {
    try {
      const from =
        options.from ||
        this.configService.get<string>(
          'MAIL_FROM_ADDRESS',
          'developer@vordx.com'
        );

      const mailOptions = {
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log(`📧 Email sent successfully: ${info.messageId}`, {
        to: options.to,
        subject: options.subject,
      });

      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send email', error);
      return false;
    }
  }

  async sendEmailVerification(
    email: string,
    token: string,
    firstName?: string
  ): Promise<boolean> {
    const subject = 'Verify Your Email Address';
    const verifyUrl = `${this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000'
    )}/verify-email?token=${token}`;

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Hello ${firstName || ''},</h2>
      <p>Thank you for registering with the Rental Host Certification Platform.</p>
      <p>Please verify your email address by clicking the button below:</p>
      <div style="margin: 20px 0;">
        <a href="${verifyUrl}" 
           style="background-color: #3b82f6; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 6px; display: inline-block;">
          Verify Email Address
        </a>
      </div>
      <p>If you didn’t create an account, you can safely ignore this email.</p>
      <p>Best regards,<br>Rental Host Certification Team</p>
    </div>
  `;

    // Debug logs
    console.log('🔹 Preparing to send verification email...');
    console.log('   → Recipient:', email);
    console.log('   → Subject:', subject);
    console.log('   → Verify URL:', verifyUrl);
    console.log('   → SMTP Host:', this.configService.get<string>('MAIL_HOST'));
    console.log('   → SMTP Port:', this.configService.get<string>('MAIL_PORT'));
    console.log(
      '   → SMTP User:',
      this.configService.get<string>('MAIL_USERNAME')
    );

    try {
      const result = await this.sendMail({
        to: email,
        subject,
        html,
      });

      console.log('✅ Email send result:', result);
      return true;
    } catch (error) {
      console.error('❌ Email send failed:', error.message);
      console.error(error);
      return false;
    }
  }

  // Template methods for common emails
  async sendWelcomeEmail(email: string, firstName: string): Promise<boolean> {
    const subject = 'Welcome to Rental Host Certification Platform';
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Welcome ${firstName}!</h2>
      <p>We are excited to have you on board at the Rental Host Certification Platform.</p>
      <p>Explore your dashboard, manage your certifications, and start using all the features available to you.</p>
      <p>If you have any questions, our support team is here to help.</p>
      <p style="margin-top: 30px;">Best regards,<br>Rental Host Certification Team</p>
    </div>
  `;

    return this.sendMail({ to: email, subject, html });
  }

  async sendPasswordResetEmail(
    email: string,
    resetToken: string
  ): Promise<boolean> {
    const subject = 'Password Reset Request';
    const resetUrl = `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000')}/reset-password?token=${resetToken}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>You have requested to reset your password.</p>
        <p>Please click the link below to reset your password:</p>
        <div style="margin: 20px 0;">
          <a href="${resetUrl}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Reset Password
          </a>
        </div>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this reset, please ignore this email.</p>
        <p>Best regards,<br>Rental Host Certification Team</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html });
  }

  async sendCertificationApprovedEmail(
    email: string,
    hostName: string,
    propertyName: string,
    badgeSerial: string
  ): Promise<boolean> {
    const subject = 'Certification Approved - Digital Badge Ready';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Congratulations ${hostName}!</h2>
        <p>Your certification application for <strong>${propertyName}</strong> has been approved.</p>
        <p>Your digital badge is now ready for download:</p>
        <ul>
          <li>Badge Serial: ${badgeSerial}</li>
          <li>Status: Active</li>
        </ul>
        <div style="margin: 20px 0;">
          <a href="#" style="background-color: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Download Badge
          </a>
        </div>
        <p>Best regards,<br>Rental Host Certification Team</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html });
  }

  async sendCertificationRejectedEmail(
    email: string,
    hostName: string,
    propertyName: string,
    reviewNotes: string
  ): Promise<boolean> {
    const subject = 'Certification Application Update';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Application Update</h2>
        <p>Dear ${hostName},</p>
        <p>Thank you for submitting your certification application for <strong>${propertyName}</strong>.</p>
        <p>After careful review, we need some additional information to complete your certification:</p>
        <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <strong>Review Notes:</strong><br>
          ${reviewNotes}
        </div>
        <p>Please update your application and resubmit for review.</p>
        <div style="margin: 20px 0;">
          <a href="#" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Update Application
          </a>
        </div>
        <p>Best regards,<br>Rental Host Certification Team</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html });
  }

  async sendRenewalReminderEmail(
    email: string,
    hostName: string,
    propertyName: string,
    daysUntilExpiry: number
  ): Promise<boolean> {
    const subject = `Certification Expiring Soon - ${daysUntilExpiry} Days Remaining`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Certification Renewal Reminder</h2>
        <p>Dear ${hostName},</p>
        <p>Your certification for <strong>${propertyName}</strong> will expire in <strong>${daysUntilExpiry} days</strong>.</p>
        <p>To maintain your verified status, please renew your certification before the expiry date.</p>
        <div style="margin: 20px 0;">
          <a href="#" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Renew Certification
          </a>
        </div>
        <p>Best regards,<br>Rental Host Certification Team</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html });
  }

  async sendCertificationExpiredEmail(
    email: string,
    hostName: string,
    propertyName: string
  ): Promise<boolean> {
    const subject = 'Certification Expired - Action Required';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Certification Expired</h2>
        <p>Dear ${hostName},</p>
        <p>Your certification for <strong>${propertyName}</strong> has expired.</p>
        <p>Your property has been removed from the public registry. To restore your verified status, please renew your certification immediately.</p>
        <div style="margin: 20px 0;">
          <a href="#" style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            Renew Certification
          </a>
        </div>
        <p>Best regards,<br>Rental Host Certification Team</p>
      </div>
    `;

    return this.sendMail({ to: email, subject, html });
  }

  async sendOTPEmail(to: string, name: string, otp: string) {
    const mailOptions = {
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
      to,
      subject: 'Your Two-Factor Authentication Code',
      html: `
        <div class="container">
            <div class="header">
              <h1>Two-Factor Authentication</h1>
            </div>
            <div class="content">
              <p>Hello ${name},</p>
              <p>You have requested to enable Two-Factor Authentication (2FA) for your account.</p>
              <p>Please use the following verification code:</p>
              <div class="otp-code">${otp}</div>
              <p>This code will expire in <strong>10 minutes</strong>.</p>
              <p class="warning">⚠️ If you did not request this code, please ignore this email and ensure your account is secure.</p>
            </div>
            <div class="footer">
              <p>This is an automated message, please do not reply to this email.</p>
              <p>&copy; ${new Date().getFullYear()} Your Company. All rights reserved.</p>
            </div>
          </div>
      `,
      text: `Hello ${name},\n\nYour Two-Factor Authentication code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.`,
    };

    await this.transporter.sendMail(mailOptions);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Simple health check - verify transporter is ready
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error('❌ Email service health check failed', error);
      return false;
    }
  }
}
