import type { AiRole } from './chat.dto';

// GET /ai/conversations: one row per thread, newest first.
export class AiConversationSummaryDto {
  id!: string;
  title!: string;
  updatedAt!: Date;
  messageCount!: number;

  constructor(partial: Partial<AiConversationSummaryDto>) {
    Object.assign(this, partial);
  }
}

export class AiChatMessageDto {
  id!: string;
  role!: AiRole;
  text!: string;
  // The word card the question came from.
  word?: { word: string; meaning?: string };
  createdAt!: Date;

  constructor(partial: Partial<AiChatMessageDto>) {
    Object.assign(this, partial);
  }
}

// GET /ai/conversations/:id
export class AiConversationDto {
  id!: string;
  title!: string;
  updatedAt!: Date;
  messages!: AiChatMessageDto[];

  constructor(partial: Partial<AiConversationDto>) {
    Object.assign(this, partial);
  }
}
