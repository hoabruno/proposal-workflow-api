-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REVIEWER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "word" TEXT NOT NULL,
    "normalized_word" TEXT NOT NULL,
    "proposer_name" TEXT,
    "proposer_id" UUID,
    "status" "ProposalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "rejection_reason" TEXT,
    "reviewer_id" UUID,
    "scheduled_for" DATE,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_events" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "actor_id" UUID,
    "from_status" "ProposalStatus",
    "to_status" "ProposalStatus" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_normalized_word_key" ON "proposals"("normalized_word");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_scheduled_for_key" ON "proposals"("scheduled_for");

-- CreateIndex
CREATE INDEX "proposals_status_created_at_idx" ON "proposals"("status", "created_at");

-- CreateIndex
CREATE INDEX "proposal_events_proposal_id_created_at_idx" ON "proposal_events"("proposal_id", "created_at");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
