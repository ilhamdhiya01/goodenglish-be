import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  // Console transport threshold (CommonModule). 'info' emits PrismaService's
  // per-query log; 'warn' silences it — what the one-shot CLI script uses so
  // its output stays readable.
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  SESSION_DAYS: Joi.number().integer().min(1).max(365).default(30),
  COOKIE_SECURE: Joi.string().valid('true', 'false').default('true'),
  // Only used for CORS in local development, where the FE dev server runs on
  // a different port. In production FE and BE share one origin behind nginx.
  FE_URL: Joi.string().uri().required(),
});
