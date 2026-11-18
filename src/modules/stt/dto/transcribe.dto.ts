import { IsIn, IsOptional } from 'class-validator';
import { STT_LANGUAGES, type SttLanguage } from '../stt.service';

export class SttTranscribeDto {
  // Never auto-detected: short answers are often detected wrong.
  @IsOptional()
  @IsIn(STT_LANGUAGES)
  language?: SttLanguage;
}

export class SttTranscriptionDto {
  text!: string;
  language!: SttLanguage;
  durationSec!: number;

  constructor(o: SttTranscriptionDto) {
    Object.assign(this, o);
  }
}
