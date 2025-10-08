import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Application,
  ApplicationStatus,
  ApplicationStep,
  Prisma,
  UserRole,
} from '@prisma/client';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { UpdateApplicationStepDto } from './dto/update-application-step.dto';
import { SubmitApplicationDto } from './dto/submit-application.dto';
import { PropertyDetailsDto } from './dto/property-details.dto';
import { ComplianceChecklistDto } from './dto/compliance-checklist.dto';
import { ApplicationValidationService } from './application-validation.service';
import { NotificationWorkflowService } from '../notification/notification-workflow.service';
import { NotificationService } from '../notification/notification.service';
import { ApiResponse, successResponse } from '@/common/helpers/response.helper';
import { PropertyTypesService } from '../propertyTypes/propertyTypes.service';
import { CertificationService } from '../certification/certification.service';

export interface ApplicationWithDetails extends Application {
  host: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string;
  };
  reviewer?: {
    id: number;
    name: string;
    email: string;
  } | null;
  documents: {
    id: string;
    documentType: string;
    fileName: string;
    uploadedAt: Date;
  }[];
  payments: {
    id: string;
    amount: number;
    status: string;
    createdAt: Date;
  }[];
  certification?: {
    id: string;
    certificateNumber: string;
    status: string;
    issuedAt: Date;
  } | null;
}

@Injectable()
export class ApplicationService {
  constructor(
    private prisma: PrismaService,
    private validationService: ApplicationValidationService,
    private notificationWorkflow: NotificationWorkflowService,
    private notificationService: NotificationService,
    private certificationService: CertificationService
  ) {}

  // for create application on 1st step
  async create(
    createApplicationDto: CreateApplicationDto,
    hostId: number
  ): Promise<ApiResponse<Application>> {
    try {
      const propertyType = createApplicationDto.propertyDetails?.propertyType;

      if (!propertyType) {
        console.error('Missing propertyType');
        throw new BadRequestException('Property type is required.');
      }

      const propertyTypeExists = await (
        this.prisma as any
      ).propertyType.findUnique({
        where: { id: propertyType },
      });

      if (!propertyTypeExists) {
        console.error(`Invalid propertyType: ${propertyType}`);
        throw new BadRequestException('Invalid property type selected.');
      }

      const existingApplication = await this.prisma.application.findFirst({
        where: {
          hostId,
          status: {
            in: [
              ApplicationStatus.DRAFT,
              ApplicationStatus.SUBMITTED,
              ApplicationStatus.UNDER_REVIEW,
            ],
          },
        },
      });

      // if (existingApplication) {
      //   console.error('Host already has an active application.');
      //   throw new BadRequestException(
      //     'You already have an active application. Please complete or cancel it before creating a new one.'
      //   );
      // }

      console.log('🛠 Creating new application...');
      const application = await this.prisma.application.create({
        data: {
          hostId,
          status: ApplicationStatus.DRAFT,
          currentStep: ApplicationStep.PROPERTY_DETAILS,
          propertyDetails: createApplicationDto.propertyDetails || {},
        },
      });

      // Notify host
      try {
        await this.notificationService.createNotification({
          userId: hostId,
          type: 'APPLICATION_STATUS' as any,
          title: 'Application Created Successfully',
          message:
            'Your rental certification application has been created successfully. Please complete all steps and submit your application.',
          data: {
            applicationId: application.id,
            status: 'DRAFT',
            step: 'PROPERTY_DETAILS',
          },
          priority: 'medium',
          sendPush: true,
        });
      } catch (notificationError) {
        console.error(
          'Failed to send host notification:',
          notificationError.message
        );
      }

      // Notify all super admins
      console.log('Notifying super admins...');
      const adminUsers = await this.prisma.user.findMany({
        where: { role: { in: ['SUPER_ADMIN'] } },
        select: { id: true },
      });

      console.log(`Found ${adminUsers.length} admin(s)`);

      for (const admin of adminUsers) {
        if (admin.id === hostId) continue;

        try {
          await this.notificationService.createNotification({
            userId: admin.id,
            type: 'APPLICATION_STATUS' as any,
            title: 'New Application Created',
            message: `A new rental application (ID: ${application.id}) has been created by Host ID: ${hostId}.`,
            data: {
              applicationId: application.id,
              status: 'DRAFT',
              step: 'PROPERTY_DETAILS',
              createdBy: hostId,
            },
            priority: 'high',
            sendPush: true,
          });
        } catch (adminNotifError) {
          console.error(
            `Failed to notify admin ${admin.id}:`,
            adminNotifError.message
          );
        }
      }

      return successResponse<Application>(
        'Application has been created successfully.',
        application
      );
    } catch (error) {
      console.error('Error creating application:', error);
      console.error('Stack Trace:', error.stack);

      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to create application');
    }
  }

