import {
  LevelWire,
  MenuWire,
  RoleWire,
} from '../../../common/token/access-enums';

// What the frontend gets to decide which tabs/levels to show.
export class SessionDto {
  label!: string;
  role!: RoleWire;
  menus!: MenuWire[];
  levels!: LevelWire[];
  expiresAt!: Date | null;

  constructor(partial: Partial<SessionDto>) {
    Object.assign(this, partial);
  }
}
