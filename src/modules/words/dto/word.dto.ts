import { LevelWire } from '../../../common/token/access-enums';

export class WordDto {
  id!: string;
  level!: LevelWire;
  week!: number;
  type!: string;
  en!: string;
  meaning!: string;
  pron!: string;
  example!: string;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<WordDto>) {
    Object.assign(this, partial);
  }
}
