-- AlterTable
ALTER TABLE "users" ALTER COLUMN "max_sessions" SET DEFAULT 2;


-- Every existing user starts with the same 2-device limit (it can be changed per user in Users & Roles)
UPDATE "users" SET "max_sessions" = 2 WHERE "max_sessions" IS NULL;
