-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Module" AS ENUM ('PURCHASE', 'WAREHOUSE', 'INVENTORY', 'ADMINISTRATION');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('IN_STOCK', 'PARTIALLY_USED', 'OUT', 'QC_HOLD');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('BAY', 'FLOOR');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'PARTIAL_CUT', 'INTERNAL_TRANSFER');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryChallanStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GrnStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "badge_code" TEXT,
    "pin_hash" TEXT,
    "modules" "Module"[],
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "must_reset_password" BOOLEAN NOT NULL DEFAULT true,
    "must_reset_pin" BOOLEAN NOT NULL DEFAULT true,
    "sessions_valid_from" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_inward_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_inward_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "racks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bays" (
    "id" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "levels" INTEGER NOT NULL DEFAULT 1,
    "positions" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "bayId" TEXT,
    "level" INTEGER,
    "position" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_batches" (
    "id" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'FABRIC',
    "category" TEXT,
    "brand" TEXT,
    "quality" TEXT,
    "quality_name" TEXT,
    "shade" TEXT,
    "size" TEXT,
    "name" TEXT,
    "artNo" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'METERS',
    "quantity" DOUBLE PRECISION NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'IN_STOCK',
    "poLineId" TEXT,
    "supplierBundle" TEXT,
    "invoiceRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "grnId" TEXT,
    "client_id" TEXT,
    "receipt_voided_at" TIMESTAMP(3),
    "client_name" TEXT,

    CONSTRAINT "item_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "quantityMoved" DOUBLE PRECISION NOT NULL,
    "previousQuantity" DOUBLE PRECISION,
    "newQuantity" DOUBLE PRECISION,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "operatorId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplier_id" TEXT,
    "supplierName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PENDING',
    "targetClient" TEXT,
    "notes" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'FABRIC',
    "category" TEXT,
    "brand" TEXT,
    "quality" TEXT,
    "quality_name" TEXT,
    "shade" TEXT,
    "size" TEXT,
    "name" TEXT,
    "artNo" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'METERS',
    "orderedQty" DOUBLE PRECISION NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "po_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "costs" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "po_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_line_costs" (
    "po_line_id" TEXT NOT NULL,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_line_costs_pkey" PRIMARY KEY ("po_line_id")
);

-- CreateTable
CREATE TABLE "export_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "columns" JSONB,
    "choice" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_logs_pkey" PRIMARY KEY ("id")
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
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_code_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_line_allocations" (
    "id" TEXT NOT NULL,
    "po_line_id" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT NOT NULL,
    "allocated_qty" DOUBLE PRECISION NOT NULL,
    "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_line_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_locations" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL,

    CONSTRAINT "batch_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_type" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_challans" (
    "id" TEXT NOT NULL,
    "challanNumber" TEXT NOT NULL,
    "customer_id" TEXT,
    "customerName" TEXT NOT NULL,
    "destination" TEXT,
    "status" "DeliveryChallanStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_challans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_challan_lines" (
    "id" TEXT NOT NULL,
    "dcId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "isPartialCut" BOOLEAN NOT NULL DEFAULT false,
    "cutReference" TEXT,
    "earmarked_for" TEXT,
    "earmark_override" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_challan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_discrepancies" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceRef" TEXT,
    "po_id" TEXT,
    "po_line_id" TEXT,
    "bundleNumber" TEXT NOT NULL,
    "itemType" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "quality" TEXT,
    "quality_name" TEXT,
    "shade" TEXT,
    "size" TEXT,
    "name" TEXT,
    "artNo" TEXT,
    "uom" TEXT,
    "issueType" TEXT NOT NULL,
    "expectedQty" DOUBLE PRECISION,
    "receivedQty" DOUBLE PRECISION DEFAULT 0,
    "notes" TEXT,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grnId" TEXT,

    CONSTRAINT "inbound_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_attributes" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_notes" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "poId" TEXT,
    "poNumber" TEXT,
    "invoiceRef" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "totalRolls" INTEGER NOT NULL DEFAULT 0,
    "totalQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "GrnStatus" NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "receivedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_note_lines" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "poLineId" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'FABRIC',
    "brand" TEXT,
    "quality" TEXT,
    "quality_name" TEXT,
    "shade" TEXT,
    "category" TEXT,
    "size" TEXT,
    "name" TEXT,
    "artNo" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'METERS',
    "invoicedQty" DOUBLE PRECISION,
    "receivedQty" DOUBLE PRECISION NOT NULL,
    "shortageQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rollsCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_note_lines_pkey" PRIMARY KEY ("id")
);

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
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
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
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
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
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_badge_code_key" ON "users"("badge_code");

