# Database Setup — Inventory Tracking System

This folder contains the MySQL database for the Inventory Tracking System.

| File | Purpose |
|---|---|
| `schema.sql` | Creates the 5 tables with keys, constraints and indexes. The single source of truth for the schema. |
| `seed.sql` | Adds fictional demo categories, suppliers, 15 products (all with quantity 0), and IN/OUT history for each product. Safe to run more than once. |
| `queries.sql` | Read-only example queries that mirror what the application will ask the database. |

Entity-relationship diagram (Mermaid, renders on GitHub): [`docs/er-diagram.md`](../docs/er-diagram.md).

Full design rationale: [`docs/superpowers/specs/2026-11-01-inventory-tracking-system-design.md`](../docs/superpowers/specs/2026-11-01-inventory-tracking-system-design.md), Section 5.

---

## 1. Requirements

- **MySQL 8.0.16 or later.** Earlier versions parse `CHECK` constraints but silently ignore them.
- The MySQL server must be running (on Windows: service `MySQL80` in *Services*).
- The `mysql` command-line client on your `PATH` (it is in `C:\Program Files\MySQL\MySQL Server 8.0\bin`).

Check your version in PowerShell:

```powershell
mysql --version
```

All commands below are run in **PowerShell from the repository root**. `-p` makes MySQL **prompt** for your password — never type a password directly into a command, script or file in this repository.

> **Tip (optional): avoid retyping your password.** MySQL can store your login outside the repository, in `%APPDATA%\MySQL\.mylogin.cnf`:
> ```powershell
> mysql_config_editor set --login-path=inventory --host=localhost --user=root --password
> ```
> Afterwards replace `-u root -p` with `--login-path=inventory` in the commands below. The file is obfuscated, not encrypted, so only use this on your own machine.

> **PowerShell note:** PowerShell does not support `mysql ... < file.sql`. Use `-e "source path/to/file.sql"` as shown below.

---

## 2. Development and test databases

| Database | Used for | Who uses it |
|---|---|---|
| `inventory_db` | Local development | You, when running the app locally |
| `inventory_test` | Automated integration and end-to-end tests **only** | `mvn test` and Playwright (future phases) |

Rules:

- Never put development data you care about in `inventory_test`; tests will reset it.
- Automated tests must **never** target a production or shared database.
- Any future reset script must check that the database name **ends with `_test`** before running destructive statements. (No reset script exists yet; it will be added with the test setup.)

### Create both databases

Both use the same character set and collation as the tables, so text comparison rules are identical everywhere:

```powershell
mysql -u root -p -e "CREATE DATABASE inventory_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -u root -p -e "CREATE DATABASE inventory_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

If a database already exists, MySQL reports an error and changes nothing.

---

## 3. Create the tables (`schema.sql`)

The database is chosen on the command line, not inside the file, so the same file works for both databases.

```powershell
# Development database
mysql -u root -p --default-character-set=utf8mb4 inventory_db -e "source database/schema.sql"

# Test database
mysql -u root -p --default-character-set=utf8mb4 inventory_test -e "source database/schema.sql"
```

`schema.sql` contains **no `DROP` or `TRUNCATE` statements**. Running it a second time fails with `Table 'users' already exists` — this is intentional, so it can never wipe data.

---

## 4. Add demo data (`seed.sql`)

```powershell
mysql -u root -p --default-character-set=utf8mb4 inventory_db -e "source database/seed.sql"
```

The seed adds 5 categories, 4 suppliers, 15 products, and one demo IN plus one demo OUT movement for each product. The two movements net to zero, so every seeded product still has quantity `0`. It also creates a clearly-labelled fictional `warehouse-demo@example.com` USER row because the movement table requires a user foreign key. This is a seed-only actor, not a Firebase account, and it cannot sign in. The seed deliberately does **not** add:

- **real users or admin accounts** — real user rows are created automatically the first time someone signs in through Firebase; admin access comes from the backend's `APP_SECURITY_ADMIN_EMAILS` setting;

Running it again changes nothing: existing rows (matched by category/supplier name, product SKU, demo Firebase UID, and stable movement notes) are left as they are, including edits you made.

---

## 5. Run the example queries (`queries.sql`)

```powershell
mysql -u root -p --default-character-set=utf8mb4 --table inventory_db -e "source database/queries.sql"
```

Parameters are set at the top of the file; change them to try other values. IDs are never hardcoded: the file looks them up from unique values in `seed.sql` (category name `Electronics`, supplier name `Northwind Electronics Ltd`, product SKU `ELEC-001`), because `AUTO_INCREMENT` IDs are not guaranteed to start at 1. The first result ("lookup check") shows the resolved IDs; `MISSING` means that value is not in the database (for example, `seed.sql` has not been run), and the queries that use it return no rows. The seed creates demo movements for every product, so the history and movement-total queries return sample rows immediately.

---

## 6. Verify the setup

Open an interactive session:

```powershell
mysql -u root -p --default-character-set=utf8mb4 inventory_db
```

Then run:

```sql
-- All five tables exist
SHOW TABLES;
-- expected: categories, products, stock_transactions, suppliers, users

