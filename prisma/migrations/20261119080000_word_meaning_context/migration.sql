-- Bacaan word meanings per sentence: the same word can mean different things
-- in different sentences. Existing rows keep ctx = '' (no sentence) and stay
-- as the fallback.
ALTER TABLE "word_meanings"
  ADD COLUMN "ctx" VARCHAR(16) NOT NULL DEFAULT '',
  ADD COLUMN "sentence" VARCHAR(400) NOT NULL DEFAULT '',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "word_meanings_word_level_key";

CREATE UNIQUE INDEX "word_meanings_word_level_ctx_key" ON "word_meanings"("word", "level", "ctx");
