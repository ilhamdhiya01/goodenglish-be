import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiRole as AiRoleDb } from '../../generated/prisma/enums';
import {
  AiChatMessageDto,
  AiConversationDto,
  AiConversationSummaryDto,
} from './dto/ai-conversation.dto';
import type { AiRole } from './dto/chat.dto';

const TITLE_CHARS = 120;
const LIST_LIMIT = 50;

const ROLE_WIRE: Record<AiRoleDb, AiRole> = {
  [AiRoleDb.USER]: 'user',
  [AiRoleDb.MODEL]: 'model',
};

// The first question on one line, cut to fit the column.
export const titleOf = (question: string): string => {
  const line = question.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_CHARS
    ? line.slice(0, TITLE_CHARS - 1) + '…'
    : line;
};

const notFound = () =>
  new NotFoundException({ field: '', message: 'ai_conversation_not_found' });

// "Tanya AI" history. Every query is scoped by the session's own token, so a
// conversation id from another token behaves exactly like one that doesn't
// exist.
@Injectable()
export class AiConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Checked before the question takes quota or the stream starts, so a stale
  // id is still a normal JSON 404.
  async assertOwned(tokenId: string, id: string): Promise<void> {
    const row = await this.prisma.aiConversation.findFirst({
      where: { id, accessTokenId: tokenId },
      select: { id: true },
    });
    if (!row) throw notFound();
  }

  // Stores the learner's question, starting a new thread when there is no
  // id yet. Returns the thread id.
  async saveQuestion(
    tokenId: string,
    conversationId: string | undefined,
    text: string,
    word?: { word: string; meaning?: string },
  ): Promise<string> {
    const message = {
      role: AiRoleDb.USER,
      text,
      word: word?.word,
      wordMeaning: word?.meaning,
    };
    if (!conversationId) {
      const created = await this.prisma.aiConversation.create({
        data: {
          accessTokenId: tokenId,
          title: titleOf(text),
          messages: { create: message },
        },
        select: { id: true },
      });
      return created.id;
    }
    await this.addMessage(conversationId, message);
    return conversationId;
  }

  async saveAnswer(conversationId: string, text: string): Promise<void> {
    await this.addMessage(conversationId, { role: AiRoleDb.MODEL, text });
  }

  // updatedAt is set by hand: a nested create alone doesn't touch the parent
  // row, and the list is ordered by it.
  private async addMessage(
    conversationId: string,
    message: {
      role: AiRoleDb;
      text: string;
      word?: string;
      wordMeaning?: string;
    },
  ): Promise<void> {
    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date(), messages: { create: message } },
    });
  }

  async list(tokenId: string): Promise<AiConversationSummaryDto[]> {
    const rows = await this.prisma.aiConversation.findMany({
      where: { accessTokenId: tokenId },
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    return rows.map(
      (r) =>
        new AiConversationSummaryDto({
          id: r.id,
          title: r.title,
          updatedAt: r.updatedAt,
          messageCount: r._count.messages,
        }),
    );
  }

  async get(tokenId: string, id: string): Promise<AiConversationDto> {
    const row = await this.prisma.aiConversation.findFirst({
      where: { id, accessTokenId: tokenId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw notFound();
    return new AiConversationDto({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      messages: row.messages.map(
        (m) =>
          new AiChatMessageDto({
            id: m.id,
            role: ROLE_WIRE[m.role],
            text: m.text,
            word: m.word
              ? { word: m.word, meaning: m.wordMeaning ?? undefined }
              : undefined,
            createdAt: m.createdAt,
          }),
      ),
    });
  }

  async remove(tokenId: string, id: string): Promise<void> {
    const { count } = await this.prisma.aiConversation.deleteMany({
      where: { id, accessTokenId: tokenId },
    });
    if (!count) throw notFound();
  }
}
