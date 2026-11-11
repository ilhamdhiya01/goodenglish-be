import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AiContextDto } from './ai-context.dto';

// Gemini's own role names: the frontend stores the conversation in them.
export const AI_ROLES = ['user', 'model'] as const;
export type AiRole = (typeof AI_ROLES)[number];

// The model's earlier answers can be longer than a question.
export const MAX_QUESTION_CHARS = 1000;
export const MAX_ANSWER_CHARS = 6000;

export class AiMessageDto {
  @IsIn(AI_ROLES)
  role!: AiRole;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ANSWER_CHARS)
  text!: string;
}

// The conversation is kept in the learner's browser; each request carries its
// most recent turns so the model has the context. The last one is the new
// question (checked in AiService).
export class ChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages!: AiMessageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AiContextDto)
  context?: AiContextDto;
}
