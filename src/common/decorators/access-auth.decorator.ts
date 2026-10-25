import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TokenSessionGuard } from '../guards/token-session.guard';
import { AdminOnly } from './admin-only.decorator';

// Mirrors critiq's @OrgAuth: verify the cookie's JWT, then re-check the
// session/token against the DB. `admin: true` additionally requires an ADMIN
// token.
export const AccessAuth = (options: { admin?: boolean } = {}) =>
  applyDecorators(
    UseGuards(AuthGuard('jwt'), TokenSessionGuard),
    AdminOnly(options.admin ?? false),
  );
