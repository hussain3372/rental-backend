import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SafetyRequirement {
  @IsBoolean()
  carbonMonoxideDetector: boolean;

  @IsBoolean()
  smokeDetector: boolean;

  @IsBoolean()
  fireExtinguisher: boolean;

  @IsBoolean()
  firstAidKit: boolean;

  @IsBoolean()
  emergencyContactInfo: boolean;

  @IsBoolean()
  propertyLockboxes: boolean;

  @IsOptional()
  @IsString()
  safetyNotes?: string;
}

class LegalRequirement {
  @IsBoolean()
  validRentalLicense: boolean;

  @IsBoolean()
  homeownersInsurance: boolean;

  @IsBoolean()
  liabilityInsurance: boolean;

  @IsBoolean()
  businessLicense: boolean;

  @IsBoolean()
  taxCompliance: boolean;

  @IsBoolean()
  localRegulations: boolean;

  @IsOptional()
  @IsString()
  legalNotes?: string;
}

class PropertyStandards {
  @IsBoolean()
  cleanAndWellMaintained: boolean;

  @IsBoolean()
  functioningUtilities: boolean;

  @IsBoolean()
  adequateFurnishings: boolean;

  @IsBoolean()
  pestFree: boolean;

  @IsBoolean()
  noMajorRepairsNeeded: boolean;

  @IsBoolean()
  accessibleLocation: boolean;

  @IsOptional()
  @IsString()
  propertyNotes?: string;
}

class HostCommitment {
  @IsBoolean()
  responsiveCommunication: boolean;

  @IsBoolean()
  guestScreening: boolean;

  @IsBoolean()
  checkInProcedures: boolean;

  @IsBoolean()
  maintenanceResponse: boolean;

  @IsBoolean()
  platformPolicies: boolean;

  @IsBoolean()
  backgroundCheck: boolean;

  @IsOptional()
  @IsString()
  commitmentNotes?: string;
}

export class ComplianceChecklistDto {
  @ValidateNested()
  @Type(() => SafetyRequirement)
  safetyRequirements: SafetyRequirement;

  @ValidateNested()
  @Type(() => LegalRequirement)
  legalRequirements: LegalRequirement;

  @ValidateNested()
  @Type(() => PropertyStandards)
  propertyStandards: PropertyStandards;

  @ValidateNested()
  @Type(() => HostCommitment)
  hostCommitment: HostCommitment;

  @IsBoolean()
  agreeToTerms: boolean;

  @IsBoolean()
  certifyAccuracy: boolean;

  @IsOptional()
  @IsString()
  additionalNotes?: string;
}
