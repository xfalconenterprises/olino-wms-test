-- Cost prices for rolls received without a PO (Direct Inward Excel's optional Cost Price column)

-- Excel costs waiting in the Direct Inward draft, by imported line; never sent back to the screen
ALTER TABLE "direct_inward_drafts" ADD COLUMN     "costs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "batch_costs" (
    "batch_id" TEXT NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batch_costs_pkey" PRIMARY KEY ("batch_id")
);

-- AddForeignKey
ALTER TABLE "batch_costs" ADD CONSTRAINT "batch_costs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
