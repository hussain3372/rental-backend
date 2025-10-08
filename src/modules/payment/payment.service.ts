import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Payment,
  PaymentStatus,
  UserRole,
  ApplicationStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';
import { StripeService } from './stripe.service';

export interface PaymentWithDetails extends Payment {
  application: {
    id: string;
    status: ApplicationStatus;
    propertyDetails: any;
  };
  host: {
    id: number;
    name: string;
    email: string;
  };
}

export interface CreatePaymentIntentData {
  applicationId: string;
  amount: number;
  currency?: string;
  description?: string;
}

export interface PaymentIntentResponse {
  paymentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

export interface RefundData {
  paymentId: string;
  amount?: number; // Partial refund if specified, full refund if not
  reason?: string;
}

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private auditService: AuditService,
    private logger: EnhancedLoggerService,
    private stripeService: StripeService
  ) {}

  async createPaymentIntent(
    data: CreatePaymentIntentData,
    userId: number,
    userRole: UserRole
  ): Promise<PaymentIntentResponse> {
    const { applicationId, amount, currency = 'USD', description } = data;

    // Validate application
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { host: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // Check permissions
    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new BadRequestException(
        'You can only create payments for your own applications'
      );
    }

    // Validate application status - payment should be in PAYMENT step
    if (
      application.status !== ApplicationStatus.SUBMITTED &&
      application.currentStep !== 'PAYMENT'
    ) {
      throw new BadRequestException('Application is not in the payment step');
    }

    // Check if payment already exists
    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        applicationId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.COMPLETED] },
      },
    });

    if (existingPayment) {
      throw new ConflictException(
        'Payment already exists for this application'
      );
    }

    // Validate amount (should match certification fee)
    const expectedAmount = this.getCertificationFee();
    if (Math.abs(amount - expectedAmount) > 0.01) {
      throw new BadRequestException(
        `Payment amount must be exactly $${expectedAmount}`
      );
    }

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        applicationId,
        hostId: application.hostId,
        amount: amount.toString(),
        currency,
        status: PaymentStatus.PENDING,
        paymentMethod: 'card', // Default, will be updated by webhook
      },
    });

    // Create payment intent with external gateway (placeholder for Stripe integration)
    const paymentIntent = await this.createExternalPaymentIntent({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      paymentId: payment.id,
      description:
        description || `Certification fee for application ${applicationId}`,
      metadata: {
        applicationId,
        hostId: application.hostId.toString(),
        paymentId: payment.id,
      },
    });

    // Update payment with gateway transaction ID
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayTransactionId: paymentIntent.id,
        gatewayResponse: paymentIntent,
      },
    });

    // Audit the payment creation
    await this.auditService.auditPaymentAction(
      'PAYMENT_INTENT_CREATED',
      payment.id,
      userId.toString(),
      application.host.email,
      amount,
      currency,
      true,
      {
        applicationId,
        gatewayTransactionId: paymentIntent.id,
      }
    );

    this.logger.log(`Payment intent created: ${payment.id}`, 'PaymentService', {
      paymentId: payment.id,
      applicationId,
      amount,
      userId,
    });

    return {
      paymentId: payment.id,
      clientSecret: paymentIntent.client_secret,
      amount,
      currency,
      status: PaymentStatus.PENDING,
    };
  }

  async mockPayment(
    applicationId: string,
    amount: number,
    currency: string,
    userId: number,
    userRole: UserRole
  ): Promise<any> {
    // Validate application
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { host: true },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new BadRequestException(
        'You can only pay for your own application'
      );
    }

    // Create and immediately complete the payment
    const payment = await this.prisma.payment.create({
      data: {
        applicationId,
        hostId: application.hostId,
        amount,
        currency,
        status: 'COMPLETED',
        paymentMethod: 'MOCK',
        gatewayTransactionId: `mock_txn_${Date.now()}`,
        gatewayResponse: { mock: true },
      },
    });

    // Move application step to SUBMISSION
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        currentStep: 'SUBMISSION',
      },
    });

    return payment;
  }

  async confirmPayment(
    paymentId: string,
    gatewayTransactionId: string,
    gatewayResponse: any
  ): Promise<Payment> {
    // Find payment
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === PaymentStatus.COMPLETED) {
      return payment; // Already confirmed
    }

    // Update payment status
    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.COMPLETED,
        gatewayTransactionId,
        gatewayResponse,
        updatedAt: new Date(),
      },
    });

    // Update application status to move to submission step
    await this.prisma.application.update({
      where: { id: payment.applicationId },
      data: {
        currentStep: 'SUBMISSION',
        updatedAt: new Date(),
      },
    });

    // Audit the payment confirmation
    await this.auditService.auditPaymentAction(
      'PAYMENT_CONFIRMED',
      paymentId,
      payment.hostId.toString(),
      'SYSTEM', // Gateway initiated
      Number(payment.amount),
      payment.currency,
      true,
      {
        applicationId: payment.applicationId,
        gatewayTransactionId,
      }
    );

    this.logger.log(`Payment confirmed: ${paymentId}`, 'PaymentService', {
      paymentId,
      applicationId: payment.applicationId,
      amount: payment.amount,
    });

    return updatedPayment;
  }

  async failPayment(
    paymentId: string,
    reason: string,
    gatewayResponse?: any
  ): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.FAILED,
        gatewayResponse,
        updatedAt: new Date(),
      },
    });

    // Audit the payment failure
    await this.auditService.auditPaymentAction(
      'PAYMENT_FAILED',
      paymentId,
      payment.hostId.toString(),
      'SYSTEM',
      Number(payment.amount),
      payment.currency,
      false,
      {
        reason,
        applicationId: payment.applicationId,
      }
    );

    this.logger.log(`Payment failed: ${paymentId}`, 'PaymentService', {
      paymentId,
      reason,
      applicationId: payment.applicationId,
    });

    return updatedPayment;
  }

  async processRefund(data: RefundData, adminId: number): Promise<Payment> {
    const { paymentId, amount, reason } = data;

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { host: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Only completed payments can be refunded');
    }

    const refundAmount = amount || Number(payment.amount);
    const currentRefundedAmount = payment.refundedAmount
      ? Number(payment.refundedAmount)
      : 0;

    if (currentRefundedAmount + refundAmount > Number(payment.amount)) {
      throw new BadRequestException('Refund amount exceeds payment amount');
    }

    // Process refund with external gateway
    const refundResult = await this.processExternalRefund({
      paymentIntentId: payment.gatewayTransactionId,
      amount: Math.round(refundAmount * 100), // Convert to cents
      reason,
    });

    // Update payment record
    const newRefundedAmount = currentRefundedAmount + refundAmount;
    const newStatus =
      newRefundedAmount >= Number(payment.amount)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: newStatus,
        refundedAmount: newRefundedAmount.toString(),
        refundedAt: new Date(),
        gatewayResponse: refundResult,
        updatedAt: new Date(),
      },
    });

    // Audit the refund
    await this.auditService.auditPaymentAction(
      'PAYMENT_REFUNDED',
      paymentId,
      adminId.toString(),
      payment.host.email,
      refundAmount,
      payment.currency,
      true,
      {
        refundAmount,
        totalRefunded: newRefundedAmount,
        reason,
        applicationId: payment.applicationId,
      }
    );

    this.logger.log(`Payment refunded: ${paymentId}`, 'PaymentService', {
      paymentId,
      refundAmount,
      totalRefunded: newRefundedAmount,
      adminId,
    });

    return updatedPayment;
  }

  async findAllByHost(
    hostId: number,
    options?: {
      status?: PaymentStatus;
      skip?: number;
      take?: number;
    }
  ): Promise<{ payments: PaymentWithDetails[]; total: number }> {
    const { status, skip = 0, take = 10 } = options || {};

    const where: any = { hostId };
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          application: {
            select: {
              id: true,
              status: true,
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
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { payments: payments as PaymentWithDetails[], total };
  }

  async findOne(
    paymentId: string,
    userId: number,
    userRole: UserRole
  ): Promise<PaymentWithDetails> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        application: {
          select: {
            id: true,
            status: true,
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
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Check permissions
    if (userRole === UserRole.HOST && payment.hostId !== userId) {
      throw new BadRequestException('You can only view your own payments');
    }

    return payment as PaymentWithDetails;
  }

  async getPaymentStats(): Promise<{
    totalRevenue: number;
    totalPayments: number;
    successfulPayments: number;
    failedPayments: number;
    refundedAmount: number;
    monthlyRevenue: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      allPayments,
      successfulPayments,
      failedPayments,
      refundedPayments,
      monthlyPayments,
    ] = await Promise.all([
      this.prisma.payment.findMany({
        select: { amount: true, refundedAmount: true },
      }),
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.COMPLETED },
        select: { amount: true },
      }),
      this.prisma.payment.count({
        where: { status: PaymentStatus.FAILED },
      }),
      this.prisma.payment.findMany({
        where: {
          status: {
            in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
          },
        },
        select: { refundedAmount: true },
      }),
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.COMPLETED,
          createdAt: { gte: startOfMonth },
        },
        select: { amount: true },
      }),
    ]);

    const totalRevenue = successfulPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    const refundedAmount = refundedPayments.reduce(
      (sum, p) => sum + Number(p.refundedAmount || 0),
      0
    );
    const monthlyRevenue = monthlyPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );

    return {
      totalRevenue,
      totalPayments: allPayments.length,
      successfulPayments: successfulPayments.length,
      failedPayments,
      refundedAmount,
      monthlyRevenue,
    };
  }

  private getCertificationFee(): number {
    // This could be configurable based on plan, region, etc.
    return this.configService.get<number>('CERTIFICATION_FEE', 99.0);
  }

  private async createExternalPaymentIntent(data: {
    amount: number;
    currency: string;
    paymentId: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    if (!this.stripeService.isConfigured()) {
      // Fallback to mock for development/testing
      this.logger.warn('Stripe not configured, using mock payment intent');
      const mockPaymentIntent = {
        id: `pi_mock_${Date.now()}`,
        client_secret: `pi_mock_secret_${Date.now()}`,
        amount: data.amount,
        currency: data.currency,
        status: 'requires_payment_method',
        metadata: data.metadata,
      };
      return mockPaymentIntent;
    }

    return await this.stripeService.createPaymentIntent({
      amount: data.amount,
      currency: data.currency,
      paymentId: data.paymentId,
      description: data.description,
      metadata: data.metadata,
    });
  }

  private async processExternalRefund(data: {
    paymentIntentId: string;
    amount: number;
    reason?: string;
  }): Promise<any> {
    if (!this.stripeService.isConfigured()) {
      // Fallback to mock for development/testing
      this.logger.warn('Stripe not configured, using mock refund');
      const mockRefund = {
        id: `ref_mock_${Date.now()}`,
        amount: data.amount,
        status: 'succeeded',
        reason: data.reason,
      };
      return mockRefund;
    }

    return await this.stripeService.createRefund({
      paymentIntentId: data.paymentIntentId,
      amount: data.amount,
      reason: data.reason,
    });
  }
}
