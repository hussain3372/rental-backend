import { Injectable, BadRequestException } from '@nestjs/common';
import { ApplicationStep } from '@prisma/client';
import { PropertyDetailsDto } from './dto/property-details.dto';
import { ComplianceChecklistDto } from './dto/compliance-checklist.dto';
import { DocumentService } from '../document/document.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApplicationValidationService {
  constructor(
    private documentService: DocumentService,
    private prisma: PrismaService
  ) {}

  validatePropertyDetails(data: any): PropertyDetailsDto {
    const dto = new PropertyDetailsDto();
    Object.assign(dto, data);

    // Required fields validation
    if (!dto.propertyName?.trim()) {
      throw new BadRequestException('Property name is required');
    }

    if (!dto.address?.trim()) {
      throw new BadRequestException('Property address is required');
    }

    if (!dto.propertyType) {
      throw new BadRequestException('Property type is required');
    }

    if (!dto.bedrooms || dto.bedrooms < 0) {
      throw new BadRequestException('Valid number of bedrooms is required');
    }

    if (!dto.bathrooms || dto.bathrooms < 0) {
      throw new BadRequestException('Valid number of bathrooms is required');
    }

    if (!dto.maxGuests || dto.maxGuests < 1) {
      throw new BadRequestException(
        'Maximum number of guests must be at least 1'
      );
    }

    return dto;
  }

  async validateComplianceChecklist(data: any, propertyTypeId: string, applicationId?: string): Promise<void> {
    if (!propertyTypeId) {
      throw new BadRequestException('Property type is required for checklist validation');
    }

    const propertyType = await (this.prisma as any).propertyType.findUnique({ where: { id: propertyTypeId } });
    if (!propertyType) {
      throw new BadRequestException('Invalid property type selected');
    }

    const items = await (this.prisma as any).checklist.findMany({
      where: { propertyTypeId },
      select: { id: true, name: true },
    });

    if (!items.length) {
      throw new BadRequestException('No checklist items configured for this property type');
    }

    // Accept multiple input shapes from the client
    const checkedById: Record<string, boolean> = {};
    const checkedByName: Record<string, boolean> = {};

    if (Array.isArray(data?.items)) {
      for (const entry of data.items) {
        if (entry?.id) checkedById[String(entry.id)] = Boolean(entry.checked ?? entry.value ?? entry.status === true);
        if (entry?.name) checkedByName[String(entry.name)] = Boolean(entry.checked ?? entry.value ?? entry.status === true);
      }
    }

    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (key === 'items') continue;
        if (typeof value === 'boolean') {
          // Could be either id or name as key
          checkedById[key] = checkedById[key] || value;
          checkedByName[key] = checkedByName[key] || value;
        }
      }
    }

    const missing: string[] = [];
    const matchedIds: string[] = [];
    for (const item of items) {
      const ok = checkedById[item.id] || checkedByName[item.name];
      if (!ok) missing.push(item.name);
      else matchedIds.push(item.id);
    }

    if (missing.length) {
      throw new BadRequestException(
        `Checklist incomplete. Missing confirmations for: ${missing.join(', ')}`
      );
    }

    // Optionally persist to DB if applicationId provided
    if (applicationId) {
      const existing = await (this.prisma as any).complianceChecklist.findMany({
        where: { applicationId },
        select: { checklistId: true },
      });
      const existingSet = new Set(existing.map((e: any) => e.checklistId));
      const toCreate = matchedIds.filter(id => !existingSet.has(id));

      if (toCreate.length) {
        await (this.prisma as any).complianceChecklist.createMany({
          data: toCreate.map(id => ({
            applicationId,
            checklistId: id,
            checked: true,
            checkedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }

      // Update any existing to checked
      for (const id of matchedIds) {
        await (this.prisma as any).complianceChecklist.upsert({
          where: { applicationId_checklistId: { applicationId, checklistId: id } },
          create: { applicationId, checklistId: id, checked: true, checkedAt: new Date() },
          update: { checked: true, checkedAt: new Date() },
        });
      }
    }
  }

  validateStepProgression(
    currentStep: ApplicationStep,
    newStep: ApplicationStep
  ): void {
    const stepOrder = [
      ApplicationStep.PROPERTY_DETAILS,
      ApplicationStep.COMPLIANCE_CHECKLIST,
      ApplicationStep.DOCUMENT_UPLOAD,
      ApplicationStep.PAYMENT,
      ApplicationStep.SUBMISSION,
    ];

    const currentIndex = stepOrder.indexOf(currentStep);
    const newIndex = stepOrder.indexOf(newStep);

    if (newIndex < currentIndex) {
      // Allow going back to previous steps for editing
      return;
    }

    // Allow jumping from DOCUMENT_UPLOAD directly to SUBMISSION
    if (
      currentStep === ApplicationStep.DOCUMENT_UPLOAD &&
      newStep === ApplicationStep.SUBMISSION
    ) {
      return;
    }

    if (newIndex > currentIndex + 1) {
      throw new BadRequestException(
        'Cannot skip steps. Please complete the current step first.'
      );
    }
  }

  async validateStepCompletion(
    step: ApplicationStep,
    applicationData: any
  ): Promise<void> {
    try {
      switch (step) {
        case ApplicationStep.PROPERTY_DETAILS:
          if (!applicationData.propertyDetails) {
            throw new BadRequestException(
              'Property details must be completed before proceeding'
            );
          }
          this.validatePropertyDetails(applicationData.propertyDetails);
          break;

        case ApplicationStep.COMPLIANCE_CHECKLIST: {
          const applicationId = applicationData.id as string | undefined;
          const propertyTypeId =
            applicationData?.propertyDetails?.propertyType ||
            applicationData?.propertyDetails?.propertyTypeId;

          if (applicationId) {
            if (!propertyTypeId) {
              throw new BadRequestException(
                'Property type is required for checklist validation'
              );
            }

            // Validate using persisted records to avoid requiring payload again
            const [items, checked] = await Promise.all([
              (this.prisma as any).checklist.findMany({
                where: { propertyTypeId },
                select: { id: true, name: true },
              }),
              (this.prisma as any).complianceChecklist.findMany({
                where: { applicationId, checked: true },
                select: { checklistId: true },
              }),
            ]);

            if (!items.length) {
              throw new BadRequestException(
                'No checklist items configured for this property type'
              );
            }

            const checkedSet = new Set(checked.map((c: any) => c.checklistId));
            const missing = items
              .filter((i: any) => !checkedSet.has(i.id))
              .map((i: any) => i.name);

            if (missing.length) {
              throw new BadRequestException(
                `Checklist incomplete. Missing confirmations for: ${missing.join(', ')}`
              );
            }

            break;
          }

          // Fallback to payload-based validation when no applicationId yet
          if (!applicationData.complianceChecklist) {
            throw new BadRequestException(
              'Compliance checklist must be completed before proceeding'
            );
          }
          await this.validateComplianceChecklist(
            applicationData.complianceChecklist,
            propertyTypeId
          );
          break;
        }

        case ApplicationStep.DOCUMENT_UPLOAD:
          if (!applicationData.id) {
            throw new BadRequestException(
              'Application ID is required for document validation'
            );
          }
          const documentValidation =
            await this.documentService.validateDocumentStepCompletion(
              applicationData.id
            );
          if (!documentValidation.isComplete) {
            throw new BadRequestException(documentValidation.message);
          }
          break;

        case ApplicationStep.PAYMENT:
          // Payment validation will be handled later
          break;

        case ApplicationStep.SUBMISSION:
          // Validate all steps recursively
          await this.validateStepCompletion(
            ApplicationStep.PROPERTY_DETAILS,
            applicationData
          );
          await this.validateStepCompletion(
            ApplicationStep.COMPLIANCE_CHECKLIST,
            applicationData
          );
          if (applicationData.id) {
            await this.validateStepCompletion(
              ApplicationStep.DOCUMENT_UPLOAD,
              applicationData
            );
          }
          break;
      }
    } catch (error) {
      console.error('Validation error:', error.message);
      throw error; // rethrow so submit() can handle it
    }
  }

  getStepRequirements(step: ApplicationStep): string[] {
    switch (step) {
      case ApplicationStep.PROPERTY_DETAILS:
        return [
          'Property name',
          'Complete address',
          'Property type',
          'Number of bedrooms and bathrooms',
          'Maximum number of guests',
          'Basic property description',
        ];

      case ApplicationStep.COMPLIANCE_CHECKLIST:
        return [
          'Safety requirements (smoke/CO detectors, fire extinguishers, etc.)',
          'Legal requirements (licenses, insurance, compliance)',
          'Property standards (cleanliness, maintenance, furnishings)',
          'Host commitments (communication, screening, policies)',
          'Agreement to terms and conditions',
          'Certification of information accuracy',
        ];

      case ApplicationStep.DOCUMENT_UPLOAD:
        return [
          'Government-issued ID',
          'Property ownership documents',
          'Insurance certificates',
          'Safety inspection reports',
          'Business license (if applicable)',
        ];

      case ApplicationStep.PAYMENT:
        return [
          'Payment processing',
          'Invoice generation',
          'Payment confirmation',
        ];

      case ApplicationStep.SUBMISSION:
        return [
          'Review all information',
          'Final confirmation',
          'Application submission',
        ];

      default:
        return [];
    }
  }

  getNextStep(currentStep: ApplicationStep): ApplicationStep | null {
    const stepOrder = [
      ApplicationStep.PROPERTY_DETAILS,
      ApplicationStep.COMPLIANCE_CHECKLIST,
      ApplicationStep.DOCUMENT_UPLOAD,
      ApplicationStep.PAYMENT,
      ApplicationStep.SUBMISSION,
    ];

    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      return stepOrder[currentIndex + 1];
    }
    return null;
  }

  getPreviousStep(currentStep: ApplicationStep): ApplicationStep | null {
    const stepOrder = [
      ApplicationStep.PROPERTY_DETAILS,
      ApplicationStep.COMPLIANCE_CHECKLIST,
      ApplicationStep.DOCUMENT_UPLOAD,
      ApplicationStep.PAYMENT,
      ApplicationStep.SUBMISSION,
    ];

    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      return stepOrder[currentIndex - 1];
    }
    return null;
  }

  calculateProgress(currentStep: ApplicationStep): number {
    const stepOrder = [
      ApplicationStep.PROPERTY_DETAILS,
      ApplicationStep.COMPLIANCE_CHECKLIST,
      ApplicationStep.DOCUMENT_UPLOAD,
      ApplicationStep.PAYMENT,
      ApplicationStep.SUBMISSION,
    ];

    const currentIndex = stepOrder.indexOf(currentStep);
    return Math.round(((currentIndex + 1) / stepOrder.length) * 100);
  }
}
