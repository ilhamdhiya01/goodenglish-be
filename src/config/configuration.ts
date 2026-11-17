export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  session: {
    // How long one device stays signed in after redeeming a token. The JWT,
    // the cookie and the TokenSession row all share this lifetime.
    days: Number(process.env.SESSION_DAYS ?? 30),
    // false only for plain-http local development; the VPS sits behind
    // Cloudflare/nginx on https.
    secureCookie: (process.env.COOKIE_SECURE ?? 'true') === 'true',
  },
  feUrl: process.env.FE_URL,
  // 64 hex chars; encrypts secrets stored in the DB (the Gemini API key).
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  ai: {
    // The Gemini key and model are set from Admin › Tanya AI (ai_settings
    // table), not here.
    // Only the default for new tokens; each token keeps its own
    // AccessToken.aiDailyLimit (null = unlimited).
    dailyLimit: Number(process.env.AI_DAILY_LIMIT ?? 30),
  },
  stt: {
    // The faster-whisper container (stt/), reached over the Compose network.
    // Empty = the mic in Main peran answers 503 stt_unavailable.
    url: (process.env.STT_URL ?? '').replace(/\/+$/, ''),
    // Recordings per token per minute, across all sessions.
    ratePerMin: Number(process.env.STT_RATE_PER_MIN ?? 12),
    // A 60 s answer on 2 vCPU can take a while; beyond this → 504.
    timeoutMs: Number(process.env.STT_TIMEOUT_MS ?? 45000),
  },
});
