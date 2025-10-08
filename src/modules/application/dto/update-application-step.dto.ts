import { IsEnum, IsNumber, IsObject, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApplicationStep, DocumentType } from '@prisma/client';

class DocumentDto {
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsString()
  fileName: string;

  @IsString()
  originalName: string;

  @IsString()
  mimeType: string;

  @IsNumber()
  size: number;

  @IsString()
  url: string;
}

export class UpdateApplicationStepDto {
  @IsEnum(ApplicationStep)
  step: ApplicationStep;

  @ValidateIf(o => o.step === ApplicationStep.SUBMISSION || o.data !== undefined)
  @IsObject()
  @IsOptional()
  data?: {
    propertyDetails?: Record<string, any>;
    complianceChecklist?: Record<string, any>;
    documents?: DocumentDto[];
  };
}
