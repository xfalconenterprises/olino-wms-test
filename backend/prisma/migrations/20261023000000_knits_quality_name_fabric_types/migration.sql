-- Fabric types become master data (each with its unit: Knits are weighed in kg), an optional
-- Quality Name for fabric, and Stock Count / Returns move under Warehouse operations.

-- AlterTable
ALTER TABLE "goods_receipt_note_lines" ADD COLUMN     "quality_name" TEXT;

-- AlterTable
ALTER TABLE "item_batches" ADD COLUMN     "quality_name" TEXT;

-- AlterTable
ALTER TABLE "master_attributes" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "quality_name" TEXT;


-- Fabric types (existing codes keep working); Knits are measured in kilograms
INSERT INTO "master_attributes" ("id", "type", "value", "unit", "usageCount", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'SUITING', 'METERS', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'SHIRTING', 'METERS', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'PLAIN_SHIRTING', 'METERS', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'KNITS', 'KG', 0, now(), now()),
  (gen_random_uuid()::text, 'FABRIC_CATEGORY', 'OTHER', 'METERS', 0, now(), now())
ON CONFLICT ("type", "value") DO NOTHING;

-- Stock Count and Returns are now Warehouse permissions
UPDATE "users" SET "permissions" = array_replace(array_replace("permissions", 'inv.stock_count', 'ops.stock_count'), 'inv.returns', 'ops.returns')
WHERE "permissions" && ARRAY['inv.stock_count', 'inv.returns'];
