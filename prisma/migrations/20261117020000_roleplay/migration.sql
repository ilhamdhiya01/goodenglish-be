-- AlterEnum
ALTER TYPE "Menu" ADD VALUE 'ROLEPLAY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProgressKey" ADD VALUE 'ROLEPLAY';
ALTER TYPE "ProgressKey" ADD VALUE 'MISTAKES';

-- AlterTable
ALTER TABLE "access_tokens" ADD COLUMN     "roleplayDailyLimit" INTEGER DEFAULT 3;

-- CreateTable
CREATE TABLE "roleplay_sessions" (
    "id" TEXT NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "scenarioId" VARCHAR(40) NOT NULL,
    "context" JSONB NOT NULL,
    "stepsDone" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "userTurns" INTEGER NOT NULL DEFAULT 0,
    "helpCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "missionComplete" BOOLEAN,

    CONSTRAINT "roleplay_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roleplay_sessions_accessTokenId_day_idx" ON "roleplay_sessions"("accessTokenId", "day");

-- CreateIndex
CREATE INDEX "roleplay_sessions_accessTokenId_startedAt_idx" ON "roleplay_sessions"("accessTokenId", "startedAt");

-- AddForeignKey
ALTER TABLE "roleplay_sessions" ADD CONSTRAINT "roleplay_sessions_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

