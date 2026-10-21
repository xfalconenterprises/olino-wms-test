-- Remove legacy module names. Existing users keep equivalent access:
-- ENTRY_GATE / EXIT_GATE become WAREHOUSE, MANAGEMENT becomes ADMINISTRATION.
BEGIN;

UPDATE "users"
SET "modules" = ARRAY(
  SELECT DISTINCT CASE m::text
    WHEN 'ENTRY_GATE' THEN 'WAREHOUSE'
    WHEN 'EXIT_GATE' THEN 'WAREHOUSE'
    WHEN 'MANAGEMENT' THEN 'ADMINISTRATION'
    ELSE m::text
  END
  FROM unnest("modules") AS m
)::"Module"[]
WHERE "modules" && ARRAY['ENTRY_GATE', 'EXIT_GATE', 'MANAGEMENT']::"Module"[];

-- AlterEnum
CREATE TYPE "Module_new" AS ENUM ('PURCHASE', 'WAREHOUSE', 'INVENTORY', 'ADMINISTRATION');
ALTER TABLE "users" ALTER COLUMN "modules" TYPE "Module_new"[] USING ("modules"::text::"Module_new"[]);
ALTER TYPE "Module" RENAME TO "Module_old";
ALTER TYPE "Module_new" RENAME TO "Module";
DROP TYPE "Module_old";

COMMIT;
