import { Level, Menu, Role } from '../../generated/prisma/enums';

// What the JWT in the `session` cookie carries. Deliberately only ids:
// permissions are always read fresh from the DB (see TokenSessionGuard), so
// an admin editing or revoking a token takes effect on the very next request
// instead of whenever the JWT happens to expire.
export interface SessionJwtPayload {
  sub: string; // TokenSession id
  tokenId: string;
}

// Attached to the request by TokenSessionGuard after the DB check.
export interface AccessContext {
  sessionId: string;
  tokenId: string;
  label: string;
  role: Role;
  menus: Menu[];
  levels: Level[];
  expiresAt: Date | null;
}
