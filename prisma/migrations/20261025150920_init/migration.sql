-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'LEARNER');

-- CreateEnum
CREATE TYPE "Menu" AS ENUM ('PLAN', 'VOCAB', 'REVIEW', 'SCENARIO', 'ERRORS', 'GRAMMAR', 'PRONUNCIATION');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('BEGINNER', 'PRE', 'INTER', 'UPPER');

-- CreateEnum
CREATE TYPE "ProgressKey" AS ENUM ('KNOWN', 'SRS', 'OWN', 'CUSTOM', 'DONE', 'LEVEL', 'WEEKS', 'ASKPRAC', 'PLAN', 'PRACTICE_SESSION', 'FLIP', 'SEARCH_SCOPE');

-- CreateTable
CREATE TABLE "access_tokens" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "tokenPrefix" VARCHAR(16) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'LEARNER',
    "menus" "Menu"[],
    "levels" "Level"[],
    "maxDevices" INTEGER NOT NULL DEFAULT 2,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_sessions" (
    "id" TEXT NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "deviceLabel" VARCHAR(120) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_docs" (
    "id" TEXT NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "key" "ProgressKey" NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_tokens_tokenHash_key" ON "access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "token_sessions_accessTokenId_idx" ON "token_sessions"("accessTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "progress_docs_accessTokenId_key_key" ON "progress_docs"("accessTokenId", "key");

-- AddForeignKey
ALTER TABLE "token_sessions" ADD CONSTRAINT "token_sessions_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_docs" ADD CONSTRAINT "progress_docs_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
