import { IsBoolean, IsOptional } from "class-validator";

export class UpdateSettingDto {
  @IsOptional()
  @IsBoolean()
  isEmailStatus?: boolean;

  @IsOptional()
  @IsBoolean()
  isNotificationStatus?: boolean;
}
