-- CreateEnum
CREATE TYPE "ListeningStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ListeningType" AS ENUM ('DIALOG', 'MONOLOG');

-- AlterEnum
ALTER TYPE "Menu" ADD VALUE 'LISTENING';

-- AlterEnum
ALTER TYPE "ProgressKey" ADD VALUE 'LISTENING';

-- CreateTable
CREATE TABLE "listening_items" (
    "id" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "week" INTEGER NOT NULL,
    "status" "ListeningStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "ListeningType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "lines" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "createdBy" VARCHAR(100),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listening_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listening_items_level_week_status_idx" ON "listening_items"("level", "week", "status");

