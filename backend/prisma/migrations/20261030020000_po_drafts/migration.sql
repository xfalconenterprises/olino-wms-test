-- Unfinished purchase orders, private to the person who made them
CREATE TABLE "po_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "costs" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "po_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "po_drafts_user_id_updated_at_idx" ON "po_drafts"("user_id", "updated_at");

ALTER TABLE "po_drafts" ADD CONSTRAINT "po_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
