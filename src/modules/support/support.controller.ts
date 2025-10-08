import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { CreateFAQDto } from './dto/create-faq.dto';
import { UpdateFAQDto } from './dto/update-faq.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole, SupportTicketStatus } from '@prisma/client';

@Controller('support')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // Public FAQ endpoints (no auth required for reading)
  @Get('faq')
  @HttpCode(HttpStatus.OK)
  getPublishedFAQs(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.supportService.getPublishedFAQs(search, category);
  }

  @Get('faq/categories')
  @HttpCode(HttpStatus.OK)
  getFAQCategories() {
    return this.supportService.getFAQCategories();
  }

  @Put('faq/:id/helpful')
  @HttpCode(HttpStatus.OK)
  markFAQHelpful(@Param('id') id: string) {
    return this.supportService.markFAQHelpful(id);
  }

  // User ticket endpoints
  @Get('tickets')
  @HttpCode(HttpStatus.OK)
  getUserTickets(@CurrentUser() user: any) {
    return this.supportService.getUserTickets(user.id);
  }

  @Get('tickets/:id')
  @HttpCode(HttpStatus.OK)
  getTicketById(
    @Param('id') ticketId: string,
    @CurrentUser() user: any
  ) {
    return this.supportService.getTicketById(ticketId, user.id, user.role);
  }

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  createTicket(
    @Body(ValidationPipe) createDto: CreateSupportTicketDto,
    @CurrentUser() user: any
  ) {
    return this.supportService.createTicket(createDto, user.id);
  }

  @Put('tickets/:id')
  @HttpCode(HttpStatus.OK)
  updateTicket(
    @Param('id') ticketId: string,
    @Body(ValidationPipe) updateDto: UpdateSupportTicketDto,
    @CurrentUser() user: any
  ) {
    return this.supportService.updateTicket(ticketId, updateDto, user.id, user.role);
  }

  @Put('tickets/:id/close')
  @HttpCode(HttpStatus.OK)
  closeTicket(
    @Param('id') ticketId: string,
    @CurrentUser() user: any
  ) {
    return this.supportService.closeTicket(ticketId, user.id, user.role);
  }

  // Admin ticket management endpoints
  @Get('admin/tickets')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getAllTickets(
    @Query('status') status?: SupportTicketStatus,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.supportService.getAllTickets({
      status: status as any,
      priority: priority as any,
      category: category as any,
      assignedTo: assignedTo ? parseInt(assignedTo) : undefined,
    });
  }

  @Get('admin/stats')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getTicketStats() {
    return this.supportService.getTicketStats();
  }

  @Put('admin/tickets/:id/assign')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  assignTicket(
    @Param('id') ticketId: string,
    @Body('assigneeId') assigneeId: number,
    @CurrentUser() user: any
  ) {
    return this.supportService.assignTicket(ticketId, assigneeId, user.id);
  }

  @Put('admin/tickets/:id/resolve')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  resolveTicket(
    @Param('id') ticketId: string,
    @Body('resolution') resolution: string,
    @CurrentUser() user: any
  ) {
    return this.supportService.resolveTicket(ticketId, resolution, user.id);
  }

  // FAQ management endpoints (Admin only)
  @Post('admin/faq')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createFAQ(@Body(ValidationPipe) createDto: CreateFAQDto) {
    return this.supportService.createFAQ(createDto);
  }

  @Get('admin/faq')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getAllFAQs() {
    return this.supportService.getAllFAQs();
  }

  @Put('admin/faq/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  updateFAQ(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateFAQDto
  ) {
    return this.supportService.updateFAQ(id, updateDto);
  }

  @Delete('admin/faq/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFAQ(@Param('id') id: string) {
    return this.supportService.deleteFAQ(id);
  }
}
