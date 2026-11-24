-- Tanya AI from an Ulang mistake card: the card's right sentence, kept with the question so the thread shows it again.
ALTER TABLE "ai_chat_messages" ADD COLUMN IF NOT EXISTS "card" VARCHAR(600);
