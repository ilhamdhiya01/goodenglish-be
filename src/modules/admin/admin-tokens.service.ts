import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  LEVEL_WIRE,
  levelsFromWire,
  levelsToWire,
  MENU_WIRE,
  menusFromWire,
  menusToWire,
  ROLE_WIRE,
  roleToWire,
} from '../../common/token/access-enums';
import { generateAccessToken } from '../../common/token/access-token.util';
import { AccessToken, Prisma } from '../../generated/prisma/client';
import { CreateTokenDto } from './dto/create-token.dto';
import {
  CreatedTokenDto,
  TokenListItemDto,
  TokenStatus,
} from './dto/token-list-item.dto';
import { TokenSessionItemDto, TokenSummaryDto } from './dto/token-summary.dto';
import { UpdateTokenDto } from './dto/update-token.dto';

type TokenWithActive = AccessToken & { activeDevices: number };

@Injectable()
export class AdminTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<TokenListItemDto[]> {
    const tokens = await this.prisma.accessToken.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.activeDeviceCounts(tokens.map((t) => t.id));
    return tokens.map((t) =>
      this.toItem({ ...t, activeDevices: counts.get(t.id) ?? 0 }),
    );
  }

  async create(dto: CreateTokenDto): Promise<CreatedTokenDto> {
    const role = ROLE_WIRE[dto.role ?? 'learner'];
    this.assertLearnerHasAccess(role, dto.menus, dto.levels);

    const { plain, hash, prefix } = generateAccessToken();
    const token = await this.prisma.accessToken.create({
      data: {
        label: dto.label.trim(),
        tokenHash: hash,
        tokenPrefix: prefix,
        role,
        menus: menusFromWire(dto.menus),
        levels: levelsFromWire(dto.levels),
        maxDevices: dto.maxDevices,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    return new CreatedTokenDto({
      token: plain,
      item: this.toItem({ ...token, activeDevices: 0 }),
    });
  }

  async update(id: string, dto: UpdateTokenDto): Promise<TokenListItemDto> {
    const current = await this.findOrThrow(id);
    const role = dto.role ? ROLE_WIRE[dto.role] : current.role;
    const menus = dto.menus ? menusFromWire(dto.menus) : current.menus;
    const levels = dto.levels ? levelsFromWire(dto.levels) : current.levels;
    this.assertLearnerHasAccess(role, menusToWire(menus), levelsToWire(levels));

    const expiresAt =
      dto.expiresAt === undefined
        ? current.expiresAt
        : dto.expiresAt === null
          ? null
          : new Date(dto.expiresAt);

    // Demoting or expiring an admin must not leave the dashboard without one.
    const staysActiveAdmin =
      role === 'ADMIN' &&
      !current.revokedAt &&
      (!expiresAt || expiresAt > new Date());
    if (!staysActiveAdmin) await this.assertNotLastAdmin(current);

    const data: Prisma.AccessTokenUpdateInput = {
      role,
      menus,
      levels,
      expiresAt,
      ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
      ...(dto.maxDevices !== undefined ? { maxDevices: dto.maxDevices } : {}),
    };
    const token = await this.prisma.accessToken.update({ where: { id }, data });
    return this.withActiveDevices(token);
  }

  async revoke(id: string): Promise<TokenListItemDto> {
    const current = await this.findOrThrow(id);
    await this.assertNotLastAdmin(current);
    const now = new Date();
    const [token] = await this.prisma.$transaction([
      this.prisma.accessToken.update({
        where: { id },
        data: { revokedAt: current.revokedAt ?? now },
      }),
      // Signs every device out right away instead of waiting for the guard
      // to reject them one by one.
      this.prisma.tokenSession.updateMany({
        where: { accessTokenId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    return this.withActiveDevices(token);
  }

  async activate(id: string): Promise<TokenListItemDto> {
    await this.findOrThrow(id);
    const token = await this.prisma.accessToken.update({
      where: { id },
      data: { revokedAt: null },
    });
    return this.withActiveDevices(token);
  }

  // "Reset devices": frees every slot so the owner can sign in again on new
  // devices. Progress is untouched.
  async resetSessions(id: string): Promise<TokenListItemDto> {
    const token = await this.findOrThrow(id);
    await this.prisma.tokenSession.updateMany({
      where: { accessTokenId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.toItem({ ...token, activeDevices: 0 });
  }

  // Deletes the token together with its sessions and progress (cascade).
  async remove(id: string): Promise<void> {
    const current = await this.findOrThrow(id);
    await this.assertNotLastAdmin(current);
    await this.prisma.accessToken.delete({ where: { id } });
  }

  async summary(id: string): Promise<TokenSummaryDto> {
    await this.findOrThrow(id);
    const [docs, sessions] = await Promise.all([
      this.prisma.progressDoc.findMany({ where: { accessTokenId: id } }),
      this.prisma.tokenSession.findMany({
        where: { accessTokenId: id },
        orderBy: { lastSeenAt: 'desc' },
        take: 20,
      }),
    ]);
    const byKey = new Map(docs.map((d) => [d.key, d.data]));
    const countKeys = (v: unknown) =>
      v && typeof v === 'object' ? Object.keys(v).length : 0;
    const now = new Date();

    return new TokenSummaryDto({
      knownCount: countKeys(byKey.get('KNOWN')),
      srsCount: countKeys(byKey.get('SRS')),
      ownSentenceCount: countKeys(byKey.get('OWN')),
      customWordCount: Array.isArray(byKey.get('CUSTOM'))
        ? (byKey.get('CUSTOM') as unknown[]).length
        : 0,
      lastProgressAt: docs.length
        ? new Date(Math.max(...docs.map((d) => d.updatedAt.getTime())))
        : null,
      sessions: sessions.map(
        (s) =>
          new TokenSessionItemDto({
            id: s.id,
            deviceLabel: s.deviceLabel,
            active: !s.revokedAt && s.expiresAt > now,
            createdAt: s.createdAt,
            lastSeenAt: s.lastSeenAt,
            expiresAt: s.expiresAt,
          }),
      ),
    });
  }

  // Used by the create-admin-token script for the very first admin.
  async createAdmin(label: string): Promise<CreatedTokenDto> {
    return this.create({
      label,
      role: 'admin',
      menus: Object.keys(MENU_WIRE) as CreateTokenDto['menus'],
      levels: Object.keys(LEVEL_WIRE) as CreateTokenDto['levels'],
      maxDevices: 5,
    });
  }

  private async findOrThrow(id: string): Promise<AccessToken> {
    const token = await this.prisma.accessToken.findUnique({ where: { id } });
    if (!token) {
      throw new NotFoundException({ field: 'id', message: 'token_not_found' });
    }
    return token;
  }

  private assertLearnerHasAccess(
    role: AccessToken['role'],
    menus: unknown[],
    levels: unknown[],
  ) {
    if (role === 'ADMIN') return;
    if (!menus.length) {
      throw new UnprocessableEntityException({
        field: 'menus',
        message: 'menus_required',
      });
    }
    if (!levels.length) {
      throw new UnprocessableEntityException({
        field: 'levels',
        message: 'levels_required',
      });
    }
  }

  // Throws if `token` is currently the only usable admin token.
  private async assertNotLastAdmin(token: AccessToken) {
    const now = new Date();
    const isActiveAdmin =
      token.role === 'ADMIN' &&
      !token.revokedAt &&
      (!token.expiresAt || token.expiresAt > now);
    if (!isActiveAdmin) return;

    const others = await this.prisma.accessToken.count({
      where: {
        id: { not: token.id },
        role: 'ADMIN',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (others === 0) {
      throw new UnprocessableEntityException({
        field: 'role',
        message: 'last_admin',
      });
    }
  }

  private async activeDeviceCounts(
    ids: string[],
  ): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.tokenSession.groupBy({
      by: ['accessTokenId'],
      where: {
        accessTokenId: { in: ids },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.accessTokenId, r._count._all]));
  }

  private async withActiveDevices(
    token: AccessToken,
  ): Promise<TokenListItemDto> {
    const counts = await this.activeDeviceCounts([token.id]);
    return this.toItem({ ...token, activeDevices: counts.get(token.id) ?? 0 });
  }

  private toItem(t: TokenWithActive): TokenListItemDto {
    const now = new Date();
    const status: TokenStatus = t.revokedAt
      ? 'revoked'
      : t.expiresAt && t.expiresAt <= now
        ? 'expired'
        : 'active';
    return new TokenListItemDto({
      id: t.id,
      label: t.label,
      tokenPrefix: t.tokenPrefix,
      role: roleToWire(t.role),
      menus: menusToWire(t.menus),
      levels: levelsToWire(t.levels),
      maxDevices: t.maxDevices,
      activeDevices: t.activeDevices,
      status,
      expiresAt: t.expiresAt,
      revokedAt: t.revokedAt,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
    });
  }
}
