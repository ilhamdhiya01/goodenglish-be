import { SetMetadata } from '@nestjs/common';

export const ADMIN_ONLY_KEY = 'adminOnly';

export const AdminOnly = (adminOnly: boolean) =>
  SetMetadata(ADMIN_ONLY_KEY, adminOnly);