-- CreateIndex
CREATE UNIQUE INDEX "direct_inward_drafts_user_id_key" ON "direct_inward_drafts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "racks_name_key" ON "racks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bays_rackId_number_key" ON "bays"("rackId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_bayId_level_position_key" ON "locations"("bayId", "level", "position");

-- CreateIndex
CREATE UNIQUE INDEX "item_batches_batchCode_key" ON "item_batches"("batchCode");

-- CreateIndex
CREATE INDEX "item_batches_status_quantity_idx" ON "item_batches"("status", "quantity");

-- CreateIndex
CREATE INDEX "item_batches_itemType_status_idx" ON "item_batches"("itemType", "status");

-- CreateIndex
CREATE INDEX "item_batches_brand_quality_shade_idx" ON "item_batches"("brand", "quality", "shade");

-- CreateIndex
CREATE INDEX "item_batches_createdAt_idx" ON "item_batches"("createdAt");

-- CreateIndex
CREATE INDEX "item_batches_client_id_idx" ON "item_batches"("client_id");

-- CreateIndex
CREATE INDEX "item_batches_poLineId_idx" ON "item_batches"("poLineId");

-- CreateIndex
CREATE INDEX "item_batches_grnId_idx" ON "item_batches"("grnId");

-- CreateIndex
CREATE INDEX "transactions_batchId_createdAt_idx" ON "transactions"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");

-- CreateIndex
CREATE INDEX "receipt_corrections_batch_id_idx" ON "receipt_corrections"("batch_id");

-- CreateIndex
CREATE INDEX "receipt_corrections_grn_id_idx" ON "receipt_corrections"("grn_id");

-- CreateIndex
CREATE INDEX "po_drafts_user_id_updated_at_idx" ON "po_drafts"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "export_logs_created_at_idx" ON "export_logs"("created_at");

-- CreateIndex
CREATE INDEX "export_logs_user_id_view_created_at_idx" ON "export_logs"("user_id", "view", "created_at");

-- CreateIndex
CREATE INDEX "cost_price_logs_changed_at_idx" ON "cost_price_logs"("changed_at");

-- CreateIndex
CREATE INDEX "batch_locations_batchId_idx" ON "batch_locations"("batchId");

-- CreateIndex
CREATE INDEX "batch_locations_locationId_idx" ON "batch_locations"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "batch_locations_batchId_locationId_key" ON "batch_locations"("batchId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_challans_challanNumber_key" ON "delivery_challans"("challanNumber");

-- CreateIndex
CREATE INDEX "inbound_discrepancies_supplierId_grnId_idx" ON "inbound_discrepancies"("supplierId", "grnId");

-- CreateIndex
CREATE INDEX "inbound_discrepancies_po_id_idx" ON "inbound_discrepancies"("po_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_attributes_type_value_key" ON "master_attributes"("type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_notes_grnNumber_key" ON "goods_receipt_notes"("grnNumber");

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
ALTER TABLE "direct_inward_drafts" ADD CONSTRAINT "direct_inward_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bays" ADD CONSTRAINT "bays_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "bays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_corrections" ADD CONSTRAINT "receipt_corrections_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_drafts" ADD CONSTRAINT "po_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_costs" ADD CONSTRAINT "po_line_costs_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_allocations" ADD CONSTRAINT "po_line_allocations_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_allocations" ADD CONSTRAINT "po_line_allocations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_locations" ADD CONSTRAINT "batch_locations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_locations" ADD CONSTRAINT "batch_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_locations" ADD CONSTRAINT "batch_locations_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_dcId_fkey" FOREIGN KEY ("dcId") REFERENCES "delivery_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_lines" ADD CONSTRAINT "delivery_challan_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_note_lines" ADD CONSTRAINT "goods_receipt_note_lines_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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


-- Only one cost code settings row
ALTER TABLE "cost_code_settings" ADD CONSTRAINT "cost_code_settings_single_row" CHECK ("id" = 1);

-- Fabric types; Knits are measured in kilograms
INSERT INTO "master_attributes" ("id", "type", "value", "unit", "usageCount", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'SUITING', 'METERS', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'SHIRTING', 'METERS', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'PLAIN_SHIRTING', 'METERS', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'KNITS', 'KG', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'OTHER', 'METERS', 0, now(), now());
