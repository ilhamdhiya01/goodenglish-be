-- Main peran: end-of-session summaries fetched per session (each is a Gemini
-- call), capped like "Bantu aku" and the mic.
ALTER TABLE "roleplay_sessions" ADD COLUMN IF NOT EXISTS "finishCount" INTEGER NOT NULL DEFAULT 0;
