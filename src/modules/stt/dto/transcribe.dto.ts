import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  STT_HINT_MAX_CHARS,
  STT_LANGUAGES,
  type SttLanguage,
} from '../stt.service';

export class SttTranscribeDto {
  // Never auto-detected: short answers are often detected wrong.
  @IsOptional()
  @IsIn(STT_LANGUAGES)
  language?: SttLanguage;

  // The phrase the learner is expected to say ("Tandai hafal" for an
  // expression): switches the stt service to checking (neutral prompt, and
  // speech that is clearly not English is refused). Not fed to the model.
  @IsOptional()
  @IsString()
  @MaxLength(STT_HINT_MAX_CHARS)
  hint?: string;
}

export class SttTranscriptionDto {
  text!: string;
  language!: SttLanguage;
  durationSec!: number;

  constructor(o: SttTranscriptionDto) {
    Object.assign(this, o);
  }
}
