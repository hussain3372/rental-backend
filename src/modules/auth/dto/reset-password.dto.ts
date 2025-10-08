import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Match } from '../decorators/match.decorator';

export class ResetPasswordDto {
  @IsString({ message: 'Reset token is required' })
  @MinLength(1, { message: 'Reset token cannot be empty' })
  token: string;

  @IsString({ message: 'New password must be a string' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  @MaxLength(128, { message: 'New password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  newPassword: string;

  @IsString({ message: 'Confirm password must be a string' })
  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword: string;
}
