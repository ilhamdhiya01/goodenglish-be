import {
  LevelWire,
  MenuWire,
  RoleWire,
} from '../../../common/token/access-enums';

export type TokenStatus = 'active' | 'revoked' | 'expired';

// Never includes the plaintext token or its hash — only the visible prefix.
export class TokenListItemDto {
  id!: string;
  label!: string;
  tokenPrefix!: string;
  role!: RoleWire;
  menus!: MenuWire[];
  levels!: LevelWire[];
  maxDevices!: number;
  activeDevices!: number;
  status!: TokenStatus;
  expiresAt!: Date | null;
  revokedAt!: Date | null;
  lastUsedAt!: Date | null;
  createdAt!: Date;

  constructor(partial: Partial<TokenListItemDto>) {
    Object.assign(this, partial);
  }
}

// The only response that ever carries the plaintext token: right after
// creation or regeneration. It can't be retrieved again later.
export class CreatedTokenDto {
  token!: string;
  item!: TokenListItemDto;

  constructor(partial: Partial<CreatedTokenDto>) {
    Object.assign(this, partial);
  }
}
