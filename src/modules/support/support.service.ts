import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupportTicket, FAQ, SupportTicketStatus, SupportTicketPriority, SupportTicketCategory, UserRole } from '@prisma/client';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { CreateFAQDto } from './dto/create-faq.dto';
import { UpdateFAQDto } from './dto/update-faq.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationWorkflowService } from '../notification/notification-workflow.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';

export interface SupportTicketWithDetails extends SupportTicket {
  user: {
    id: number;
    name: string;
    email: string;
  };
  assignee?: {
    id: number;
    name: string;
    email: string;
  };
}

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationWorkflow: NotificationWorkflowService,
    private logger: EnhancedLoggerService,
  ) {}

  // Support Ticket Methods
  async createTicket(createDto: CreateSupportTicketDto, userId: number): Promise<SupportTicket> {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: createDto.subject,
        description: createDto.description,
        category: createDto.category,
        priority: createDto.priority || SupportTicketPriority.MEDIUM,
        attachmentUrls: createDto.attachmentUrls || [],
        tags: createDto.tags || [],
      },
    });

    // Send notification to admins about new ticket
    await this.notificationWorkflow.sendNotificationToAdmins(
      'SYSTEM_ALERT' as any,
      'New Support Ticket',
      `New support ticket created: "${createDto.subject}" by user ${userId}`,
      { ticketId: ticket.id, priority: createDto.priority }
    );

    // Audit the ticket creation
    await this.auditService.auditApplicationAction(
      'TICKET_CREATED',
      ticket.id,
      userId.toString(),
      'SYSTEM',
      'HOST',
      {},
      { subject: createDto.subject, category: createDto.category },
      { ticketId: ticket.id }
    );

    this.logger.log(
      `Support ticket created: ${ticket.id}`,
      'SupportService',
      { ticketId: ticket.id, userId, subject: createDto.subject }
    );

    return ticket;
  }

  async getUserTickets(userId: number): Promise<SupportTicket[]> {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTicketById(ticketId: string, userId?: number, userRole?: UserRole): Promise<SupportTicketWithDetails> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    // Check permissions
    if (userRole !== UserRole.SUPER_ADMIN && userRole !== UserRole.ADMIN && ticket.userId !== userId) {
      throw new BadRequestException('Access denied');
    }

    return ticket as SupportTicketWithDetails;
  }

  async updateTicket(
    ticketId: string,
    updateDto: UpdateSupportTicketDto,
    userId: number,
    userRole: UserRole
  ): Promise<SupportTicket> {
    const ticket = await this.getTicketById(ticketId, userId, userRole);

    // Only admins can update certain fields
    if (userRole !== UserRole.ADMIN && userRole !== UserRole.SUPER_ADMIN) {
      // Users can only update description and add attachments
      const allowedFields = ['description', 'attachmentUrls', 'tags'];
      const requestedFields = Object.keys(updateDto);

      if (!requestedFields.every(field => allowedFields.includes(field))) {
        throw new BadRequestException('Users can only update description and attachments');
      }
    }

    const oldValues = {
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo,
    };

    const updatedTicket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: updateDto,
    });

    // Notify user if status changed
    if (updateDto.status && updateDto.status !== ticket.status) {
      await this.notificationWorkflow.notifyAdminMessage(
        ticket.userId,
        `Your support ticket "${ticket.subject}" status has been updated to ${updateDto.status}.`,
        'Support Team'
      );
    }

    // Audit the update
    await this.auditService.auditApplicationAction(
      'TICKET_UPDATED',
      ticketId,
      userId.toString(),
      'SYSTEM',
      userRole.toString(),
      oldValues,
      updateDto,
      { ticketId }
    );

    return updatedTicket;
  }

  async assignTicket(ticketId: string, assigneeId: number, adminId: number): Promise<SupportTicket> {
    const ticket = await this.getTicketById(ticketId, adminId, UserRole.ADMIN);

    const updatedTicket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        assignedTo: assigneeId,
        status: SupportTicketStatus.IN_PROGRESS,
      },
    });

    // Notify assignee
    await this.notificationWorkflow.notifyAdminMessage(
      assigneeId,
      `You have been assigned to support ticket: "${ticket.subject}"`,
      'Support System'
    );

    return updatedTicket;
  }

  async resolveTicket(ticketId: string, resolution: string, adminId: number): Promise<SupportTicket> {
    const ticket = await this.getTicketById(ticketId, adminId, UserRole.ADMIN);

    const updatedTicket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.RESOLVED,
        resolution,
        resolvedAt: new Date(),
      },
    });

    // Notify user
    await this.notificationWorkflow.notifyAdminMessage(
      ticket.userId,
      `Your support ticket "${ticket.subject}" has been resolved. ${resolution}`,
      'Support Team'
    );

    return updatedTicket;
  }

  async closeTicket(ticketId: string, userId: number, userRole: UserRole): Promise<SupportTicket> {
    const ticket = await this.getTicketById(ticketId, userId, userRole);

    const updatedTicket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.CLOSED,
        closedAt: new Date(),
      },
    });

    return updatedTicket;
  }

  // Admin methods
  async getAllTickets(filters?: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    category?: SupportTicketCategory;
    assignedTo?: number;
  }): Promise<SupportTicketWithDetails[]> {
    return this.prisma.supportTicket.findMany({
      where: filters,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<SupportTicketWithDetails[]>;
  }

  async getTicketStats(): Promise<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
    averageResolutionTime: number;
  }> {
    const [total, open, inProgress, resolved, closed] = await Promise.all([
      this.prisma.supportTicket.count(),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.OPEN } }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.IN_PROGRESS } }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.RESOLVED } }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.CLOSED } }),
    ]);

    // Calculate average resolution time for resolved tickets
    const resolvedTickets = await this.prisma.supportTicket.findMany({
      where: {
        status: SupportTicketStatus.RESOLVED,
        resolvedAt: { not: null },
        createdAt: { not: null },
      },
      select: { createdAt: true, resolvedAt: true },
    });

    const averageResolutionTime = resolvedTickets.length > 0
      ? resolvedTickets.reduce((sum, ticket) => {
          const created = new Date(ticket.createdAt);
          const resolved = new Date(ticket.resolvedAt!);
          return sum + (resolved.getTime() - created.getTime());
        }, 0) / resolvedTickets.length / (1000 * 60 * 60) // Convert to hours
      : 0;

    return {
      total,
      open,
      inProgress,
      resolved,
      closed,
      averageResolutionTime: Math.round(averageResolutionTime * 100) / 100,
    };
  }

  // FAQ Methods
  async createFAQ(createDto: CreateFAQDto): Promise<FAQ> {
    const faq = await this.prisma.fAQ.create({
      data: {
        question: createDto.question,
        answer: createDto.answer,
        category: createDto.category,
        tags: createDto.tags || [],
        isPublished: createDto.isPublished ?? true,
      },
    });

    this.logger.log(
      `FAQ created: ${faq.id}`,
      'SupportService',
      { faqId: faq.id, question: createDto.question }
    );

    return faq;
  }

  async getPublishedFAQs(search?: string, category?: string): Promise<FAQ[]> {
    const where: any = { isPublished: true };

    if (search) {
      where.OR = [
        { question: { contains: search, mode: 'insensitive' } },
        { answer: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search] } },
      ];
    }

    if (category) {
      where.category = category;
    }

    const faqs = await this.prisma.fAQ.findMany({
      where,
      orderBy: { viewCount: 'desc' },
    });

    // Increment view count asynchronously (don't wait)
    if (search && faqs.length > 0) {
      faqs.forEach(faq => {
        this.prisma.fAQ.update({
          where: { id: faq.id },
          data: { viewCount: { increment: 1 } },
        }).catch(err => this.logger.error(`Failed to increment view count for FAQ ${faq.id}`, err));
      });
    }

    return faqs;
  }

  async getAllFAQs(): Promise<FAQ[]> {
    return this.prisma.fAQ.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateFAQ(id: string, updateDto: UpdateFAQDto): Promise<FAQ> {
    const faq = await this.prisma.fAQ.update({
      where: { id },
      data: updateDto,
    });

    this.logger.log(
      `FAQ updated: ${id}`,
      'SupportService',
      { faqId: id, question: faq.question }
    );

    return faq;
  }

  async deleteFAQ(id: string): Promise<void> {
    await this.prisma.fAQ.delete({
      where: { id },
    });

    this.logger.log(
      `FAQ deleted: ${id}`,
      'SupportService',
      { faqId: id }
    );
  }

  async markFAQHelpful(id: string): Promise<FAQ> {
    const faq = await this.prisma.fAQ.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
    });

    return faq;
  }

  async getFAQCategories(): Promise<string[]> {
    const categories = await this.prisma.fAQ.findMany({
      where: { isPublished: true },
      select: { category: true },
      distinct: ['category'],
    });

    return categories.map(c => c.category);
  }
}
