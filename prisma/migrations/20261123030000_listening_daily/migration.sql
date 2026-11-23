-- Menyimak harian: one auto-made dialog and one monolog per level and WIB day (weekly items keep day NULL).
ALTER TABLE "listening_items" ADD COLUMN IF NOT EXISTS "day" DATE;
CREATE UNIQUE INDEX IF NOT EXISTS "listening_items_level_day_type_key" ON "listening_items"("level", "day", "type");
