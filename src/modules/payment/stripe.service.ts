import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private configService: ConfigService) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!stripeSecretKey) {
      this.logger.warn('Stripe secret key not found. Stripe integration disabled.');
      return;
    }

    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      typescript: true,
    });
  }

  async createPaymentIntent(data: {
    amount: number; // Amount in cents
    currency: string;
    paymentId: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: data.amount,
        currency: data.currency.toLowerCase(),
        description: data.description,
        metadata: {
          paymentId: data.paymentId,
          ...data.metadata,
        },
        // Enable automatic payment methods for web
        automatic_payment_methods: {
          enabled: true,
        },
        // Set confirmation method to manual for better control
        confirmation_method: 'manual',
        // Allow multiple capture attempts
        capture_method: 'automatic',
      });

      this.logger.log(`Payment intent created: ${paymentIntent.id}`, {
        paymentId: data.paymentId,
        amount: data.amount,
        currency: data.currency,
      });

      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to create payment intent: ${error.message}`, error.stack);
      throw error;
    }
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to retrieve payment intent ${paymentIntentId}: ${error.message}`);
      throw error;
    }
  }

  async confirmPaymentIntent(
    paymentIntentId: string,
    paymentMethodId?: string
  ): Promise<Stripe.PaymentIntent> {
    try {
      const updateData: Stripe.PaymentIntentUpdateParams = {};

      if (paymentMethodId) {
        updateData.payment_method = paymentMethodId;
      }

      const paymentIntent = await this.stripe.paymentIntents.confirm(
        paymentIntentId,
        updateData
      );

      this.logger.log(`Payment intent confirmed: ${paymentIntentId}`, {
        status: paymentIntent.status,
        amount: paymentIntent.amount,
      });

      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to confirm payment intent ${paymentIntentId}: ${error.message}`);
      throw error;
    }
  }

  async createRefund(data: {
    paymentIntentId: string;
    amount: number; // Amount in cents
    reason?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Refund> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: data.paymentIntentId,
        amount: data.amount,
        reason: this.mapRefundReason(data.reason),
        metadata: data.metadata,
      });

      this.logger.log(`Refund created: ${refund.id}`, {
        paymentIntentId: data.paymentIntentId,
        amount: data.amount,
        reason: data.reason,
      });

      return refund;
    } catch (error) {
      this.logger.error(`Failed to create refund for payment intent ${data.paymentIntentId}: ${error.message}`);
      throw error;
    }
  }

  async retrieveRefund(refundId: string): Promise<Stripe.Refund> {
    try {
      const refund = await this.stripe.refunds.retrieve(refundId);
      return refund;
    } catch (error) {
      this.logger.error(`Failed to retrieve refund ${refundId}: ${error.message}`);
      throw error;
    }
  }

  async listPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      return paymentMethods.data;
    } catch (error) {
      this.logger.error(`Failed to list payment methods for customer ${customerId}: ${error.message}`);
      throw error;
    }
  }

  async createCustomer(data: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.create({
        email: data.email,
        name: data.name,
        metadata: data.metadata,
      });

      this.logger.log(`Customer created: ${customer.id}`, {
        email: data.email,
        name: data.name,
      });

      return customer;
    } catch (error) {
      this.logger.error(`Failed to create customer: ${error.message}`);
      throw error;
    }
  }

  async retrieveCustomer(customerId: string): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      return customer as Stripe.Customer;
    } catch (error) {
      this.logger.error(`Failed to retrieve customer ${customerId}: ${error.message}`);
      throw error;
    }
  }

  async updateCustomer(
    customerId: string,
    data: {
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.update(customerId, data);
      return customer;
    } catch (error) {
      this.logger.error(`Failed to update customer ${customerId}: ${error.message}`);
      throw error;
    }
  }

  async createSetupIntent(data: {
    customerId?: string;
    paymentMethodTypes?: string[];
    metadata?: Record<string, string>;
  }): Promise<Stripe.SetupIntent> {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: data.customerId,
        payment_method_types: data.paymentMethodTypes || ['card'],
        metadata: data.metadata,
      });

      this.logger.log(`Setup intent created: ${setupIntent.id}`, {
        customerId: data.customerId,
      });

      return setupIntent;
    } catch (error) {
      this.logger.error(`Failed to create setup intent: ${error.message}`);
      throw error;
    }
  }

  async constructWebhookEvent(
    payload: Buffer,
    signature: string,
    webhookSecret: string
  ): Promise<Stripe.Event> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );

      this.logger.log(`Webhook event received: ${event.type}`, {
        eventId: event.id,
      });

      return event;
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw error;
    }
  }

  async getWebhookSecret(): Promise<string> {
    return this.configService.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  private mapRefundReason(reason?: string): Stripe.RefundCreateParams.Reason {
    switch (reason?.toLowerCase()) {
      case 'duplicate':
        return 'duplicate';
      case 'fraudulent':
        return 'fraudulent';
      case 'requested_by_customer':
        return 'requested_by_customer';
      default:
        return 'requested_by_customer';
    }
  }

  // Utility method to check if Stripe is properly configured
  isConfigured(): boolean {
    return !!this.stripe;
  }
}
