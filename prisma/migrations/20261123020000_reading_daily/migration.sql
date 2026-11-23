-- Bacaan harian: one auto-made text per level and WIB day (weekly texts keep day NULL).
ALTER TABLE "reading_texts" ADD COLUMN IF NOT EXISTS "day" DATE;
CREATE UNIQUE INDEX IF NOT EXISTS "reading_texts_level_day_key" ON "reading_texts"("level", "day");
