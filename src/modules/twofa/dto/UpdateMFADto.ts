import { IsBoolean } from "class-validator";


export class UpdateMFADto {
    @IsBoolean()
    mfaEnabled: boolean;
}