import {
  LevelWire,
  MenuWire,
  RoleWire,
} from '../../../common/token/access-enums';

// What the frontend gets to decide which tabs/levels to show.
export class SessionDto {
  // Id of the access token: the frontend tags progress saves left on the
  // device with it, so they are never replayed into another token.
  tokenId!: string;
  label!: string;
  role!: RoleWire;
  menus!: MenuWire[];
  levels!: LevelWire[];
  expiresAt!: Date | null;
  // "Wajib lulus ujian untuk naik level".
  requireExam!: boolean;
  // IANA time zone of the learning day (default Asia/Jakarta).
  timeZone!: string;

  constructor(partial: Partial<SessionDto>) {
    Object.assign(this, partial);
  }
}
