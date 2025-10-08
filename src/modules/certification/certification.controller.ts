import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { CertificationService } from './certification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CertificationStatus, UserRole } from '@prisma/client';

@Controller('certifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificationController {
  constructor(private readonly certificationService: CertificationService) {}

  // Admin api
  // generate certificate
  @Post('generate/:applicationId')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  generateCertification(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: any
  ) {
    return this.certificationService.generateCertification(
      applicationId,
      user.id
    );
  }

  // Super Admin Template APIs
  @Post('templates')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createTemplate(
    @Body() body: {
      propertyTypeId: string;
      name: string;
      description?: string;
      imageUrl?: string;
      validityMonths?: number;
      isActive?: boolean;
    },
    @CurrentUser() user: any
  ) {
    return this.certificationService.createTemplate(body, user.id);
  }

  @Put('templates/:id')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  updateTemplate(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      imageUrl?: string;
      validityMonths?: number;
      isActive?: boolean;
    }
  ) {
    return this.certificationService.updateTemplate(id, body);
  }

  @Post('templates/:id/activate')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  activateTemplate(@Param('id') id: string) {
    return this.certificationService.activateTemplate(id);
  }

  @Get('templates')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  listTemplates(@Query('propertyTypeId') propertyTypeId?: string) {
    return this.certificationService.listTemplates({ propertyTypeId });
  }

  @Get('verify/:qrCodeData')
  async verifyCertification(@Param('qrCodeData') qrCodeData: string) {
    const certification =
      await this.certificationService.verifyCertification(qrCodeData);

    if (!certification) {
      throw new NotFoundException('Invalid or expired certification QR code');
    }

    return certification;
  }

  // get certificate based on status
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(
    @CurrentUser() user: any,
    @Query('status') status?: CertificationStatus,
    @Query('skip') skip?: string, // keep raw string from query
    @Query('take') take?: string
  ) {
    const options: any = {};

    // Apply status filter only if provided
    if (status) {
      options.status = status;
    }

    // Pagination defaults: skip=0, take=undefined (fetch all)
    options.skip = skip ? parseInt(skip, 10) : 0;
    options.take = take ? parseInt(take, 10) : undefined;

    // Filter based on user role
    if (user.role === UserRole.HOST) {
      options.hostId = user.id;
    }

    return this.certificationService.findAll(options);
  }

  // get certificate stats

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  getStats() {
    return this.certificationService.getCertificationStats();
  }

  // get certificate by id
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    console.log(`certificate id ${id}`);
    return this.certificationService.findOne(id, user.id, user.role);
  }

  // get certificate detail

  @Get('certificate/:certificateNumber')
  @HttpCode(HttpStatus.OK)
  findByCertificateNumber(
    @Param('certificateNumber') certificateNumber: string
  ) {
    return this.certificationService.findByCertificateNumber(certificateNumber);
  }

  // Admin-only endpoints
  @Post(':id/revoke')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  revokeCertification(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: any
  ) {
    return this.certificationService.revokeCertification(
      id,
      reason,
      user.id,
      user.email
    );
  }

  @Post(':id/renew')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  renewCertification(@Param('id') id: string, @CurrentUser() user: any) {
    return this.certificationService.renewCertification(id, user.id);
  }

  @Get('admin/expiry-check')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  checkExpiryStatus() {
    return this.certificationService.checkExpiryStatus();
  }
}
