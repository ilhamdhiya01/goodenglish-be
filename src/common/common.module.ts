import { Global, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import configuration from '../config/configuration';
import { validationSchema } from '../config/validation.schema';
import { EncryptionService } from './encryption/encryption.service';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  imports: [
    WinstonModule.forRoot({
      format: winston.format.json(),
      transports: [
        // LOG_LEVEL is read straight from the environment rather than
        // ConfigService: this module is what *provides* ConfigModule, so
        // nothing injectable exists yet at this point.
        new winston.transports.Console({
          level: process.env.LOG_LEVEL ?? 'info',
        }),
      ],
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: validationSchema,
      load: [configuration],
    }),
  ],
  providers: [
    PrismaService,
    EncryptionService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    },
  ],
  exports: [PrismaService, EncryptionService, WinstonModule, ConfigModule],
})
export class CommonModule {}
