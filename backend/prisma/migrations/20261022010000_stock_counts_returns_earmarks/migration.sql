-- Stock counts, customer and supplier returns, and earmark release details on challan lines (additive only).

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "delivery_challan_lines" ADD COLUMN     "earmark_override" TEXT,
ADD COLUMN     "earmarked_for" TEXT;

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "countNumber" TEXT NOT NULL,
    "scope_label" TEXT NOT NULL,
    "whole_warehouse" BOOLEAN NOT NULL DEFAULT false,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "result_summary" JSONB,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_locations" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "counted_at" TIMESTAMP(3),
    "counted_by_id" TEXT,
    "expected" JSONB,

    CONSTRAINT "stock_count_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_entries" (
    "id" TEXT NOT NULL,
    "count_location_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "dc_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_lines" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "dc_line_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "condition" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "customer_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "supplier_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "remaining_qty" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_countNumber_key" ON "stock_counts"("countNumber");

-- CreateIndex
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");

-- CreateIndex
CREATE INDEX "stock_count_locations_location_id_idx" ON "stock_count_locations"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_locations_count_id_location_id_key" ON "stock_count_locations"("count_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_count_entries_batch_id_idx" ON "stock_count_entries"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_entries_count_location_id_batch_id_key" ON "stock_count_entries"("count_location_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_returnNumber_key" ON "customer_returns"("returnNumber");

-- CreateIndex
CREATE INDEX "customer_returns_dc_id_idx" ON "customer_returns"("dc_id");

-- CreateIndex
CREATE INDEX "customer_return_lines_dc_line_id_idx" ON "customer_return_lines"("dc_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_returnNumber_key" ON "supplier_returns"("returnNumber");

-- CreateIndex
CREATE INDEX "supplier_return_lines_batch_id_idx" ON "supplier_return_lines"("batch_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_locations" ADD CONSTRAINT "stock_count_locations_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_locations" ADD CONSTRAINT "stock_count_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_locations" ADD CONSTRAINT "stock_count_locations_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_count_location_id_fkey" FOREIGN KEY ("count_location_id") REFERENCES "stock_count_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_dc_id_fkey" FOREIGN KEY ("dc_id") REFERENCES "delivery_challans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "customer_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_dc_line_id_fkey" FOREIGN KEY ("dc_line_id") REFERENCES "delivery_challan_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

