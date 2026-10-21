-- Adds levels to the rack layout: Rack → Bay → Level → Position, coded "A-B1-L1-P1".
-- Existing rack positions become level 1 and their codes gain "L1" (A-B1-P2 → A-B1-L1-P2).

-- DropIndex
DROP INDEX "locations_bayId_position_key";

-- AlterTable
ALTER TABLE "bays" ADD COLUMN     "levels" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "level" INTEGER;

UPDATE "locations" AS l
SET "level" = 1,
    "code" = r."name" || '-B' || b."number" || '-L1-P' || l."position"
FROM "bays" AS b
JOIN "racks" AS r ON r."id" = b."rackId"
WHERE l."bayId" = b."id";

-- CreateIndex
CREATE UNIQUE INDEX "locations_bayId_level_position_key" ON "locations"("bayId", "level", "position");
