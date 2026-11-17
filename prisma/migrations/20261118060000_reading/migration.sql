-- CreateEnum
CREATE TYPE "ReadingStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ReadingSlot" AS ENUM ('A', 'B');

-- AlterEnum
ALTER TYPE "Menu" ADD VALUE 'READING';

-- AlterEnum
ALTER TYPE "ProgressKey" ADD VALUE 'READING';

-- CreateTable
CREATE TABLE "reading_texts" (
    "id" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "week" INTEGER NOT NULL,
    "slot" "ReadingSlot" NOT NULL,
    "status" "ReadingStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "paragraphs" JSONB NOT NULL,
    "targetWordsUsed" JSONB NOT NULL,
    "glossary" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdBy" VARCHAR(100),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_meanings" (
    "id" TEXT NOT NULL,
    "word" VARCHAR(60) NOT NULL,
    "level" "Level" NOT NULL,
    "lemma" VARCHAR(60) NOT NULL,
    "meaningId" VARCHAR(200) NOT NULL,
    "pron" VARCHAR(80) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_meanings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reading_texts_level_week_status_idx" ON "reading_texts"("level", "week", "status");

-- CreateIndex
CREATE UNIQUE INDEX "word_meanings_word_level_key" ON "word_meanings"("word", "level");

