import { ApplicationStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsOptional } from "class-validator";

export class FindAllApplicationsDto {
  @IsOptional()
  status?: ApplicationStatus;

  @IsOptional()
  @Type(() => Number)
  skip?: number = 0;

  @IsOptional()
  @Type(() => Number)
  take?: number = 10;
}
