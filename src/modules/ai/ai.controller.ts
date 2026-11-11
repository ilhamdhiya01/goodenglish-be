import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { AiQuotaService } from './ai-quota.service';
import { AiService } from './ai.service';
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
  ) {}

  // Server-sent events: `data: {"text": "..."}` per chunk, then `event: done`
  // (or `event: error` if Gemini fails mid-answer). @Res() keeps
  // ResponseInterceptor out of the way; anything rejected before the stream
  // starts still goes through HttpExceptionFilter as normal JSON.
  @Post('chat')
  async chat(
    @CurrentAccess() access: AccessContext,
    @Body() dto: ChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    const stream = await this.ai.startChat(access, dto, abort.signal);

    res.status(HttpStatus.OK).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx would otherwise buffer the whole answer before sending it on.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    try {
      for await (const text of stream) res.write(sse(null, { text }));
      res.write(sse('done', {}));
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(err instanceof Error ? err.message : err);
        res.write(sse('error', { message: 'ai_failed' }));
      }
    } finally {
      res.end();
    }
  }

  @Get('usage')
  @ResponseMessage('AI usage retrieved successfully')
  usage(@CurrentAccess() access: AccessContext): Promise<AiUsageDto> {
    return this.quota.usage(access.tokenId, access.aiDailyLimit);
  }
}
