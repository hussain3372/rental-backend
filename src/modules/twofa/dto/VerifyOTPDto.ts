import { IsString } from "class-validator";


export class VerifyOTPDto {
    @IsString()
    otp: string;
}