import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { AccessAuth } from '../../common/decorators/access-auth.decorator';
import { CurrentAccess } from '../../common/decorators/current-access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AccessContext } from '../../common/types/access-context';
import { AuthService } from './auth.service';
import { RedeemTokenDto } from './dto/redeem-token.dto';
import { SessionDto } from './dto/session.dto';

const COOKIE_NAME = 'session';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // SameSite=Lax (not critiq's None): in production the FE and BE share one
  // origin behind nginx (/ → Next, /api/v1 → Nest), and in local dev
  // localhost:3002 → localhost:3001 is still same-site (ports don't count),
  // so the cookie is sent either way without needing cross-site cookies.
  private cookieOptions(maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configService.getOrThrow<boolean>('session.secureCookie'),
      sameSite: 'lax',
      path: '/',
      ...(maxAge ? { maxAge } : {}),
    };
  }

  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token accepted')
  async redeem(
    @Body() dto: RedeemTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { jwt, maxAgeMs, session } = await this.authService.redeem(
      dto.token,
      req.get('user-agent') ?? 'unknown device',
      req.cookies?.[COOKIE_NAME] as string | undefined,
    );
    res.cookie(COOKIE_NAME, jwt, this.cookieOptions(maxAgeMs));
    return session;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @AccessAuth()
  @ResponseMessage('Signed out')
  async logout(
    @CurrentAccess() access: AccessContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    await this.authService.logout(access.sessionId);
    res.clearCookie(COOKIE_NAME, this.cookieOptions());
    return null;
  }

  @Get('me')
  @AccessAuth()
  @ResponseMessage('Session retrieved successfully')
  me(@CurrentAccess() access: AccessContext): SessionDto {
    return this.authService.toSessionDto(access);
  }
}