  // for update to next step
  async updateStep(
    id: string,
    updateStepDto: UpdateApplicationStepDto,
    userId: number,
    userRole: UserRole
  ): Promise<Application> {
    console.log('[updateStep] called', {
      id,
      userId,
      userRole,
      step: updateStepDto?.step,
      hasData: Boolean(updateStepDto?.data),
      hasPropertyDetails: Boolean(updateStepDto?.data?.propertyDetails),
      hasChecklist: Boolean(updateStepDto?.data?.complianceChecklist),
      docsCount: updateStepDto?.data?.documents?.length || 0,
    });

    const application = await this.findOne(id, userId, userRole);
    console.log('[updateStep] current application', {
      id: application.id,
      status: application.status,
      currentStep: application.currentStep,
    });

    // Only hosts can update step progress
    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new ForbiddenException(
        'You can only update your own application steps'
      );
    }

    // Only allow step updates for draft applications
    if (application.status !== ApplicationStatus.DRAFT) {
      throw new BadRequestException(
        'Cannot update steps for submitted applications'
      );
    }

    console.log('[updateStep] validate step progression', {
      from: application.currentStep,
      to: updateStepDto.step,
    });
    this.validationService.validateStepProgression(
      application.currentStep,
      updateStepDto.step
    );

    // Validate step data if provided
    if (updateStepDto.data) {
      await this.validateStepData(updateStepDto.step, updateStepDto.data);
    }

    // Check if moving to next step and validate current step completion
    const nextStep = this.validationService.getNextStep(
      application.currentStep
    );
    if (nextStep === updateStepDto.step) {
      console.log(
        '[updateStep] validating completion of current step before moving',
        {
          currentStep: application.currentStep,
          nextStep,
        }
      );
      this.validationService.validateStepCompletion(application.currentStep, {
        propertyDetails: application.propertyDetails,
        id: application.id,
      });
    }

    // Prepare update payload
    const updateData: any = { currentStep: updateStepDto.step };

    // Handle property details update
    if (updateStepDto.data?.propertyDetails) {
      updateData.propertyDetails = updateStepDto.data.propertyDetails;
    }

    // Handle documents create
    if (updateStepDto.data?.documents) {
      const mapDocumentType = (raw: string): any => {
        switch (String(raw).toUpperCase()) {
          case 'ID_DOCUMENT':
            return 'ID_DOCUMENT';
          case 'INSURANCE_CERTIFICATE':
            return 'INSURANCE_CERTIFICATE';
          case 'PROPERTY_DEED':
          case 'PROPERTY_OWNERSHIP': // alias from client
            return 'PROPERTY_DEED';
          case 'SAFETY_PERMIT':
          case 'SAFETY_CERTIFICATE': // alias from client
            return 'SAFETY_PERMIT';
          default:
            return 'OTHER';
        }
      };

      const mappedDocs = updateStepDto.data.documents.map(doc => ({
        fileName: doc.fileName,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size ?? 0,
        url: doc.url,
        documentType: mapDocumentType(doc.documentType),
      }));

      console.log(
        '[updateStep] documents mapped',
        mappedDocs.map(d => ({
          fileName: d.fileName,
          documentType: d.documentType,
          size: d.size,
        }))
      );

      updateData.documents = {
        create: mappedDocs,
      };
    }

