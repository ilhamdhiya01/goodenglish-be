import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Level, Menu } from '../../generated/prisma/enums';
import {
  levelsToWire,
  menusToWire,
  roleToWire,
} from '../../common/token/access-enums';
import { hashAccessToken } from '../../common/token/access-token.util';
import {
  AccessContext,
  SessionJwtPayload,
} from '../../common/types/access-context';
import { SessionDto } from './dto/session.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RedeemResult {
  jwt: string;
  maxAgeMs: number;
  session: SessionDto;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  get sessionDays(): number {
    return this.configService.getOrThrow<number>('session.days');
  }

  /**
   * Exchanges a plaintext access token for a device session. `currentJwt` is
   * the cookie this browser already has, if any: re-entering the same token
   * on the same device replaces that session instead of using up another
   * device slot.
   */
  async redeem(
    plain: string,
    deviceLabel: string,
    currentJwt?: string,
  ): Promise<RedeemResult> {
    const token = await this.prisma.accessToken.findUnique({
      where: { tokenHash: hashAccessToken(plain) },
    });
    if (!token) {
      throw new UnauthorizedException({
        field: 'token',
        message: 'invalid_token',
      });
    }

    const now = new Date();
    if (token.revokedAt) {
      throw new ForbiddenException({
        field: 'token',
        message: 'token_revoked',
      });
    }
    if (token.expiresAt && token.expiresAt <= now) {
      throw new ForbiddenException({
        field: 'token',
        message: 'token_expired',
      });
    }

    const previousSessionId = await this.sessionIdFromJwt(currentJwt);
    const expiresAt = new Date(now.getTime() + this.sessionDays * DAY_MS);

    const session = await this.prisma.$transaction(async (tx) => {
      if (previousSessionId) {
        await tx.tokenSession.updateMany({
          where: {
            id: previousSessionId,
            accessTokenId: token.id,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }

      const active = await tx.tokenSession.count({
        where: {
          accessTokenId: token.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (active >= token.maxDevices) {
        throw new ConflictException({
          field: 'token',
          message: 'device_limit',
        });
      }

      await tx.accessToken.update({
        where: { id: token.id },
        data: { lastUsedAt: now },
      });
      return tx.tokenSession.create({
        data: {
          accessTokenId: token.id,
          deviceLabel: deviceLabel.slice(0, 120),
          expiresAt,
        },
      });
    });

    const payload: SessionJwtPayload = { sub: session.id, tokenId: token.id };
    const jwt = await this.jwtService.signAsync(payload, {
      expiresIn: `${this.sessionDays}d`,
    });

    const isAdmin = token.role === 'ADMIN';
    return {
      jwt,
      maxAgeMs: this.sessionDays * DAY_MS,
      session: new SessionDto({
        label: token.label,
        role: roleToWire(token.role),
        // Admins always get everything, even if the stored arrays are empty.
        menus: menusToWire(isAdmin ? Object.values(Menu) : token.menus),
        levels: levelsToWire(isAdmin ? Object.values(Level) : token.levels),
        expiresAt: token.expiresAt,
      }),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.tokenSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  toSessionDto(access: AccessContext): SessionDto {
    return new SessionDto({
      label: access.label,
      role: roleToWire(access.role),
      menus: menusToWire(access.menus),
      levels: levelsToWire(access.levels),
      expiresAt: access.expiresAt,
    });
  }

  // An invalid/expired cookie just means "no previous session to replace".
  private async sessionIdFromJwt(jwt?: string): Promise<string | null> {
    if (!jwt) return null;
    try {
      const payload = await this.jwtService.verifyAsync<SessionJwtPayload>(jwt);
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}
