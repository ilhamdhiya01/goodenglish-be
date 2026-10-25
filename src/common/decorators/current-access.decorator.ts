import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessRequest } from '../guards/token-session.guard';
import { AccessContext } from '../types/access-context';

// Only valid on routes behind @AccessAuth(), which is what sets it.
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessContext =>
    ctx.switchToHttp().getRequest<AccessRequest>().access!,
);
