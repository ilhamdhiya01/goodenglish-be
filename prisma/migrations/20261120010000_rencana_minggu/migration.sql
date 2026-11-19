-- "Rencana": grammar topic and scenario of each level's week (admin).
CREATE TABLE "rencana_minggu" (
    "level" "Level" NOT NULL,
    "week" INTEGER NOT NULL,
    "scenarioId" VARCHAR(40),
    "grammarTopic" VARCHAR(16),
    "updatedBy" VARCHAR(80) NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rencana_minggu_pkey" PRIMARY KEY ("level","week")
);
