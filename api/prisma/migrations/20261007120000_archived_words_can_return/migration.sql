-- Archived words may be proposed again: uniqueness moves from normalized_word
-- to active_word, which is cleared when a word is archived.

-- DropIndex
DROP INDEX "proposals_normalized_word_key";

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "active_word" TEXT;

-- Backfill: every word not yet archived keeps blocking its duplicates.
UPDATE "proposals" SET "active_word" = "normalized_word" WHERE "status" <> 'ARCHIVED';

-- CreateIndex
CREATE UNIQUE INDEX "proposals_active_word_key" ON "proposals"("active_word");

-- CreateIndex
CREATE INDEX "proposals_normalized_word_idx" ON "proposals"("normalized_word");
