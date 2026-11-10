-- The starter admin account was created with a well-known default PIN for badge EMP-0001. Where that
-- PIN was never changed (still waiting for its first-use reset), remove it: the account signs in with
-- its password, and a new PIN can be set in Users & Roles if wanted.
UPDATE "users"
SET "pin_hash" = NULL, "must_reset_pin" = false
WHERE "badge_code" = 'EMP-0001' AND "username" = 'admin' AND "must_reset_pin" = true AND "pin_hash" IS NOT NULL;
