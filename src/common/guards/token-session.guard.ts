import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Level, Menu } from '../../generated/prisma/enums';
import { ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AccessContext, SessionJwtPayload } from '../types/access-context';

// Writing lastSeenAt on every request would turn each read into a write;
// once every few minutes is plenty for "last active" in the admin dashboard.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AccessRequest = Request & {
  user: SessionJwtPayload;
  access?: AccessContext;
};

/**
 * Runs after AuthGuard('jwt') has verified the cookie's signature. Re-checks
 * the session and its token against the DB on every request — never trusting
 * the JWT alone — so revoking a token, resetting its devices or letting it
 * expire cuts access immediately. Same reasoning as critiq's OrgRolesGuard.
 */
@Injectable()
export class TokenSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AccessRequest>();
    const { sub: sessionId, tokenId } = request.user;

    const session = await this.prisma.tokenSession.findUnique({
      where: { id: sessionId },
      include: { accessToken: true },
    });
    const now = new Date();

    if (
      !session ||
      session.accessTokenId !== tokenId ||
      session.revokedAt ||
      session.expiresAt <= now
    ) {
      throw new UnauthorizedException({
        field: 'session',
        message: 'session_invalid',
      });
    }

    const token = session.accessToken;
    if (token.revokedAt) {
      throw new UnauthorizedException({
        field: 'token',
        message: 'token_revoked',
      });
    }
    if (token.expiresAt && token.expiresAt <= now) {
      throw new UnauthorizedException({
        field: 'token',
        message: 'token_expired',
      });
    }

    const adminOnly = this.reflector.getAllAndOverride<boolean>(
      ADMIN_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (adminOnly && token.role !== 'ADMIN') {
      throw new ForbiddenException({ field: 'role', message: 'admin_only' });
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.$transaction([
        this.prisma.tokenSession.update({
          where: { id: session.id },
          data: { lastSeenAt: now },
        }),
        this.prisma.accessToken.update({
          where: { id: token.id },
          data: { lastUsedAt: now },
        }),
      ]);
    }

    const isAdmin = token.role === 'ADMIN';
    request.access = {
      sessionId: session.id,
      tokenId: token.id,
      label: token.label,
      role: token.role,
      // Admins always get everything, even if the stored arrays are empty.
      menus: isAdmin ? Object.values(Menu) : token.menus,
      levels: isAdmin ? Object.values(Level) : token.levels,
      expiresAt: token.expiresAt,
    };
    return true;
  }
}
