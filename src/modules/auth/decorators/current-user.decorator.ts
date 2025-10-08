import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';

export interface CurrentUserType {
  id: number;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  name?: string;
  firstName?: string;
  lastName?: string;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);