import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AccessContext } from '../../common/types/access-context';
import { Menu } from '../../generated/prisma/enums';
import type { RoleplaySession } from '../../generated/prisma/client';
import { jakartaDay } from '../ai/ai-quota.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { createGemini } from '../ai/gemini.client';
import { SttService, type UploadedAudio } from '../stt/stt.service';
import {
  FinishRoleplayDto,
  MAX_FINISH,
  MAX_HELP,
  MAX_TRANSCRIBE,
  modeOfTurns,
  RoleplayContextDto,
  RoleplayHelpDto,
  RoleplayLineDto,
  RoleplayStartedDto,
  RoleplaySummaryDto,
  RoleplayTranscriptionDto,
  RoleplayTurnDto,
  RoleplayUsageDto,
  StartRoleplayDto,
  turnsOfMode,
  TranscribeDto,
  TranscriptDto,
} from './dto/roleplay.dto';
import { parseHelp, parseSummary, parseTurn } from './roleplay.parse';
import {
  HELP_SCHEMA,
  helpInstruction,
  OPENING_CUE,
  SUMMARY_SCHEMA,
  summaryInstruction,
  transcriptText,
  TURN_SCHEMA,
  turnInstruction,
} from './roleplay.prompts';

// Turns are spoken back and forth: latency matters more than depth. The
// summary is one call the learner waits for (target ≤ 10 s) but must judge
// mistakes carefully, so it gets a little thinking.
const TURN_THINKING = { thinkingLevel: ThinkingLevel.MINIMAL };
const SUMMARY_THINKING = { thinkingLevel: ThinkingLevel.LOW };
// No answer by then → 502, and the client offers "Coba lagi".
const TURN_TIMEOUT_MS = 20_000;
const SUMMARY_TIMEOUT_MS = 30_000;
// Turns are refused after this; a full session takes ~10 minutes.
export const SESSION_MAX_MS = 60 * 60 * 1000;
/** A session uses the daily quota once the learner has spoken this often. */
export const QUOTA_TURNS = 3;
/** Starts per day allowed, as a multiple of the daily quota. */
export const STARTS_FACTOR = 3;
// The summary can still be (re)fetched a while after the last turn.
export const FINISH_MAX_MS = 2 * 60 * 60 * 1000;

// Needs both the roleplay permission and the Skenario tab it lives in.
export const assertRoleplay = (access: AccessContext): void => {
  if (
    !access.menus.includes(Menu.ROLEPLAY) ||
    !access.menus.includes(Menu.SCENARIO)
  ) {
    throw new ForbiddenException({
      field: '',
      message: 'roleplay_not_allowed',
    });
  }
};

const fail = (message: string) =>
  new UnprocessableEntityException({ field: '', message });

// Transcript → Gemini contents. The opening cue stands in for the learner
// walking up (Gemini wants the user first), and back-to-back lines of one
// side (e.g. a retried turn) are merged so roles keep alternating.
export const toContents = (lines: RoleplayLineDto[]): Content[] => {
  const out: Content[] = [{ role: 'user', parts: [{ text: OPENING_CUE }] }];
  for (const l of lines) {
    const role = l.role === 'user' ? 'user' : 'model';
    const last = out[out.length - 1];
    if (last.role === role) last.parts!.push({ text: l.text });
    else out.push({ role, parts: [{ text: l.text }] });
  }
  return out;
};

const userTurnsOf = (lines: RoleplayLineDto[]) =>
  lines.filter((l) => l.role === 'user').length;

