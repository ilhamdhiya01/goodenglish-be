-- AlterEnum
ALTER TYPE "Menu" ADD VALUE 'AI';

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_accessTokenId_day_key" ON "ai_usage"("accessTokenId", "day");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
