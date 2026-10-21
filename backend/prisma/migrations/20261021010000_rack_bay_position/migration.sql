-- Storage layout becomes Rack → Bay → Position (codes like "A-B1-P1"); aisles, rows and levels go.
-- Stops instead of dropping anything if old aisle/row/bay locations already exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bays") OR EXISTS (SELECT 1 FROM "locations" WHERE "type" = 'BAY') THEN
    RAISE EXCEPTION 'Old aisle/row/bay locations exist. Move their stock and remove them before applying the Rack/Bay/Position layout.';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "bays" DROP CONSTRAINT "bays_rowId_fkey";

-- DropForeignKey
ALTER TABLE "rows" DROP CONSTRAINT "rows_aisleId_fkey";

-- DropIndex
DROP INDEX "bays_rowId_number_key";

-- DropIndex
DROP INDEX "locations_bayId_level_position_key";

-- AlterTable
ALTER TABLE "bays" DROP COLUMN "levels",
DROP COLUMN "rowId",
ADD COLUMN     "rackId" TEXT NOT NULL,
DROP COLUMN "number",
ADD COLUMN     "number" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "locations" DROP COLUMN "level";

-- DropTable
DROP TABLE "aisles";

-- DropTable
DROP TABLE "rows";

-- CreateTable
CREATE TABLE "racks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "racks_name_key" ON "racks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bays_rackId_number_key" ON "bays"("rackId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "locations_bayId_position_key" ON "locations"("bayId", "position");

-- AddForeignKey
ALTER TABLE "bays" ADD CONSTRAINT "bays_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

