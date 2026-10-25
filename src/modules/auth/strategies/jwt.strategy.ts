/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { SessionJwtPayload } from '../../../common/types/access-context';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req: Request) => req.cookies?.session ?? null,
      secretOrKey: configService.getOrThrow<string>('jwt.secret'),
    });
  }

  validate(payload: SessionJwtPayload): SessionJwtPayload {
    if (!payload.sub || !payload.tokenId) {
      throw new UnauthorizedException({
        field: 'session',
        message: 'session_invalid',
      });
    }
    return payload;
  }
}
