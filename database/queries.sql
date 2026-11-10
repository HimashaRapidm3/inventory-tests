-- =============================================================================
-- Inventory Tracking System — example queries (read-only)
--
-- These mirror what the future backend will ask the database. Only SELECT
-- statements and session-variable assignments (SET @...) appear here; nothing
-- modifies data.
--
-- Rules reflected below (see the design specification):
--   * Product lists and dashboard figures use ACTIVE products only (active = TRUE).
--   * Transaction history includes transactions of ARCHIVED products.
--   * Low stock means quantity <= reorder_level.
--   * Paged/ordered results always end with id for deterministic ordering.
--   * History shows each product's CURRENT name and SKU (no snapshot columns).
--   * ADJUST quantity is a signed delta; IN and OUT quantities are positive.
--   * Date ranges: from is inclusive, to is exclusive (from <= created_at < to), UTC.
--
-- Run all of them:
--   mysql -u <user> -p --default-character-set=utf8mb4 inventory_db -e "source database/queries.sql"
-- or copy a single query into a MySQL client.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Parameters used by the queries below. Change them to try other values.
--
-- IDs are never hardcoded: AUTO_INCREMENT values differ between databases, so
-- each ID is looked up from a UNIQUE column (category name, supplier name,
-- product SKU) using sample values from seed.sql. A unique column matches at
-- most one row, so the lookup can never pick an unrelated record. If the value
-- does not exist, the ID stays NULL, the check below reports MISSING, and the
-- queries that use it return no rows.
-- -----------------------------------------------------------------------------
SET @search           = 'mouse';                      -- product name or SKU fragment
SET @category_name    = 'Electronics';                -- categories.name (unique)
SET @supplier_name    = 'Northwind Electronics Ltd';  -- suppliers.name (unique)
SET @product_sku      = 'ELEC-001';                   -- products.sku (unique)
SET @transaction_type = 'IN';                         -- 'IN' or 'OUT'
SET @from_utc         = '2026-01-01 00:00:00.000000'; -- inclusive
SET @to_utc           = '2027-01-01 00:00:00.000000'; -- exclusive

SET @category_id = (SELECT id FROM categories WHERE name = @category_name);
SET @supplier_id = (SELECT id FROM suppliers  WHERE name = @supplier_name);
SET @product_id  = (SELECT id FROM products   WHERE sku  = @product_sku);

-- 0. Lookup check: shows which ID each sample value resolved to.
--    MISSING means the value is not in this database (for example, seed.sql
--    has not been run); queries 4, 5 and 8 will then return no rows.
SELECT 'category' AS lookup, @category_name AS sample_value, @category_id AS resolved_id,
       IF(@category_id IS NULL, 'MISSING - run seed.sql or change the value', 'ok') AS status
UNION ALL
SELECT 'supplier', @supplier_name, @supplier_id,
       IF(@supplier_id IS NULL, 'MISSING - run seed.sql or change the value', 'ok')
UNION ALL
SELECT 'product', @product_sku, @product_id,
       IF(@product_id IS NULL, 'MISSING - run seed.sql or change the value', 'ok');


-- 1. Active products with their category and (optional) supplier
SELECT p.id, p.sku, p.name, c.name AS category, s.name AS supplier,
       p.price, p.quantity, p.reorder_level,
       (p.quantity <= p.reorder_level) AS low_stock
FROM products p
JOIN categories c     ON c.id = p.category_id
LEFT JOIN suppliers s ON s.id = p.supplier_id
WHERE p.active = TRUE
ORDER BY p.name ASC, p.id ASC;


-- 2. Search active products by name or SKU (contains; case-insensitive via the column collation)
--    The backend must escape % and _ in user input before building the pattern.
SELECT p.id, p.sku, p.name, p.quantity
FROM products p
WHERE p.active = TRUE
  AND (p.name LIKE CONCAT('%', @search, '%') OR p.sku LIKE CONCAT('%', @search, '%'))
ORDER BY p.name ASC, p.id ASC;


-- 3. Low-stock active products (quantity <= reorder_level)
SELECT p.id, p.sku, p.name, p.quantity, p.reorder_level
FROM products p
WHERE p.active = TRUE
  AND p.quantity <= p.reorder_level
ORDER BY p.quantity ASC, p.name ASC, p.id ASC;


-- 4. Active products in a category (@category_id, looked up from @category_name)
SELECT p.id, p.sku, p.name, p.quantity
FROM products p
WHERE p.active = TRUE
  AND p.category_id = @category_id
ORDER BY p.name ASC, p.id ASC;


-- 5. Active products from a supplier (@supplier_id, looked up from @supplier_name)
SELECT p.id, p.sku, p.name, p.quantity
FROM products p
WHERE p.active = TRUE
  AND p.supplier_id = @supplier_id
ORDER BY p.name ASC, p.id ASC;