    // If moving to SUBMISSION
    if (updateStepDto.step === ApplicationStep.SUBMISSION) {
      updateData.status = ApplicationStatus.SUBMITTED;
      updateData.submittedAt = new Date();
    }

    console.log('[updateStep] update payload prepared', {
      currentStep: updateData.currentStep,
      hasPropertyDetails: Boolean(updateData.propertyDetails),
      willCreateDocs: Boolean(updateData.documents?.create?.length),
    });

    let updated: Application;
    try {
      updated = await this.prisma.application.update({
        where: { id },
        data: updateData,
        include: { documents: true },
      });
    } catch (e: any) {
      console.error('[updateStep] prisma update failed', {
        message: e?.message,
        code: e?.code,
        name: e?.name,
        meta: e?.meta,
      });
      throw e;
    }

    // ✅ Persist compliance checklist when moving TO COMPLIANCE_CHECKLIST step
    if (
      updateStepDto.step === ApplicationStep.COMPLIANCE_CHECKLIST &&
      updateStepDto.data?.complianceChecklist &&
      updateStepDto.data?.propertyDetails?.propertyType
    ) {
      await this.validationService.validateComplianceChecklist(
        updateStepDto.data.complianceChecklist,
        updateStepDto.data.propertyDetails.propertyType,
        id
      );

      const checklistItems = await this.prisma.checklist.findMany({
        where: {
          propertyTypeId: updateStepDto.data.propertyDetails.propertyType,
        },
        select: { id: true, name: true },
      });

      const checklistByName = new Map(
        checklistItems.map(item => [item.name, item.id])
      );

      const complianceRecords = Object.entries(
        updateStepDto.data.complianceChecklist
      )
        .filter(([_, checked]) => checked === true)
        .map(([name]) => {
          const checklistId = checklistByName.get(name);
          if (!checklistId) {
            throw new BadRequestException(`Invalid checklist item: ${name}`);
          }
          return {
            applicationId: id,
            checklistId,
            checked: true,
            checkedAt: new Date(),
          };
        });

      // 🧹 Delete existing compliance checklist records first
      await this.prisma.complianceChecklist.deleteMany({
        where: { applicationId: id },
      });
      console.log('[updateStep] Existing compliance checklist deleted');

      // ✅ Insert new compliance checklist records
      if (complianceRecords.length > 0) {
        await this.prisma.complianceChecklist.createMany({
          data: complianceRecords,
        });
        console.log('[updateStep] New compliance checklist inserted', {
          count: complianceRecords.length,
        });
      } else {
        console.log('[updateStep] No compliance checklist items selected');
      }
    }

