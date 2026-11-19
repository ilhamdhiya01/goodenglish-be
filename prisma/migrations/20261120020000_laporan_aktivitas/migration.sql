-- "Rencana": append-only activity reports sent by every menu.
CREATE TABLE "laporan_aktivitas" (
    "id" VARCHAR(40) NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "jenis" VARCHAR(40) NOT NULL,
    "menu" VARCHAR(20) NOT NULL,
    "level" "Level",
    "week" INTEGER,
    "day" INTEGER NOT NULL,
    "skor" INTEGER,
    "total" INTEGER,
    "jumlah" INTEGER,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laporan_aktivitas_pkey" PRIMARY KEY ("accessTokenId","id")
);

CREATE INDEX "laporan_aktivitas_accessTokenId_day_idx" ON "laporan_aktivitas"("accessTokenId", "day");

ALTER TABLE "laporan_aktivitas" ADD CONSTRAINT "laporan_aktivitas_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
