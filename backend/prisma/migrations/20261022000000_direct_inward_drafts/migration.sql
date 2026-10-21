-- Per-user drafts for the Direct Inward Desk (additive only).

-- CreateTable
CREATE TABLE "direct_inward_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_inward_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_inward_drafts_user_id_key" ON "direct_inward_drafts"("user_id");

-- AddForeignKey
ALTER TABLE "direct_inward_drafts" ADD CONSTRAINT "direct_inward_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

