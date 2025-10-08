import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationService } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { UpdateApplicationStepDto } from './dto/update-application-step.dto';
import { SubmitApplicationDto } from './dto/submit-application.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole, ApplicationStep } from '@prisma/client';
import { FindAllApplicationsDto } from './dto/FindAllApplicationsDto';

// image upload moved to S3Controller

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationController {
  constructor(
    private readonly applicationService: ApplicationService
  ) {}

  // create new application

  @Post()
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createApplicationDto: CreateApplicationDto,
    @CurrentUser() user: any
  ) {
    return this.applicationService.create(createApplicationDto, user.id);
  }

  // get all applications

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: FindAllApplicationsDto) {
    const options: any = { ...query };

    if (!query.status) delete options.status; // only apply if present

    if (user.role === UserRole.HOST) {
      options.hostId = user.id;
    } else if (user.role === UserRole.ADMIN) {
      options.reviewerId = user.id;
    }

    return this.applicationService.findAll(options);
  }

  // get specific application detail

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.applicationService.findOne(id, user.id, user.role);
  }

  // update application

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body() updateApplicationDto: UpdateApplicationDto,
    @CurrentUser() user: any
  ) {
    return this.applicationService.update(
      id,
      updateApplicationDto,
      user.id,
      user.role
    );
  }

  // check specific step

  @Put(':id/step')
  @HttpCode(HttpStatus.OK)
  updateStep(
    @Param('id') id: string,
    @Body() updateStepDto: UpdateApplicationStepDto,
    @CurrentUser() user: any
  ) {
    return this.applicationService.updateStep(
      id,
      updateStepDto,
      user.id,
      user.role
    );
  }

  // for submit application by host

  @Post(':id/submit')
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @Body() submitDto: SubmitApplicationDto,
    @CurrentUser() user: any
  ) {
    return this.applicationService.submit(id, submitDto, user.id);
  }

  // delete application for admin or super admin

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.applicationService.delete(id, user.id, user.role);
  }

  @Post(':id/assign-reviewer')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  assignReviewer(
    @Param('id') id: string,
    @Body('reviewerId', ParseIntPipe) reviewerId: number,
    @CurrentUser() user: any
  ) {
    return this.applicationService.assignReviewer(id, reviewerId, user.id);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id') id: string,
    @Body('reviewNotes') reviewNotes: string,
    @CurrentUser() user: any
  ) {
    return this.applicationService.approve(id, reviewNotes, user.id);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body('reviewNotes') reviewNotes: string,
    @CurrentUser() user: any
  ) {
    return this.applicationService.reject(id, reviewNotes, user.id);
  }

  @Post(':id/request-more-info')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  requestMoreInfo(
    @Param('id') id: string,
    @Body('reviewNotes') reviewNotes: string,
    @CurrentUser() user: any
  ) {
    return this.applicationService.requestMoreInfo(id, reviewNotes, user.id);
  }

  // Step management endpoints
  @Get(':id/progress')
  @HttpCode(HttpStatus.OK)
  getProgress(@Param('id') id: string, @CurrentUser() user: any) {
    return this.applicationService.getApplicationProgress(
      id,
      user.id,
      user.role
    );
  }

  @Get('steps/:step')
  @HttpCode(HttpStatus.OK)
  getStepInfo(@Param('step') step: string) {
    const stepEnum = step as keyof typeof ApplicationStep;
    return this.applicationService.getStepInfo(ApplicationStep[stepEnum]);
  }

  // image routes moved to S3Controller
}
