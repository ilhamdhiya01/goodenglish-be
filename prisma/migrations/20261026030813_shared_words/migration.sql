-- CreateTable
CREATE TABLE "shared_words" (
    "id" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "week" INTEGER NOT NULL,
    "type" VARCHAR(8) NOT NULL,
    "en" VARCHAR(120) NOT NULL,
    "meaning" VARCHAR(300) NOT NULL,
    "pron" VARCHAR(120) NOT NULL DEFAULT '',
    "example" VARCHAR(500) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_words_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_words_level_week_idx" ON "shared_words"("level", "week");
