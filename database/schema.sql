-- =============================================================================
-- Inventory Tracking System — database schema
--
-- Requires MySQL 8.0.16 or later (CHECK constraints are enforced from 8.0.16).
-- Source of truth for the schema; the Spring Boot backend only validates it
-- (spring.jpa.hibernate.ddl-auto=validate).
--
-- Run against an EMPTY database selected on the command line, for example:
--   mysql -u <user> -p --default-character-set=utf8mb4 inventory_db -e "source database/schema.sql"
-- See database/README.md. This file deliberately contains no DROP or TRUNCATE
-- statements: re-running it on a database that already has these tables fails
-- with "table already exists" instead of destroying data.
--
-- Timestamps are DATETIME(6) holding UTC values. The application sets them;
-- there are no MySQL defaults because those depend on the session time zone.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- users: one row per Firebase account (identity = firebase_uid)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    firebase_uid  VARCHAR(128) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'USER',
    created_at    DATETIME(6)  NOT NULL,
    updated_at    DATETIME(6)  NOT NULL,

    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uk_users_firebase_uid UNIQUE (firebase_uid),
    -- utf8mb4_bin makes the check case-sensitive: 'user' is rejected, only 'USER' / 'ADMIN' pass.
    CONSTRAINT chk_users_role CHECK (role COLLATE utf8mb4_bin IN ('USER', 'ADMIN')),

    -- Not unique on purpose: a re-created Firebase account gets a new UID for the same email.
    INDEX idx_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------------------------------
-- categories: name unique, case- and accent-insensitive (utf8mb4_0900_ai_ci)
-- -----------------------------------------------------------------------------
CREATE TABLE categories (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(255) NULL,
    created_at   DATETIME(6)  NOT NULL,
    updated_at   DATETIME(6)  NOT NULL,

    CONSTRAINT pk_categories PRIMARY KEY (id),
    CONSTRAINT uk_categories_name UNIQUE (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------------------------------
-- suppliers: name unique, case- and accent-insensitive (utf8mb4_0900_ai_ci)
-- -----------------------------------------------------------------------------
CREATE TABLE suppliers (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    name            VARCHAR(150) NOT NULL,
    contact_person  VARCHAR(100) NULL,
    email           VARCHAR(255) NULL,
    phone           VARCHAR(30)  NULL,
    address         VARCHAR(255) NULL,
    created_at      DATETIME(6)  NOT NULL,
    updated_at      DATETIME(6)  NOT NULL,

    CONSTRAINT pk_suppliers PRIMARY KEY (id),
    CONSTRAINT uk_suppliers_name UNIQUE (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------------------------------
-- products
--   * quantity changes only through stock IN/OUT (backend); new rows start at 0
--   * "delete" = archive (active = FALSE); archived rows keep their SKU and history
--   * low stock = quantity <= reorder_level (evaluated in queries, not stored)
-- -----------------------------------------------------------------------------
CREATE TABLE products (
    id             BIGINT        NOT NULL AUTO_INCREMENT,
    sku            VARCHAR(50)   NOT NULL,
    name           VARCHAR(150)  NOT NULL,
    description    VARCHAR(500)  NULL,
    category_id    BIGINT        NOT NULL,
    supplier_id    BIGINT        NULL,
    price          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    quantity       BIGINT        NOT NULL DEFAULT 0,
    reorder_level  INT           NOT NULL DEFAULT 0,
    active         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at     DATETIME(6)   NOT NULL,
    updated_at     DATETIME(6)   NOT NULL,

    CONSTRAINT pk_products PRIMARY KEY (id),
    -- Covers archived products too, so an archived product's SKU stays reserved.
    CONSTRAINT uk_products_sku UNIQUE (sku),
    CONSTRAINT chk_products_price_non_negative CHECK (price >= 0),
    CONSTRAINT chk_products_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT chk_products_reorder_level_non_negative CHECK (reorder_level >= 0),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id)
        REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id)
        REFERENCES suppliers (id) ON DELETE RESTRICT ON UPDATE RESTRICT,

    INDEX idx_products_category_id (category_id),
    INDEX idx_products_supplier_id (supplier_id),
    -- Default list: active products ordered by name, id (InnoDB appends id to the index).
    INDEX idx_products_active_name (active, name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;


-- -----------------------------------------------------------------------------
-- stock_transactions: append-only audit trail (no updated_at, never edited/deleted)
--   * quantity       = size of this movement: 1 .. 1,000,000 for IN / OUT;
--                      signed delta (non-zero, +/- 1,000,000) for ADJUST
--   * quantity_after = product stock level immediately after this movement
--   * product name/SKU are read from products at query time (no snapshot columns)
-- -----------------------------------------------------------------------------
CREATE TABLE stock_transactions (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    product_id      BIGINT       NOT NULL,
    user_id         BIGINT       NOT NULL,
    type            VARCHAR(6)   NOT NULL,
    quantity        INT          NOT NULL,
    quantity_after  BIGINT       NOT NULL,
    note            VARCHAR(255) NULL,
    created_at      DATETIME(6)  NOT NULL,

    CONSTRAINT pk_stock_transactions PRIMARY KEY (id),
    -- utf8mb4_bin makes the check case-sensitive: only 'IN' / 'OUT' / 'ADJUST' pass.
    CONSTRAINT chk_stock_transactions_type CHECK (type COLLATE utf8mb4_bin IN ('IN', 'OUT', 'ADJUST')),
    -- Non-zero and bounded. The sign rule per type is in chk_stock_transactions_sign_by_type below.
    CONSTRAINT chk_stock_transactions_quantity_range CHECK (quantity <> 0 AND quantity BETWEEN -1000000 AND 1000000),
    -- IN / OUT are always positive sizes; ADJUST carries the signed delta (non-zero).
    CONSTRAINT chk_stock_transactions_sign_by_type CHECK ((type COLLATE utf8mb4_bin = 'ADJUST' AND quantity <> 0) OR (type COLLATE utf8mb4_bin IN ('IN', 'OUT') AND quantity > 0)),
    CONSTRAINT chk_stock_transactions_quantity_after_non_negative CHECK (quantity_after >= 0),
    CONSTRAINT fk_stock_transactions_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_stock_transactions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,

    -- Product history: WHERE product_id = ? ORDER BY created_at DESC, id DESC.
    -- Also serves as the index for fk_stock_transactions_product (leftmost column).
    INDEX idx_stock_transactions_product_created (product_id, created_at),
    -- Global history / dashboard: ORDER BY created_at DESC, id DESC.
    INDEX idx_stock_transactions_created (created_at),
    INDEX idx_stock_transactions_type_created (type, created_at),
    INDEX idx_stock_transactions_user_id (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
