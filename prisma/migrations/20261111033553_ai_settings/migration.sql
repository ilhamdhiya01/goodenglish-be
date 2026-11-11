-- CreateTable
CREATE TABLE "ai_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "encryptedKey" TEXT,
    "keyLast4" VARCHAR(4),
    "model" VARCHAR(100) NOT NULL DEFAULT 'gemini-3.6-flash',
    "updatedBy" VARCHAR(100),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);