    return updated;
  }

  // for submission on last step
  async submit(
    id: string,
    submitDto: SubmitApplicationDto,
    userId: number
  ): Promise<ApiResponse<Application>> {
    try {
      const application = await this.findOne(id, userId, UserRole.HOST);

      if (application.hostId !== userId) {
        throw new ForbiddenException(
          'You can only submit your own applications'
        );
      }

      if (application.status !== ApplicationStatus.DRAFT) {
        throw new BadRequestException('Application is not in draft status');
      }

      // // Validate all steps before submission
      // await this.validationService.validateStepCompletion(
      //   ApplicationStep.SUBMISSION,
      //   {
      //     propertyDetails: application.propertyDetails,
      //     id: application.id,
      //   }
      // );

      const updatedApplication = await this.prisma.application.update({
        where: { id },
        data: {
          status: ApplicationStatus.SUBMITTED,
          submittedAt: new Date(),
          currentStep: ApplicationStep.SUBMISSION,
        },
        include: {
          documents: true,
        },
      });

      // Send notification to host
      try {
        await this.notificationService.createNotification({
          userId: userId,
          type: 'APPLICATION_STATUS' as any,
          title: 'Application Submitted Successfully',
          message: `Your rental certification application has been submitted successfully. Please wait for further review and approval.`,
          data: {
            applicationId: application.id,
            status: 'SUBMITTED',
          },
          priority: 'high',
          sendPush: true,
        });
      } catch (notificationError) {
        console.error(
          'Failed to send application submission notification:',
          notificationError
        );
      }

      // Find all admins and super admins
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: {
            in: ['SUPER_ADMIN'],
          },
        },
        select: { id: true },
      });

      // Send notification to each admin/super admin
      for (const admin of adminUsers) {
        if (admin.id === userId) continue;

        try {
          await this.notificationService.createNotification({
            userId: admin.id,
            type: 'APPLICATION_STATUS' as any,
            title: 'New Application Submitted',
            message: `A rental application (ID: ${application.id}) has been submitted by Host (ID: ${userId}). Please review and assign it for further processing.`,
            data: {
              applicationId: application.id,
              status: 'SUBMITTED',
              hostId: userId,
            },
            priority: 'high',
            sendPush: true,
          });
        } catch (notificationError) {
          console.error(
            `Failed to send notification to admin ${admin.id}:`,
            notificationError
          );
        }
      }

      return successResponse<Application>(
        'Application has been submitted successfully.',
        updatedApplication
      );
    } catch (error) {
      console.error('Error submitting application:', error.message);

      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(error.message);
      }

      throw new InternalServerErrorException('Failed to submit application');
    }
  }

  async update(
    id: string,
    updateApplicationDto: UpdateApplicationDto,
    userId: number,
    userRole: UserRole
  ): Promise<Application> {
    const application = await this.findOne(id, userId, userRole);

    // Only hosts can update their draft applications
    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new ForbiddenException('You can only update your own applications');
    }

    // Only admins can update applications in review
    if (
      application.status !== ApplicationStatus.DRAFT &&
      userRole !== UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Only administrators can update submitted applications'
      );
    }

    // If propertyDetails include propertyType, validate it exists
    const maybepropertyType = updateApplicationDto.propertyDetails
      ?.propertyType as any;
    if (maybepropertyType) {
      const propertyType = await (this.prisma as any).propertyType.findUnique({
        where: { id: maybepropertyType },
      });
      if (!propertyType) {
        throw new BadRequestException('Invalid property type selected.');
      }
    }

    // If complianceChecklist provided, validate against checklist table using validation service
    if (updateApplicationDto.complianceChecklist) {
      const propertyType =
        (updateApplicationDto.propertyDetails?.propertyType as any) ||
        (application.propertyDetails as any)?.propertyType;
      await this.validationService.validateComplianceChecklist(
        updateApplicationDto.complianceChecklist,
        propertyType,
        id
      );
    }

    // Normalize document types if present
    const mappedDocuments = updateApplicationDto.documents
      ? updateApplicationDto.documents.map(d => {
          const raw = String(d.documentType).toUpperCase();
          const map = (val: string): any => {
            switch (val) {
              case 'ID_DOCUMENT':
                return 'ID_DOCUMENT';
              case 'INSURANCE_CERTIFICATE':
                return 'INSURANCE_CERTIFICATE';
              case 'PROPERTY_DEED':
              case 'PROPERTY_OWNERSHIP':
                return 'PROPERTY_DEED';
              case 'SAFETY_PERMIT':
              case 'SAFETY_CERTIFICATE':
                return 'SAFETY_PERMIT';
              default:
                return 'OTHER';
            }
          };
          return {
            fileName: d.fileName,
            originalName: d.originalName,
            mimeType: d.mimeType,
            url: d.url,
            size: d.size ?? 0,
            documentType: map(raw),
          };
        })
      : undefined;

    return this.prisma.application.update({
      where: { id },
      data: {
        ...updateApplicationDto,
        documents: mappedDocuments ? { create: mappedDocuments } : undefined,
      },
      include: {
        documents: true,
      },
    });
  }

  // get all api

  async findAll(options: {
    status?: ApplicationStatus;
    reviewerId?: number;
    hostId?: number;
    skip?: number;
    take?: number;
    orderBy?: any;
  }): Promise<{ applications: ApplicationWithDetails[]; total: number }> {
    const {
      status,
      reviewerId,
      hostId,
      skip = 0,
      take = 10,
      orderBy = { createdAt: 'desc' },
    } = options;

    const where: any = {};
    if (status) where.status = status;
    if (reviewerId) where.reviewedBy = reviewerId;
    if (hostId) where.hostId = hostId;

    const [applications, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
          host: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              email: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          documents: {
            select: {
              id: true,
              documentType: true,
              fileName: true,
              uploadedAt: true,
            },
          },
          payments: {
            select: {
              id: true,
              amount: true,
              status: true,
              createdAt: true,
            },
          },
          certification: {
            select: {
              id: true,
              certificateNumber: true,
              status: true,
              issuedAt: true,
            },
          },
        },
        skip,
        take,
        orderBy,
      }),
      this.prisma.application.count({ where }),
    ]);

    // Transform Decimal values to numbers
    const transformedApplications = applications.map(app => ({
      ...app,
      payments:
        app.payments?.map(payment => ({
          ...payment,
          amount: Number(payment.amount),
        })) || [],
    }));

    return {
      applications: transformedApplications as ApplicationWithDetails[],
      total,
    };
  }

  // get application with id

  async findOne(
    id: string,
    userId?: number,
    userRole?: UserRole
  ): Promise<ApplicationWithDetails> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        host: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
          },
        },
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        documents: {
          select: {
            id: true,
            documentType: true,
            fileName: true,
            uploadedAt: true,
          },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
          },
        },
        certification: {
          select: {
            id: true,
            certificateNumber: true,
            status: true,
            issuedAt: true,
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // Check permissions
    if (userId && userRole !== UserRole.SUPER_ADMIN) {
      if (userRole === UserRole.ADMIN && application.reviewedBy !== userId) {
        throw new ForbiddenException(
          'You can only access applications assigned to you'
        );
      }
      if (userRole === UserRole.HOST && application.hostId !== userId) {
        throw new ForbiddenException(
          'You can only access your own applications'
        );
      }
    }

    // Transform Decimal values to numbers
    const transformedApplication = {
      ...application,
      payments:
        application.payments?.map(payment => ({
          ...payment,
          amount: Number(payment.amount),
        })) || [],
    };

    return transformedApplication as ApplicationWithDetails;
  }

  // just for validation

  private async validateStepData(
    step: ApplicationStep,
    data: any
  ): Promise<void> {
    switch (step) {
      case ApplicationStep.PROPERTY_DETAILS:
        if (data.propertyDetails) {
          this.validationService.validatePropertyDetails(data.propertyDetails);
        }
        break;

      case ApplicationStep.COMPLIANCE_CHECKLIST:
        if (data.complianceChecklist) {
          const propertyType = data.propertyDetails?.propertyType;
          if (!propertyType) {
            throw new BadRequestException(
              'Property type is required to validate checklist'
            );
          }
          await this.validationService.validateComplianceChecklist(
            data.complianceChecklist,
            propertyType
          );
        }
        break;

      // Document upload and payment validation will be added later
      case ApplicationStep.DOCUMENT_UPLOAD:
      case ApplicationStep.PAYMENT:
      case ApplicationStep.SUBMISSION:
        break;
    }
  }

  // get whole application progress about specific step
  getStepInfo(step: ApplicationStep) {
    return {
      step,
      title: this.getStepTitle(step),
      description: this.getStepDescription(step),
      requirements: this.validationService.getStepRequirements(step),
      progress: this.validationService.calculateProgress(step),
    };
  }

  // get specific application progress

  getApplicationProgress(
    id: string,
    userId: number,
    userRole: UserRole
  ): Promise<{
    currentStep: ApplicationStep;
    progress: number;
    completedSteps: ApplicationStep[];
    nextStep?: ApplicationStep;
    requirements: string[];
  }> {
    return this.findOne(id, userId, userRole).then(application => {
      const completedSteps = this.getCompletedSteps(application);
      const nextStep = this.validationService.getNextStep(
        application.currentStep
      );

      return {
        currentStep: application.currentStep,
        progress: this.validationService.calculateProgress(
          application.currentStep
        ),
        completedSteps,
        nextStep,
        requirements: this.validationService.getStepRequirements(
          application.currentStep
        ),
      };
    });
  }

  private getCompletedSteps(
    application: ApplicationWithDetails
  ): ApplicationStep[] {
    const completedSteps: ApplicationStep[] = [];
    const stepOrder = [
      ApplicationStep.PROPERTY_DETAILS,
      ApplicationStep.COMPLIANCE_CHECKLIST,
      ApplicationStep.DOCUMENT_UPLOAD,
      ApplicationStep.PAYMENT,
    ];

    for (const step of stepOrder) {
      try {
        this.validationService.validateStepCompletion(step, {
          propertyDetails: application.propertyDetails,
          id: (application as any).id,
        });
        completedSteps.push(step);
      } catch {
        break; // Stop at first incomplete step
      }
    }

    return completedSteps;
  }

  private getStepTitle(step: ApplicationStep): string {
    switch (step) {
      case ApplicationStep.PROPERTY_DETAILS:
        return 'Property Details';
      case ApplicationStep.COMPLIANCE_CHECKLIST:
        return 'Compliance Checklist';
      case ApplicationStep.DOCUMENT_UPLOAD:
        return 'Document Upload';
      case ApplicationStep.PAYMENT:
        return 'Payment';
      case ApplicationStep.SUBMISSION:
        return 'Submission';
      default:
        return 'Unknown Step';
    }
  }

  private getStepDescription(step: ApplicationStep): string {
    switch (step) {
      case ApplicationStep.PROPERTY_DETAILS:
        return 'Provide detailed information about your property including location, amenities, and basic specifications.';
      case ApplicationStep.COMPLIANCE_CHECKLIST:
        return 'Confirm that your property meets all safety, legal, and quality standards required for certification.';
      case ApplicationStep.DOCUMENT_UPLOAD:
        return 'Upload required documents including identification, licenses, insurance, and property documentation.';
      case ApplicationStep.PAYMENT:
        return 'Complete the certification fee payment to proceed with your application.';
      case ApplicationStep.SUBMISSION:
        return 'Review your application and submit it for review by our certification team.';
      default:
        return 'Complete this step to continue with your certification application.';
    }
  }

  async delete(id: string, userId: number, userRole: UserRole): Promise<any> {
    try {
      const application = await this.findOne(id, userId, userRole);

      // Only hosts can delete their draft applications
      if (userRole === UserRole.HOST && application.hostId !== userId) {
        throw new ForbiddenException(
          'You can only delete your own applications'
        );
      }

      // Only admins can delete submitted applications
      if (
        application.status !== ApplicationStatus.DRAFT &&
        userRole !== UserRole.ADMIN
      ) {
        throw new ForbiddenException(
          'Only administrators can delete submitted applications'
        );
      }

      // ✅ Soft delete (await properly)
      const deletedApplication = await this.prisma.application.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      // 🔔 Notifications
      try {
        // ✅ Notify the admin who deleted
        await this.notificationService.createNotification({
          userId, // admin who performed the delete
          type: 'APPLICATION_STATUS' as any,
          title: 'Application Deleted',
          message: `You have successfully deleted application (ID: ${deletedApplication.id}).`,
          data: {
            applicationId: deletedApplication.id,
            status: 'DELETED',
          },
          priority: 'high',
          sendPush: true,
        });

        // ✅ Notify the host whose application was deleted
        if (userRole === UserRole.ADMIN && deletedApplication.hostId) {
          await this.notificationService.createNotification({
            userId: deletedApplication.hostId, // hostId is number ✅
            type: 'APPLICATION_STATUS' as any,
            title: 'Application Deleted by Admin',
            message: `Your rental certification application (ID: ${deletedApplication.id}) has been deleted by an administrator.`,
            data: {
              applicationId: deletedApplication.id,
              status: 'DELETED',
            },
            priority: 'high',
            sendPush: true,
          });
        }
      } catch (notificationError) {
        console.error(
          `Failed to send delete notifications for application ${deletedApplication.id}:`,
          notificationError
        );
      }

      return {
        status: 'success',
        message: 'Application has been deleted successfully.',
      };
    } catch (error) {
      console.error('Error deleting application:', error.message);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException({
          success: false,
          error: {
            code: 'FOREIGN_KEY_CONSTRAINT_VIOLATION',
            message:
              'This application cannot be deleted because it has related records (e.g., documents). Please remove them first.',
            details: error.meta,
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.meta,
            timestamp: new Date().toISOString(),
          },
        });
      }

      throw new InternalServerErrorException({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete application',
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  async assignReviewer(
    id: string,
    reviewerId: number,
    adminId: number
  ): Promise<Application> {
    // SUPER_ADMIN can assign any reviewer without being the current reviewer
    // We still reuse findOne for existence and include data, but pass SUPER_ADMIN to bypass admin-only checks
    const application = await this.findOne(id, adminId, UserRole.SUPER_ADMIN);

    return this.prisma.application.update({
      where: { id },
      data: {
        reviewedBy: reviewerId,
        status: ApplicationStatus.UNDER_REVIEW,
      },
    });
  }

  async approve(
    id: string,
    reviewNotes: string,
    adminId: number
  ): Promise<ApiResponse<Application>> {
    const application = await this.findOne(id, adminId, UserRole.ADMIN);

    if (application.status !== ApplicationStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        'Application must be under review to approve'
      );
    }

    const updatedApplication = await this.prisma.application.update({
      where: { id },
      data: {
        status: ApplicationStatus.APPROVED,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    // ✅ Centralized notification workflow
    await this.notificationWorkflow.notifyApplicationStatusChange(
      id,
      application.hostId,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.APPROVED,
      application.reviewer?.name,
      reviewNotes
    );

    // 🔄 Auto-generate certification from Super Admin template
    try {
      await this.certificationService.generateCertification(id, adminId);
    } catch (err) {
      console.error('[approve] auto-certification failed', err?.message);
    }

    return successResponse<Application>(
      'Application has been approved successfully.',
      updatedApplication
    );
  }

  async reject(id: string, reviewNotes: string, adminId: number): Promise<any> {
    const application = await this.findOne(id, adminId, UserRole.ADMIN);

    if (application.status !== ApplicationStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        'Application must be under review to reject'
      );
    }

    const updatedApplication = await this.prisma.application.update({
      where: { id },
      data: {
        status: ApplicationStatus.REJECTED,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    // Trigger workflow
    await this.notificationWorkflow.notifyApplicationStatusChange(
      id,
      application.hostId,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.REJECTED,
      application.reviewer?.name,
      reviewNotes
    );

    // ✅ Consistent response format
    return {
      status: 'success',
      message: 'Application rejected successfully',
      data: updatedApplication,
    };
  }

  async requestMoreInfo(
    id: string,
    reviewNotes: string,
    adminId: number
  ): Promise<Application> {
    const application = await this.findOne(id, adminId, UserRole.ADMIN);

    const updatedApplication = await this.prisma.application.update({
      where: { id },
      data: {
        status: ApplicationStatus.MORE_INFO_REQUESTED,
        reviewNotes,
      },
    });

    // Trigger notification workflow
    await this.notificationWorkflow.notifyApplicationStatusChange(
      id,
      application.hostId,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.MORE_INFO_REQUESTED,
      application.reviewer?.name,
      reviewNotes
    );

    return updatedApplication;
  }
}
