import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const logger: Logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.useLogger(logger);
  app.use(cookieParser());
  // A learner's progress documents (e.g. the "known words" map across all
  // levels) can outgrow Express's 100kb default JSON body limit.
  app.useBodyParser('json', { limit: '2mb' });

  // Production serves FE and BE from one origin behind nginx, so CORS only
  // matters for local development (Next dev server on another port).
  app.enableCors({
    origin: configService.getOrThrow<string>('feUrl'),
    credentials: true,
  });

  // nginx/Cloudflare terminate TLS; trust the proxy for req.ip/protocol.
  app.set('trust proxy', 1);

  await app.listen(configService.get<number>('PORT') ?? 3001);
}
void bootstrap();
