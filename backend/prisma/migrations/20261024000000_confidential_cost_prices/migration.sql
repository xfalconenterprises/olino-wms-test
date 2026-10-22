-- Confidential cost prices: entered on PO lines, kept apart from the line so nothing else reads
-- them, a change log, and the secret code word that prints the cost on roll labels as letters.
-- CreateTable
CREATE TABLE "po_line_costs" (
    "po_line_id" TEXT NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_line_costs_pkey" PRIMARY KEY ("po_line_id")
);

-- CreateTable
CREATE TABLE "cost_price_logs" (
    "id" TEXT NOT NULL,
    "po_id" TEXT,
    "po_number" TEXT,
    "line_label" TEXT NOT NULL,
    "old_price" DECIMAL(12,2),
    "new_price" DECIMAL(12,2),
    "source" TEXT NOT NULL,
    "changed_by_id" TEXT,
    "changed_by_name" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_price_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_code_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "code_word" TEXT NOT NULL,
    "repeat_letter" TEXT,
    "prefix" TEXT,
    "suffix" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_code_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_price_logs_changed_at_idx" ON "cost_price_logs"("changed_at");

-- AddForeignKey
ALTER TABLE "po_line_costs" ADD CONSTRAINT "po_line_costs_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Only one settings row
ALTER TABLE "cost_code_settings" ADD CONSTRAINT "cost_code_settings_single_row" CHECK ("id" = 1);
