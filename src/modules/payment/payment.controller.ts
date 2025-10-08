import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  ValidationPipe,
  Headers,
  RawBody,
} from '@nestjs/common';
import {
  PaymentService,
  CreatePaymentIntentData,
  RefundData,
} from './payment.service';
import { BillingService, RefundRequest } from './billing.service';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentStatus, UserRole } from '@prisma/client';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { ProcessRefundDto } from './dto/process-refund.dto';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly billingService: BillingService,
    private readonly stripeService: StripeService
  ) {}

  @Post('mock-pay')
  @Roles(UserRole.HOST, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async mockPayment(
    @Body() body: { applicationId: string; amount: number; currency?: string },
    @CurrentUser() user: any
  ) {
    return this.paymentService.mockPayment(
      body.applicationId,
      body.amount,
      body.currency || 'USD',
      user.id,
      user.role
    );
  }

  @Post('create-intent')
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.CREATED)
  createPaymentIntent(
    @Body(ValidationPipe) createPaymentIntentDto: CreatePaymentIntentDto,
    @CurrentUser() user: any
  ) {
    const data: CreatePaymentIntentData = {
      applicationId: createPaymentIntentDto.applicationId,
      amount: createPaymentIntentDto.amount,
      currency: createPaymentIntentDto.currency,
      description: createPaymentIntentDto.description,
    };

    return this.paymentService.createPaymentIntent(data, user.id, user.role);
  }

  @Get('my-payments')
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.OK)
  getMyPayments(
    @CurrentUser() user: any,
    @Query('status') status?: PaymentStatus,
    @Query('skip', ParseIntPipe) skip?: number,
    @Query('take', ParseIntPipe) take?: number
  ) {
    return this.paymentService.findAllByHost(user.id, { status, skip, take });
  }

  @Get(':paymentId')
  @HttpCode(HttpStatus.OK)
  getPayment(@Param('paymentId') paymentId: string, @CurrentUser() user: any) {
    return this.paymentService.findOne(paymentId, user.id, user.role);
  }

  // Admin endpoints
  @Get('admin/stats')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getPaymentStats() {
    return this.paymentService.getPaymentStats();
  }

  @Get('admin/all')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getAllPayments(
    @Query('status') status?: PaymentStatus,
    @Query('hostId', ParseIntPipe) hostId?: number,
    @Query('skip', ParseIntPipe) skip?: number,
    @Query('take', ParseIntPipe) take?: number
  ) {
    // This would need implementation for admin view
    return { message: 'Admin payment listing not yet implemented' };
  }

  @Post('admin/refund')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  processRefund(
    @Body(ValidationPipe) processRefundDto: ProcessRefundDto,
    @CurrentUser() user: any
  ) {
    const data: RefundData = {
      paymentId: processRefundDto.paymentId,
      amount: processRefundDto.amount,
      reason: processRefundDto.reason,
    };

    return this.paymentService.processRefund(data, user.id);
  }

  // Webhook endpoint for Stripe
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() rawBody: Buffer,
    @Headers('stripe-signature') signature: string
  ) {
    try {
      // Verify webhook signature
      const webhookSecret = await this.stripeService.getWebhookSecret();

      if (!webhookSecret) {
        // For development/testing without webhook secret
        return this.handleWebhookWithoutVerification(rawBody);
      }

      const event = this.stripeService.constructWebhookEvent(
        rawBody,
        signature,
        webhookSecret
      );

      return await this.processStripeEvent(event);
    } catch (error) {
      throw new Error(`Webhook processing failed: ${error.message}`);
    }
  }

  private async handleWebhookWithoutVerification(rawBody: Buffer) {
    // For development/testing - parse JSON directly
    const webhookData = JSON.parse(rawBody.toString());
    return await this.processStripeEvent(webhookData);
  }

  private async processStripeEvent(event: any) {
    const { type, data } = event;

    switch (type) {
      case 'payment_intent.succeeded':
        const paymentId = data.object.metadata.paymentId;
        await this.paymentService.confirmPayment(
          paymentId,
          data.object.id,
          data.object
        );
        break;

      case 'payment_intent.payment_failed':
        const failedPaymentId = data.object.metadata.paymentId;
        await this.paymentService.failPayment(
          failedPaymentId,
          data.object.last_payment_error?.message || 'Payment failed',
          data.object
        );
        break;

      case 'payment_intent.canceled':
        const canceledPaymentId = data.object.metadata.paymentId;
        await this.paymentService.failPayment(
          canceledPaymentId,
          'Payment was canceled',
          data.object
        );
        break;

      case 'charge.dispute.created':
        // Handle charge disputes
        const disputePaymentId = data.object.metadata?.paymentId;
        if (disputePaymentId) {
          // Could trigger admin notification or automatic refund
          console.log(`Charge disputed for payment: ${disputePaymentId}`);
        }
        break;

      default:
        // Log unhandled events for monitoring
        console.log(`Unhandled webhook event: ${type}`);
        break;
    }

    return { received: true, event: type };
  }

  // Billing endpoints
  @Get(':paymentId/invoice')
  @HttpCode(HttpStatus.OK)
  generateInvoice(@Param('paymentId') paymentId: string) {
    return this.billingService.generateInvoice(paymentId);
  }

  @Get('billing/history')
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.OK)
  getBillingHistory(@CurrentUser() user: any) {
    return this.billingService.getBillingHistory(user.id);
  }

  @Post('refund/request')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  submitRefundRequest(
    @Body()
    request: {
      paymentId: string;
      amount?: number;
      reason: string;
      notes?: string;
      priority?: 'low' | 'medium' | 'high';
    },
    @CurrentUser() user: any
  ) {
    const refundRequest: RefundRequest = {
      paymentId: request.paymentId,
      amount: request.amount,
      reason: request.reason,
      requestedBy: user.name || user.email,
      notes: request.notes,
      priority: request.priority || 'medium',
    };

    return this.billingService.submitRefundRequest(refundRequest, user.id);
  }

  @Get('refunds/requests')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getRefundRequests(
    @Query('status') status?: 'pending' | 'approved' | 'processed' | 'rejected',
    @Query('priority') priority?: 'low' | 'medium' | 'high',
    @Query('limit', ParseIntPipe) limit?: number
  ) {
    return this.billingService.getRefundRequests({
      status,
      priority,
      limit: limit || 50,
    });
  }

  // Analytics endpoints
  @Get('analytics/revenue')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getRevenueAnalytics(
    @Query('period') period?: 'week' | 'month' | 'quarter' | 'year'
  ) {
    return this.billingService.getRevenueAnalytics(period || 'month');
  }

  @Post('reports/financial')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  generateFinancialReport(
    @Body()
    options: {
      startDate: string;
      endDate: string;
      includeRefunds?: boolean;
      includeFailedPayments?: boolean;
    }
  ) {
    return this.billingService.generateFinancialReport({
      startDate: new Date(options.startDate),
      endDate: new Date(options.endDate),
      includeRefunds: options.includeRefunds ?? true,
      includeFailedPayments: options.includeFailedPayments ?? false,
    });
  }

  // Public endpoint for certification fee
  @Get('fee/certification')
  @HttpCode(HttpStatus.OK)
  getCertificationFee() {
    return {
      amount: 99.0, // This should come from config
      currency: 'USD',
      description: 'Short-term rental property certification fee',
    };
  }
}
