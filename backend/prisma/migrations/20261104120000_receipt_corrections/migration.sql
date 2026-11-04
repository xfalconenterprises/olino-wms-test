-- Fixing receiving and return mistakes: an undone receipt, the correction history, cancelled returns

-- AlterTable
ALTER TABLE "item_batches" ADD COLUMN "receipt_voided_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customer_returns" ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by_name" TEXT,
ADD COLUMN "cancel_reason" TEXT;

-- AlterTable
ALTER TABLE "supplier_returns" ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by_name" TEXT,
ADD COLUMN "cancel_reason" TEXT;

-- CreateTable
CREATE TABLE "receipt_corrections" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "batch_code" TEXT NOT NULL,
    "grn_id" TEXT,
    "po_line_id" TEXT,
    "kind" TEXT NOT NULL,
    "old_quantity" DOUBLE PRECISION NOT NULL,
    "new_quantity" DOUBLE PRECISION NOT NULL,
    "uom" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_corrections_batch_id_idx" ON "receipt_corrections"("batch_id");

-- CreateIndex
CREATE INDEX "receipt_corrections_grn_id_idx" ON "receipt_corrections"("grn_id");

-- AddForeignKey
ALTER TABLE "receipt_corrections" ADD CONSTRAINT "receipt_corrections_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