-- Every table uses InnoDB and utf8mb4_0900_ai_ci
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE();

-- Primary keys, unique, check and foreign-key constraints
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, CONSTRAINT_TYPE, CONSTRAINT_NAME;

-- CHECK constraint expressions
SELECT CONSTRAINT_NAME, CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE();

-- Foreign keys and their delete rules (all should be RESTRICT)
SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE();

-- Indexes of one table
SHOW INDEX FROM stock_transactions;

-- Full definition of one table
SHOW CREATE TABLE products\G

-- After seeding: every product has quantity 0
SELECT COUNT(*) AS products, SUM(quantity <> 0) AS non_zero_quantity FROM products;
```

---

## 7. Tables and relationships

```
categories 1 ───< products >─── 0..1 suppliers
                     │
                     1
                     │
users 1 ───< stock_transactions >─── 1 products
```

- **categories → products:** a category has many products; every product **must** have one category.
- **suppliers → products:** a supplier has many products; a product **may** have one supplier (`supplier_id` can be `NULL`).
- **products → stock_transactions:** a product has many stock movements.
- **users → stock_transactions:** a user records many stock movements.

Every foreign key uses `ON DELETE RESTRICT`: MySQL refuses to delete a category, supplier, product or user that is still referenced. Nothing is ever deleted in cascade, so stock history is never lost.

---

## 8. Important constraints

| Rule | How the database enforces it |
|---|---|
| Stock can never be negative | `CHECK (quantity >= 0)` on `products`; `CHECK (quantity_after >= 0)` on `stock_transactions` |
| IN and OUT are 1 to 1,000,000 units; an ADJUST delta is non-zero, between −1,000,000 and +1,000,000 | `CHECK (quantity <> 0 AND quantity BETWEEN -1000000 AND 1000000)` and `chk_stock_transactions_sign_by_type` (IN/OUT positive, ADJUST non-zero) |
| Price is never negative | `CHECK (price >= 0)`, `DECIMAL(12,2)` for exact money values |
| Only valid roles and movement types | `role` must be exactly `USER` or `ADMIN`; `type` exactly `IN`, `OUT` or `ADJUST` (case-sensitive checks) |
| One MySQL user per Firebase account | `UNIQUE (firebase_uid)`. Email is indexed but **not** unique, because a re-created Firebase account gets a new UID for the same email. |
| SKU is unique, even for archived products | `UNIQUE (sku)` over all rows, so an archived product's SKU stays reserved |
| Category and supplier names are unique | `UNIQUE (name)` with collation `utf8mb4_0900_ai_ci`: "Electronics", "electronics" and "ELECTRÓNICS" count as the same name |
| Referenced rows cannot be deleted | Foreign keys with `ON DELETE RESTRICT` |

Rules that live in the **backend** (future phase), not in SQL:

- **"Deleting" a product archives it** (`active = FALSE`). Archived products disappear from lists and the dashboard but keep their SKU and their full stock history.
- **Quantity changes only through Stock IN / Stock OUT / ADJUST.** ADJUST is ADMIN only and needs a non-empty reason (stored in `note`). Creating or editing a product never changes its quantity; new products start at `0`.
- **Low stock** means `quantity <= reorder_level`. It is calculated in queries, not stored.
- **Stock transactions are append-only.** The table has no `updated_at`, and the application offers no way to edit or delete a movement. Each row stores `quantity_after`, the stock level right after that movement, so the history can be checked line by line.
- **History shows the product's current name and SKU**, read from `products` (no copies are stored in `stock_transactions`). Whether a snapshot of the name and SKU at movement time is needed is still pending mentor confirmation (decision D-26 in the spec).

---

## 8b. Migrating an existing database (migration 002: ADJUST)

`schema.sql` describes a **new** database. A database built before ADJUST existed must be changed with the
separate, non-destructive script `database/migrations/002_stock_adjustments.sql`:

- It widens `stock_transactions.type` to `VARCHAR(6)`, replaces the type and quantity CHECKs, and adds `chk_stock_transactions_sign_by_type`.
- It deletes no rows and changes no existing row. Its pre-checks (section A) must pass first.
- It is **not** idempotent and has **no automatic rollback**. Take a `mysqldump` backup before running it.
- Run it only after you have approved it. Do not run the ADJUST backend code against a database that has not been migrated: the old `VARCHAR(3)` column rejects the value `ADJUST`.

The script's header and "If it stops half-way" section describe the exact steps.

## 9. Time zones (UTC)

- All timestamps are `DATETIME(6)` columns holding **UTC** values with microsecond precision.
- `DATETIME` itself stores no time zone, so the rule "always UTC" is applied by whoever writes the value:
  - the backend writes Java `Instant` values through a UTC-configured connection (`connectionTimeZone=UTC`, `hibernate.jdbc.time_zone=UTC`);
  - `seed.sql` uses `UTC_TIMESTAMP(6)`, never `NOW()`, which would use the session time zone.
- There are no `DEFAULT CURRENT_TIMESTAMP` columns for the same reason.
- When inserting rows by hand, use `UTC_TIMESTAMP(6)` for `created_at` and `updated_at`.
- The API returns ISO-8601 UTC timestamps (for example `2026-11-01T09:30:00.123456Z`), and the web app converts them to local time for display.

---

## 10. Pending mentor confirmation

The database implements the design as specified, but several of its rules are proposed decisions that are **not yet confirmed** by the mentor, including:

- soft delete for products (D-05);
- blocking deletion of categories and suppliers that are referenced by archived products (D-06);
- the low-stock rule (D-08);
- category required and supplier optional (D-09);
- price allowed to be `0.00` (D-11);
- `quantity_after` (D-13);
- the 1 to 1,000,000 movement limit (D-15);
- current versus historical product name and SKU in history (D-26).

See Section 10 of the design specification for the full list.

---

## 11. Notes for later phases

### Backend: handling constraint violations (SQLSTATE `23000`)

Database verification showed that MySQL does not always report a foreign-key violation with the same error number. With this project's account it returned `ERROR 1216` (missing parent on insert) and `ERROR 1217` (parent still referenced on delete) rather than the more detailed `1452` / `1451`. The error number depends on the server version and on the connecting account's privileges.

When the Spring Boot backend handles database errors:

- Treat **SQLSTATE class `23000`** (integrity constraint violation) as the signal. It covers foreign-key violations (`1216`, `1217`, `1451`, `1452`) and also duplicate keys (`1062`).
- To tell the cases apart, inspect the SQLSTATE together with the **context**: which operation was running and, where the message includes it, which constraint was hit (for example `uk_products_sku`, `uk_categories_name`, `fk_products_category`).
- Do **not** assume that only `1451` or `1452` will occur for foreign keys.
- Prefer checking business rules in the service layer first (for example "category is still used by products" → `409 RESOURCE_IN_USE`); the database constraint is the safety net.
- Never return raw SQL errors, constraint names, table names or stack traces to API clients. Map them to the documented `ProblemDetail` codes (`DUPLICATE_RESOURCE`, `RESOURCE_IN_USE`, `NOT_FOUND`, or a generic `INTERNAL_ERROR`) and log the details on the server only.

### Frontend: date-range filter on Transaction History

The database queries use `from` inclusive and `to` exclusive (`from <= created_at < to`) on UTC timestamps, and this was verified in SQL. The **date picker has not been tested yet**. The frontend phase must verify:

- **UTC conversion:** dates picked in the browser's local time zone are converted to the correct ISO-8601 UTC instants (for example, local midnight in UTC+05:30 is `18:30:00Z` on the previous day).
- **Inclusive `from`:** a movement at exactly the start of the chosen first day is included.
- **Exclusive `to`:** to include the whole chosen last day, the UI sends the start of the **next** day as `to`; a movement at exactly that instant is excluded.
- **Time-zone boundaries:** movements just before and just after local midnight land on the correct day, including across a UTC date change.
- **Empty and invalid ranges:** equal `from` and `to` returns an empty list (not an error); `from` later than `to` shows the `400 VALIDATION_FAILED` message.
