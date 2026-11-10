-- =============================================================================
-- Migration 002: stock ADJUST movements (signed quantity delta)
--
-- Purpose
--   Lets stock_transactions store type 'ADJUST' with a signed quantity
--   (+ adds stock, - removes it). Adds the sign-by-type rule to the database.
--
-- When to run
--   ONCE, on a database built from the ORIGINAL schema.sql (before ADJUST).
--   Requires MySQL 8.0.16 or later.
--   Run it only after you have approved it. The application code that writes
--   ADJUST rows must not be used against a database that has not been migrated.
--
-- Safety
--   * Does not drop or truncate tables, and deletes no rows.
--   * Existing IN / OUT rows already satisfy the new rules (checked in section A).
--   * Each ALTER TABLE statement is atomic. Statement 1 and statement 2 are NOT
--     one transaction, so if statement 2 fails, see "If it stops half-way".
--   * NOT idempotent: running it again fails at statement 1 or 2 (no data is
--     changed by the failed statement).
--
-- How to run (PowerShell, from the repository root, after taking a backup):
--   mysql -u <user> -p --default-character-set=utf8mb4 inventory_db -e "source database/migrations/002_stock_adjustments.sql"
--
-- Rollback
--   There is no automatic rollback. Once ADJUST rows exist, reverting the
--   constraints would require deleting them, which this project never does.
--   The only rollback is restoring the backup taken before the migration.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. Pre-checks (read-only). Review the results BEFORE running statements 1 and 2.
-- -----------------------------------------------------------------------------

-- A1. Version check. Expect exactly these three CHECK constraints (no sign_by_type yet).
SELECT CONSTRAINT_NAME
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stock_transactions'
  AND CONSTRAINT_TYPE = 'CHECK'
ORDER BY CONSTRAINT_NAME;
-- expected: chk_stock_transactions_quantity_after_non_negative,
--           chk_stock_transactions_quantity_range,
--           chk_stock_transactions_type
-- If chk_stock_transactions_sign_by_type is already listed, this migration was
-- applied before. Stop. Do not run statements 1 and 2.

-- A2. Column width. Expect 3 (the value before the migration).
SELECT CHARACTER_MAXIMUM_LENGTH AS type_length
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stock_transactions'
  AND COLUMN_NAME = 'type';
-- expected: 3

-- A3. Existing rows that would violate the NEW rules. Expect 0.
SELECT COUNT(*) AS rows_that_would_fail
FROM stock_transactions
WHERE NOT (
      (type COLLATE utf8mb4_bin IN ('IN', 'OUT') AND quantity BETWEEN 1 AND 1000000)
   OR (type COLLATE utf8mb4_bin = 'ADJUST' AND quantity BETWEEN -1000000 AND 1000000 AND quantity <> 0)
);
-- expected: 0. If it is not 0, stop and investigate. Do not alter data to pass.

-- A4. Baseline row count. Write this number down; the post-check must match it.
SELECT COUNT(*) AS baseline_rows FROM stock_transactions;


-- -----------------------------------------------------------------------------
-- 1. Widen the type column and drop the two old checks that name the values.
--    One ALTER TABLE statement, so the three changes apply together.
-- -----------------------------------------------------------------------------
ALTER TABLE stock_transactions
    MODIFY type VARCHAR(6) NOT NULL,
    DROP CHECK chk_stock_transactions_type,
    DROP CHECK chk_stock_transactions_quantity_range;


-- -----------------------------------------------------------------------------
-- 2. Add the new checks under the same names used by schema.sql.
--    Adding them as a separate statement avoids relying on dropping and
--    re-adding the same name in one ALTER TABLE.
-- -----------------------------------------------------------------------------
ALTER TABLE stock_transactions
    ADD CONSTRAINT chk_stock_transactions_type
        CHECK (type COLLATE utf8mb4_bin IN ('IN', 'OUT', 'ADJUST')),
    ADD CONSTRAINT chk_stock_transactions_quantity_range
        CHECK (quantity <> 0 AND quantity BETWEEN -1000000 AND 1000000),
    ADD CONSTRAINT chk_stock_transactions_sign_by_type
        CHECK ((type COLLATE utf8mb4_bin = 'ADJUST' AND quantity <> 0)
            OR (type COLLATE utf8mb4_bin IN ('IN', 'OUT') AND quantity > 0));


-- -----------------------------------------------------------------------------
-- C. Post-checks. Compare with the expected results.
-- -----------------------------------------------------------------------------

-- C1. Expect 4 CHECK constraints, including chk_stock_transactions_sign_by_type.
SELECT CONSTRAINT_NAME
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stock_transactions'
  AND CONSTRAINT_TYPE = 'CHECK'
ORDER BY CONSTRAINT_NAME;

-- C2. Expect 6 (the new width).
SELECT CHARACTER_MAXIMUM_LENGTH AS type_length
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'stock_transactions'
  AND COLUMN_NAME = 'type';

-- C3. Expect the same number as baseline_rows in A4.
SELECT COUNT(*) AS rows_now FROM stock_transactions;

-- C4. Compare with schema.sql: the table definition should match the new schema.
SHOW CREATE TABLE stock_transactions\G


-- -----------------------------------------------------------------------------
-- If it stops half-way
--   * Fails at statement 1: nothing changed. Fix the cause and run again from A.
--   * Succeeds at statement 1 but fails at statement 2: the table is widened and
--     has no type or quantity check until statement 2 succeeds. Do NOT run
--     statement 1 again. Fix the cause (for example a bad row found in A3), then
--     run only statement 2. If the cause cannot be fixed, restore the backup.
-- -----------------------------------------------------------------------------