-- 6. Product count per category, INCLUDING archived products
--    (archived products still reference the category and block its deletion)
SELECT c.id, c.name, COUNT(p.id) AS product_count
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
GROUP BY c.id, c.name
ORDER BY c.name ASC;


-- 7. Product count per supplier, INCLUDING archived products
SELECT s.id, s.name, COUNT(p.id) AS product_count
FROM suppliers s
LEFT JOIN products p ON p.supplier_id = s.id
GROUP BY s.id, s.name
ORDER BY s.name ASC;


-- 8. Stock transactions for one product (@product_id, looked up from @product_sku;
--    works for archived products too)
SELECT t.id, t.type, t.quantity, t.quantity_after, t.note, t.created_at,
       COALESCE(u.display_name, u.email) AS performed_by
FROM stock_transactions t
JOIN users u ON u.id = t.user_id
WHERE t.product_id = @product_id
ORDER BY t.created_at DESC, t.id DESC;


-- 9. Recent stock transactions with product and user details, within a date range
--    (from inclusive, to exclusive; archived products included)
SELECT t.id, t.type, t.quantity, t.quantity_after, t.note, t.created_at,
       p.sku, p.name AS product_name, p.active AS product_active,
       COALESCE(u.display_name, u.email) AS performed_by
FROM stock_transactions t
JOIN products p ON p.id = t.product_id
JOIN users u    ON u.id = t.user_id
WHERE t.created_at >= @from_utc
  AND t.created_at <  @to_utc
ORDER BY t.created_at DESC, t.id DESC
LIMIT 20 OFFSET 0;


-- 10. Stock history filtered by type (IN, OUT, or ADJUST), archived products included
SELECT t.id, t.type, t.quantity, t.quantity_after, t.created_at,
       p.sku, p.name AS product_name
FROM stock_transactions t
JOIN products p ON p.id = t.product_id
WHERE t.type = @transaction_type
ORDER BY t.created_at DESC, t.id DESC;


-- 11. Dashboard: total active products and total stock quantity
SELECT COUNT(*) AS total_products,
       COALESCE(SUM(p.quantity), 0) AS total_stock_quantity
FROM products p
WHERE p.active = TRUE;


-- 12. Dashboard: low-stock product count (active only)
SELECT COUNT(*) AS low_stock_count
FROM products p
WHERE p.active = TRUE
  AND p.quantity <= p.reorder_level;


-- 13. Dashboard: latest 10 stock transactions
SELECT t.id, t.type, t.quantity, t.quantity_after, t.created_at,
       p.sku, p.name AS product_name,
       COALESCE(u.display_name, u.email) AS performed_by
FROM stock_transactions t
JOIN products p ON p.id = t.product_id
JOIN users u    ON u.id = t.user_id
ORDER BY t.created_at DESC, t.id DESC
LIMIT 10;


-- 14. Dashboard chart: stock quantity and value per category (active products only)
SELECT c.name AS category,
       COALESCE(SUM(p.quantity), 0)           AS total_quantity,
       COALESCE(SUM(p.quantity * p.price), 0) AS total_value
FROM categories c
LEFT JOIN products p ON p.category_id = c.id AND p.active = TRUE
GROUP BY c.id, c.name
ORDER BY c.name ASC;


-- 15. Stock movement counts per user
SELECT u.id, COALESCE(u.display_name, u.email) AS user_name,
       SUM(t.type = 'IN')  AS stock_in_count,
       SUM(t.type = 'OUT') AS stock_out_count,
       COUNT(t.id)         AS total_movements
FROM users u
JOIN stock_transactions t ON t.user_id = u.id
GROUP BY u.id, u.display_name, u.email
ORDER BY total_movements DESC, u.id ASC;


-- 16. Movement totals by type: event count, moved units, and signed stock delta.
--     IN adds quantity, OUT subtracts quantity, and ADJUST is already signed.
SELECT t.type,
       COUNT(*) AS movement_count,
       SUM(ABS(t.quantity)) AS units_moved,
       SUM(CASE
               WHEN t.type = 'IN' THEN t.quantity
               WHEN t.type = 'OUT' THEN -t.quantity
               ELSE t.quantity
           END) AS net_stock_delta
FROM stock_transactions t
GROUP BY t.type
ORDER BY t.type;


-- 17. Reconciliation: return products where the movement ledger does not
--     equal products.quantity. A correct result is zero rows.
SELECT p.id, p.sku, p.name, p.quantity AS stored_quantity,
       COALESCE(SUM(CASE
                        WHEN t.type = 'IN' THEN t.quantity
                        WHEN t.type = 'OUT' THEN -t.quantity
                        ELSE t.quantity
                    END), 0) AS movement_quantity
FROM products p
LEFT JOIN stock_transactions t ON t.product_id = p.id
GROUP BY p.id, p.sku, p.name, p.quantity
HAVING p.quantity <> movement_quantity
ORDER BY p.sku;
