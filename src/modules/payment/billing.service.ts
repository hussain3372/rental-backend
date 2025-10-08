import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService, PaymentWithDetails } from './payment.service';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';

export interface InvoiceData {
  paymentId: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  description: string;
  issuedDate: Date;
  dueDate?: Date;
  items: InvoiceItem[];
  taxAmount?: number;
  discountAmount?: number;
  notes?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface BillingHistory {
  payments: PaymentWithDetails[];
  refunds: Array<{
    id: string;
    paymentId: string;
    amount: number;
    reason: string;
    processedAt: Date;
    processedBy: string;
  }>;
  totalSpent: number;
  totalRefunded: number;
  netAmount: number;
}

export interface RefundRequest {
  paymentId: string;
  amount?: number;
  reason: string;
  requestedBy: string;
  notes?: string;
  priority: 'low' | 'medium' | 'high';
}

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private paymentService: PaymentService,
    private configService: ConfigService,
    private auditService: AuditService,
    private logger: EnhancedLoggerService,
  ) {}

  async generateInvoice(paymentId: string): Promise<InvoiceData> {
    const payment = await this.paymentService.findOne(paymentId, 0, 'ADMIN'); // Admin access

    if (payment.status !== 'COMPLETED') {
      throw new BadRequestException('Can only generate invoices for completed payments');
    }

    const invoiceNumber = await this.generateInvoiceNumber();
    const customerName = payment.host.name || 'Unknown Customer';

    const invoiceData: InvoiceData = {
      paymentId,
      invoiceNumber,
      customerName,
      customerEmail: payment.host.email,
      amount: Number(payment.amount),
      currency: payment.currency,
      description: `Certification Fee Payment - ${payment.application.propertyDetails?.propertyName || 'Property'}`,
      issuedDate: new Date(),
      items: [
        {
          description: 'Short-term Rental Property Certification',
          quantity: 1,
          unitPrice: Number(payment.amount),
          amount: Number(payment.amount),
        }
      ],
      notes: `Application ID: ${payment.application.id}\nPayment completed on: ${payment.updatedAt?.toLocaleDateString()}`,
    };

    // Store invoice data (in a real implementation, you'd save to database or generate PDF)
    await this.storeInvoiceData(invoiceData);

    // Audit the invoice generation
    await this.auditService.auditPaymentAction(
      'INVOICE_GENERATED',
      paymentId,
      'SYSTEM',
      payment.host.email,
      Number(payment.amount),
      payment.currency,
      true,
      {
        invoiceNumber,
        customerEmail: payment.host.email,
      }
    );

    this.logger.log(
      `Invoice generated: ${invoiceNumber}`,
      'BillingService',
      { paymentId, invoiceNumber, amount: payment.amount }
    );

    return invoiceData;
  }

  async getBillingHistory(hostId: number): Promise<BillingHistory> {
    // Get all payments for the host
    const { payments } = await this.paymentService.findAllByHost(hostId);

    // Get refund history (would need a refund table in a real implementation)
    // For now, simulate from payment refund data
    const refunds = payments
      .filter(p => p.refundedAmount && Number(p.refundedAmount) > 0)
      .map(p => ({
        id: `ref_${p.id}`,
        paymentId: p.id,
        amount: Number(p.refundedAmount!),
        reason: 'Customer requested refund',
        processedAt: p.refundedAt || new Date(),
        processedBy: 'System',
      }));

    const totalSpent = payments
      .filter(p => p.status === 'COMPLETED')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);
    const netAmount = totalSpent - totalRefunded;

    return {
      payments,
      refunds,
      totalSpent,
      totalRefunded,
      netAmount,
    };
  }

  async submitRefundRequest(
    request: RefundRequest,
    adminId: number
  ): Promise<{ requestId: string; status: string }> {
    // Validate payment exists and belongs to user
    const payment = await this.paymentService.findOne(request.paymentId, 0, 'ADMIN');

    if (payment.status !== 'COMPLETED') {
      throw new BadRequestException('Refunds can only be processed for completed payments');
    }

    const refundAmount = request.amount || Number(payment.amount);
    const currentRefunded = payment.refundedAmount ? Number(payment.refundedAmount) : 0;

    if (currentRefunded + refundAmount > Number(payment.amount)) {
      throw new BadRequestException('Refund amount exceeds available payment amount');
    }

    // In a real implementation, you'd create a refund request record
    // For now, we'll process the refund immediately
    const refundResult = await this.paymentService.processRefund({
      paymentId: request.paymentId,
      amount: refundAmount,
      reason: request.reason,
    }, adminId);

    // Audit the refund request
    await this.auditService.auditPaymentAction(
      'REFUND_REQUEST_SUBMITTED',
      request.paymentId,
      adminId.toString(),
      payment.host.email,
      refundAmount,
      payment.currency,
      true,
      {
        refundAmount,
        reason: request.reason,
        priority: request.priority,
        notes: request.notes,
      }
    );

    this.logger.log(
      `Refund request processed: ${request.paymentId}`,
      'BillingService',
      {
        paymentId: request.paymentId,
        refundAmount,
        reason: request.reason,
        adminId
      }
    );

    return {
      requestId: `rr_${Date.now()}`,
      status: 'processed',
    };
  }

  async getRefundRequests(filters?: {
    status?: 'pending' | 'approved' | 'processed' | 'rejected';
    priority?: 'low' | 'medium' | 'high';
    limit?: number;
  }): Promise<Array<{
    id: string;
    paymentId: string;
    customerName: string;
    customerEmail: string;
    amount: number;
    reason: string;
    priority: string;
    requestedAt: Date;
    status: string;
  }>> {
    // In a real implementation, you'd query a refund_requests table
    // For now, return empty array as placeholder
    return [];
  }

  async getRevenueAnalytics(period: 'week' | 'month' | 'quarter' | 'year'): Promise<{
    totalRevenue: number;
    monthlyBreakdown: Array<{ month: string; revenue: number }>;
    topServices: Array<{ service: string; revenue: number }>;
    refundRate: number;
    averageTransactionValue: number;
  }> {
    const stats = await this.paymentService.getPaymentStats();

    // Calculate period-specific data
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

    // In a real implementation, you'd query for detailed analytics
    // For now, return basic calculations
    const monthlyBreakdown = [
      { month: 'Current', revenue: stats.monthlyRevenue },
      // Would include historical data
    ];

    const refundRate = stats.totalPayments > 0 ? (stats.refundedAmount / stats.totalRevenue) * 100 : 0;
    const averageTransactionValue = stats.successfulPayments > 0 ? stats.totalRevenue / stats.successfulPayments : 0;

    return {
      totalRevenue: stats.totalRevenue,
      monthlyBreakdown,
      topServices: [
        { service: 'Property Certification', revenue: stats.totalRevenue },
      ],
      refundRate,
      averageTransactionValue,
    };
  }

  async generateFinancialReport(options: {
    startDate: Date;
    endDate: Date;
    includeRefunds?: boolean;
    includeFailedPayments?: boolean;
  }): Promise<{
    summary: {
      totalRevenue: number;
      totalRefunds: number;
      netRevenue: number;
      transactionCount: number;
      successRate: number;
    };
    breakdown: {
      byMonth: Array<{ month: string; revenue: number; refunds: number }>;
      byPaymentMethod: Array<{ method: string; amount: number; count: number }>;
    };
  }> {
    const { startDate, endDate, includeRefunds = true, includeFailedPayments = false } = options;

    // Query payments within date range
    const payments = await this.prisma.payment.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: includeFailedPayments ? undefined : 'COMPLETED',
      },
      select: {
        amount: true,
        refundedAmount: true,
        status: true,
        paymentMethod: true,
        createdAt: true,
      },
    });

    const totalRevenue = payments
      .filter(p => p.status === 'COMPLETED')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const totalRefunds = includeRefunds
      ? payments.reduce((sum, p) => sum + (Number(p.refundedAmount || 0)), 0)
      : 0;

    const netRevenue = totalRevenue - totalRefunds;
    const transactionCount = payments.filter(p => p.status === 'COMPLETED').length;
    const successRate = payments.length > 0 ? (transactionCount / payments.length) * 100 : 0;

    // Monthly breakdown (simplified)
    const monthlyData = new Map<string, { revenue: number; refunds: number }>();

    payments.forEach(payment => {
      const month = payment.createdAt.toISOString().substring(0, 7); // YYYY-MM
      const existing = monthlyData.get(month) || { revenue: 0, refunds: 0 };

      if (payment.status === 'COMPLETED') {
        existing.revenue += Number(payment.amount);
      }

      if (includeRefunds && payment.refundedAmount) {
        existing.refunds += Number(payment.refundedAmount);
      }

      monthlyData.set(month, existing);
    });

    const byMonth = Array.from(monthlyData.entries()).map(([month, data]) => ({
      month,
      revenue: data.revenue,
      refunds: data.refunds,
    }));

    // Payment method breakdown
    const methodData = new Map<string, { amount: number; count: number }>();

    payments
      .filter(p => p.status === 'COMPLETED')
      .forEach(payment => {
        const method = payment.paymentMethod || 'unknown';
        const existing = methodData.get(method) || { amount: 0, count: 0 };

        existing.amount += Number(payment.amount);
        existing.count += 1;

        methodData.set(method, existing);
      });

    const byPaymentMethod = Array.from(methodData.entries()).map(([method, data]) => ({
      method,
      amount: data.amount,
      count: data.count,
    }));

    return {
      summary: {
        totalRevenue,
        totalRefunds,
        netRevenue,
        transactionCount,
        successRate,
      },
      breakdown: {
        byMonth,
        byPaymentMethod,
      },
    };
  }

  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Get count of invoices for this month (simplified)
    const count = await this.prisma.payment.count({
      where: {
        status: 'COMPLETED',
        updatedAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
        },
      },
    });

    return `INV-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }

  private async storeInvoiceData(invoiceData: InvoiceData): Promise<void> {
    // In a real implementation, you'd store invoice data in a separate table
    // For now, just log it
    this.logger.log(
      `Invoice data stored: ${invoiceData.invoiceNumber}`,
      'BillingService',
      { invoiceNumber: invoiceData.invoiceNumber, amount: invoiceData.amount }
    );
  }
}
