import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { AiConversationsService } from './ai-conversations.service';
import { AiQuotaService } from './ai-quota.service';
import { AiService, assertAiMenu } from './ai.service';
import {
  AiConversationDto,
  AiConversationSummaryDto,
} from './dto/ai-conversation.dto';
import { ChatDto } from './dto/chat.dto';
import { AiUsageDto } from './dto/usage.dto';

const sse = (event: string | null, data: unknown) =>
  (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`;

@Controller('ai')
@AccessAuth()
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: AiService,
    private readonly quota: AiQuotaService,
    private readonly conversations: AiConversationsService,
  ) {}

  // Server-sent events: first `event: meta` with the conversation id (new
  // when the request had none), then `data: {"text": "..."}` per chunk, then
  // `event: done` (or `event: error` if Gemini fails mid-answer). @Res()
  // keeps ResponseInterceptor out of the way; anything rejected before the
  // stream starts still goes through HttpExceptionFilter as normal JSON.
  @Post('chat')
  async chat(
    @CurrentAccess() access: AccessContext,
    @Body() dto: ChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    const { conversationId, stream } = await this.ai.startChat(
      access,
      dto,
      abort.signal,
    );

    res.status(HttpStatus.OK).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx would otherwise buffer the whole answer before sending it on.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(sse('meta', { conversationId }));
    let answer = '';
    try {
      for await (const text of stream) {
        answer += text;
        res.write(sse(null, { text }));
      }
      res.write(sse('done', {}));
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(err instanceof Error ? err.message : err);
        res.write(sse('error', { message: 'ai_failed' }));
      }
    } finally {
      res.end();
      // Kept even when cut off: the learner already saw that much of it.
      if (answer.trim()) {
        await this.conversations
          .saveAnswer(conversationId, answer)
          .catch((err: unknown) =>
            this.logger.error(err instanceof Error ? err.message : err),
          );
      }
    }
  }

  @Get('usage')
  @ResponseMessage('AI usage retrieved successfully')
  usage(@CurrentAccess() access: AccessContext): Promise<AiUsageDto> {
    return this.quota.usage(access.tokenId, access.aiDailyLimit);
  }

  // History belongs to the session's own token: there is no token id in the
  // URL to tamper with, and another token's conversation id is a 404.
  @Get('conversations')
  @ResponseMessage('AI conversations retrieved successfully')
  listConversations(
    @CurrentAccess() access: AccessContext,
  ): Promise<AiConversationSummaryDto[]> {
    assertAiMenu(access);
    return this.conversations.list(access.tokenId);
  }

  @Get('conversations/:id')
  @ResponseMessage('AI conversation retrieved successfully')
  getConversation(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
  ): Promise<AiConversationDto> {
    assertAiMenu(access);
    return this.conversations.get(access.tokenId, id);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('AI conversation deleted')
  async deleteConversation(
    @CurrentAccess() access: AccessContext,
    @Param('id') id: string,
  ): Promise<null> {
    assertAiMenu(access);
    await this.conversations.remove(access.tokenId, id);
    return null;
  }
}
