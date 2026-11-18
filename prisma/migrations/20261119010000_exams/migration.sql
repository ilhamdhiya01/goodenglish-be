-- AlterEnum
ALTER TYPE "ProgressKey" ADD VALUE 'EXAM';

-- AlterTable
ALTER TABLE "access_tokens" ADD COLUMN     "requireExam" BOOLEAN NOT NULL DEFAULT false;