@Injectable()
export class RoleplayService {
  private readonly logger = new Logger(RoleplayService.name);
  // One client per key, like AiService.
  private cached: { apiKey: string; client: GoogleGenAI } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly stt: SttService,
  ) {}

  // Same Gemini key and model as Tanya AI (Admin › Tanya AI).
  private async gemini(): Promise<{ client: GoogleGenAI; model: string }> {
    const active = await this.settings.active();
    if (!active) {
      throw new ServiceUnavailableException({
        field: '',
        message: 'ai_unavailable',
      });
    }
    if (this.cached?.apiKey !== active.apiKey) {
      this.cached = {
        apiKey: active.apiKey,
        client: createGemini(active.apiKey),
      };
    }
    return { client: this.cached.client, model: active.model };
  }

  private async generate(
    systemInstruction: string,
    contents: Content[],
    schema: object,
    opts: {
      thinking: typeof TURN_THINKING;
      timeoutMs: number;
      max: number;
      temperature?: number;
    },
  ): Promise<string | undefined> {
    const { client, model } = await this.gemini();
    const res = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: opts.max,
        temperature: opts.temperature ?? 0.6,
        thinkingConfig: opts.thinking,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        abortSignal: AbortSignal.timeout(opts.timeoutMs),
      },
    });
    return res.text;
  }

  // Errors we raised ourselves (e.g. 503 no key) pass through; anything from
  // Gemini or the parsers becomes 502 ai_failed.
  private aiFailed(err: unknown): HttpException {
    if (err instanceof HttpException) return err;
    this.logger.error(err instanceof Error ? err.message : err);
    return new BadGatewayException({ field: '', message: 'ai_failed' });
  }

  // Sessions that used today's quota: those that reached QUOTA_TURNS turns.
  // One left earlier (a mis-tap, a mic that didn't work) doesn't count.
  private todayCount(tokenId: string, exceptId?: string): Promise<number> {
    return this.prisma.roleplaySession.count({
      where: {
        accessTokenId: tokenId,
        day: jakartaDay(),
        userTurns: { gte: QUOTA_TURNS },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
  }

  private startedToday(tokenId: string): Promise<number> {
    return this.prisma.roleplaySession.count({
      where: { accessTokenId: tokenId, day: jakartaDay() },
    });
  }

  // Takes one use of a per-session counter atomically, so requests sent at
  // once can't all pass a check made before the AI call; false when full.
  private async take(
    id: string,
    field: 'helpCount' | 'transcribeCount' | 'finishCount',
    max: number,
  ): Promise<boolean> {
    const { count } = await this.prisma.roleplaySession.updateMany({
      where: { id, [field]: { lt: max } },
      data: { [field]: { increment: 1 } },
    });
    return count > 0;
  }

  // A failed call doesn't use the slot up.
  private giveBack(
    id: string,
    field: 'helpCount' | 'transcribeCount' | 'finishCount',
  ) {
    return this.prisma.roleplaySession
      .updateMany({ where: { id }, data: { [field]: { decrement: 1 } } })
      .catch(() => undefined);
  }

  private quotaExceeded() {
    return new HttpException(
      { field: '', message: 'roleplay_quota_exceeded' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  async usage(access: AccessContext): Promise<RoleplayUsageDto> {
    assertRoleplay(access);
    return new RoleplayUsageDto({
      used: await this.todayCount(access.tokenId),
      limit: access.roleplayDailyLimit,
    });
  }

  // Opens a session and gets the AI's opening line. The quota is taken at
  // the QUOTA_TURNS-th turn (see turn()); here a full day is refused, and so
  // are too many starts that never got that far (STARTS_FACTOR × the quota),
  // so the opening lines can't be farmed. If Gemini fails the row goes.
  async start(
    access: AccessContext,
    dto: StartRoleplayDto,
  ): Promise<RoleplayStartedDto> {
    assertRoleplay(access);
    await this.gemini(); // 503 before touching the quota
    const limit = access.roleplayDailyLimit;
    const used = await this.todayCount(access.tokenId);
    if (
      limit !== null &&
      (used >= limit ||
        (await this.startedToday(access.tokenId)) >=
          Math.max(limit, 1) * STARTS_FACTOR)
    )
      throw this.quotaExceeded();
    const session = await this.prisma.roleplaySession.create({
      data: {
        accessTokenId: access.tokenId,
        day: jakartaDay(),
        scenarioId: dto.scenarioId,
        context: { ...dto.context },
        maxTurns: turnsOfMode(dto.mode),
      },
    });
    try {
      const raw = await this.generate(
        turnInstruction(dto.context),
        toContents([]),
        TURN_SCHEMA,
        { thinking: TURN_THINKING, timeoutMs: TURN_TIMEOUT_MS, max: 1024 },
      );
      const turn = parseTurn(raw, dto.context.steps.length, []);
      return new RoleplayStartedDto({
        id: session.id,
        reply: turn.reply,
        remaining: limit === null ? null : Math.max(0, limit - used),
        mode: dto.mode ?? 'penuh',
        maxTurns: turnsOfMode(dto.mode),
      });
    } catch (err) {
      await this.prisma.roleplaySession
        .delete({ where: { id: session.id } })
        .catch(() => undefined);
      throw this.aiFailed(err);
    }
  }

  private async owned(
    access: AccessContext,
    id: string,
  ): Promise<RoleplaySession & { ctx: RoleplayContextDto }> {
    assertRoleplay(access);
    const s = await this.prisma.roleplaySession.findUnique({ where: { id } });
    if (!s || s.accessTokenId !== access.tokenId) {
      throw new NotFoundException({
        field: 'id',
        message: 'roleplay_session_not_found',
      });
    }
    return { ...s, ctx: s.context as unknown as RoleplayContextDto };
  }

  private assertOpen(s: RoleplaySession) {
    if (s.endedAt) {
      throw new ConflictException({ field: '', message: 'roleplay_ended' });
    }
    if (Date.now() - s.startedAt.getTime() > SESSION_MAX_MS) {
      throw fail('roleplay_session_expired');
    }
  }

  // One learner turn. Nothing is saved unless Gemini answered, so a failed
  // turn can simply be sent again with the same transcript.
  async turn(
    access: AccessContext,
    id: string,
    dto: TranscriptDto,
  ): Promise<RoleplayTurnDto> {
    const s = await this.owned(access, id);
    this.assertOpen(s);
    const last = dto.transcript[dto.transcript.length - 1];
    if (last.role !== 'user') throw fail('roleplay_bad_turn');
    // Counted here, not from the transcript the client sends (which it could
    // trim). A failed turn isn't saved, so sending it again isn't counted twice.
    const userTurns = s.userTurns + 1;
    if (userTurns > s.maxTurns) throw fail('roleplay_turn_limit');
    // Reaching QUOTA_TURNS takes the session off today's quota.
    const limit = access.roleplayDailyLimit;
    if (
      limit !== null &&
      s.userTurns < QUOTA_TURNS &&
      userTurns >= QUOTA_TURNS &&
      (await this.todayCount(access.tokenId, s.id)) >= limit
    )
      throw this.quotaExceeded();

    let turn: ReturnType<typeof parseTurn>;
    try {
      const raw = await this.generate(
        turnInstruction(s.ctx),
        toContents(dto.transcript),
        TURN_SCHEMA,
        { thinking: TURN_THINKING, timeoutMs: TURN_TIMEOUT_MS, max: 1024 },
      );
      turn = parseTurn(raw, s.ctx.steps.length, s.stepsDone);
    } catch (err) {
      throw this.aiFailed(err);
    }
    await this.prisma.roleplaySession.update({
      where: { id },
      data: { stepsDone: turn.stepsDone, userTurns },
    });
    return new RoleplayTurnDto({
      ...turn,
      userTurns,
      turnsLeft: s.maxTurns - userTurns,
    });
  }

  // "Bantu aku": two short lines the learner could say next.
  async help(
    access: AccessContext,
    id: string,
    dto: TranscriptDto,
  ): Promise<RoleplayHelpDto> {
    const s = await this.owned(access, id);
    this.assertOpen(s);
    if (!(await this.take(id, 'helpCount', MAX_HELP)))
      throw fail('roleplay_help_limit');
    let suggestions: ReturnType<typeof parseHelp>;
    try {
      const raw = await this.generate(
        helpInstruction(s.ctx),
        [{ role: 'user', parts: [{ text: transcriptText(dto.transcript) }] }],
        HELP_SCHEMA,
        { thinking: TURN_THINKING, timeoutMs: TURN_TIMEOUT_MS, max: 512 },
      );
      suggestions = parseHelp(raw);
    } catch (err) {
      await this.giveBack(id, 'helpCount');
      throw this.aiFailed(err);
    }
    return new RoleplayHelpDto({
      suggestions,
      helpLeft: MAX_HELP - s.helpCount - 1,
    });
  }

  // Writes down one spoken answer (the mic in Main peran) with the
  // self-hosted faster-whisper service, verbatim: the learner's mistakes are
  // kept for the end-of-session review. Not saved anywhere: the text goes
  // back to the answer box, where the learner can still fix it.
  async transcribe(
    access: AccessContext,
    id: string,
    file: UploadedAudio | undefined,
    dto: TranscribeDto,
  ): Promise<RoleplayTranscriptionDto> {
    const s = await this.owned(access, id);
    this.assertOpen(s);
    if (!file) {
      throw new UnprocessableEntityException({
        field: 'audio',
        message: 'stt_no_speech',
      });
    }
    this.stt.assertRate(access.tokenId);
    if (!(await this.take(id, 'transcribeCount', MAX_TRANSCRIBE))) {
      throw fail('roleplay_transcribe_limit');
    }
    let result: Awaited<ReturnType<SttService['transcribe']>>;
    try {
      result = await this.stt.transcribe(file, dto.language ?? 'en');
    } catch (err) {
      await this.giveBack(id, 'transcribeCount');
      throw err;
    }
    return new RoleplayTranscriptionDto({
      text: result.text,
      language: result.language,
      durationSec: result.durationSec,
      transcribeLeft: MAX_TRANSCRIBE - s.transcribeCount - 1,
    });
  }

  // The end-of-session review. May be called again (e.g. the first answer
  // got lost on the way), so the learner never loses a finished session; the
  // duration is capped by the time the server saw it first.
  async finish(
    access: AccessContext,
    id: string,
    dto: FinishRoleplayDto,
  ): Promise<RoleplaySummaryDto> {
    const s = await this.owned(access, id);
    const now = new Date();
    if (now.getTime() - s.startedAt.getTime() > FINISH_MAX_MS) {
      throw fail('roleplay_session_expired');
    }
    const userTurns = userTurnsOf(dto.transcript);
    if (!userTurns) throw fail('roleplay_no_turns');
    if (userTurns > s.maxTurns) throw fail('roleplay_turn_limit');
    if (!(await this.take(id, 'finishCount', MAX_FINISH)))
      throw fail('roleplay_finish_limit');

    let parsed: ReturnType<typeof parseSummary>;
    try {
      const raw = await this.generate(
        summaryInstruction(s.ctx),
        [{ role: 'user', parts: [{ text: transcriptText(dto.transcript) }] }],
        SUMMARY_SCHEMA,
        {
          thinking: SUMMARY_THINKING,
          timeoutMs: SUMMARY_TIMEOUT_MS,
          max: 4096,
        },
      );
      parsed = parseSummary(raw, s.ctx.phrases);
    } catch (err) {
      await this.giveBack(id, 'finishCount');
      throw this.aiFailed(err);
    }

    const endedAt = s.endedAt ?? now;
    const elapsed = Math.floor(
      (endedAt.getTime() - s.startedAt.getTime()) / 1000,
    );
    const durationSec = Math.max(0, Math.min(dto.durationSec, elapsed));
    const stepsComplete = s.stepsDone.length >= s.ctx.steps.length;
    const missionComplete = stepsComplete || parsed.missionComplete;
    const stepsDone = missionComplete
      ? s.ctx.steps.map((_, i) => i)
      : s.stepsDone;
    // Never lower than the server's count: a trimmed transcript must not
    // take the session off today's quota.
    const turns = Math.max(s.userTurns, userTurns);
    await this.prisma.roleplaySession.update({
      where: { id },
      data: {
        endedAt,
        durationSec,
        missionComplete,
        userTurns: turns,
        stepsDone,
      },
    });
    return new RoleplaySummaryDto({
      ...parsed,
      missionComplete,
      durationSec,
      userTurns: turns,
      stepsDone,
      mode: modeOfTurns(s.maxTurns),
    });
  }
}
