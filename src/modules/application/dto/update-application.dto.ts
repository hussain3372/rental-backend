import {
  IsOptional,
  IsEnum,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApplicationStatus, ApplicationStep } from '@prisma/client';
import { Type } from 'class-transformer';

import { DocumentType } from '@prisma/client';

class DocumentDto {
  @IsString()
  fileName: string;

  @IsString()
  originalName: string;

  @IsString()
  mimeType: string;

  @IsString()
  url: string;

  @IsEnum(DocumentType)  // ✅ use enum validation
  documentType: DocumentType;

  @IsOptional()
  size: number;
}


export class UpdateApplicationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsEnum(ApplicationStep)
  currentStep?: ApplicationStep;

  @IsOptional()
  @IsObject()
  propertyDetails?: Record<string, any>;

  @IsOptional()
  @IsObject()
  complianceChecklist?: Record<string, any>;

  @IsOptional()
  @IsString()
  reviewNotes?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DocumentDto)
  documents?: DocumentDto[];
}
