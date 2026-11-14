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

// Gemini's own role names, also used on the wire for stored messages.
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

// Each request carries the conversation's most recent turns so the model has
// the context; the last one is the new question (checked in AiService). The
// server stores the question and answer under `conversationId`, or starts a
// new thread when it's missing (AiConversationsService).
export class ChatDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  conversationId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages!: AiMessageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AiContextDto)
  context?: AiContextDto;
}
