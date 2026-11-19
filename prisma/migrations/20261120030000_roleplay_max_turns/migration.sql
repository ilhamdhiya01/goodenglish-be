-- Main peran: short practice (6 turns) next to the full session (12).
-- IF NOT EXISTS: a database that already has the column keeps it.
ALTER TABLE "roleplay_sessions" ADD COLUMN IF NOT EXISTS "maxTurns" INTEGER NOT NULL DEFAULT 12;
