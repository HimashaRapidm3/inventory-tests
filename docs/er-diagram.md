# Entity-Relationship Diagram

Source of truth: [`database/schema.sql`](../database/schema.sql). This diagram is a summary; if the two ever disagree, the schema wins.

```mermaid
erDiagram
    CATEGORIES ||--o{ PRODUCTS : "groups (required)"
    SUPPLIERS |o--o{ PRODUCTS : "supplies (optional)"
    PRODUCTS ||--o{ STOCK_TRANSACTIONS : "has movements"
    USERS ||--o{ STOCK_TRANSACTIONS : "records"

    USERS {
        BIGINT id PK
        VARCHAR firebase_uid UK "one row per Firebase account"
        VARCHAR email "indexed, not unique"
        VARCHAR display_name
        VARCHAR role "USER or ADMIN"
        DATETIME created_at "UTC"
        DATETIME updated_at "UTC"
    }

    CATEGORIES {
        BIGINT id PK
        VARCHAR name UK "case and accent insensitive"
        VARCHAR description
        DATETIME created_at "UTC"
        DATETIME updated_at "UTC"
    }

    SUPPLIERS {
        BIGINT id PK
        VARCHAR name UK "case and accent insensitive"
        VARCHAR contact_person
        VARCHAR email
        VARCHAR phone
        VARCHAR address
        DATETIME created_at "UTC"
        DATETIME updated_at "UTC"
    }

    PRODUCTS {
        BIGINT id PK
        VARCHAR sku UK "reserved even when archived"
        VARCHAR name
        VARCHAR description
        BIGINT category_id FK "required"
        BIGINT supplier_id FK "nullable"
        DECIMAL price "DECIMAL(12,2), >= 0"
        BIGINT quantity "CHECK >= 0"
        INT reorder_level "CHECK >= 0"
        BOOLEAN active "false = archived"
        DATETIME created_at "UTC"
        DATETIME updated_at "UTC"
    }

    STOCK_TRANSACTIONS {
        BIGINT id PK
        BIGINT product_id FK
        BIGINT user_id FK
        VARCHAR type "IN, OUT or ADJUST"
        INT quantity "non-zero; IN/OUT 1 to 1,000,000; ADJUST signed"
        BIGINT quantity_after "CHECK >= 0"
        VARCHAR note "max 255"
        DATETIME created_at "UTC, append-only"
    }
```

## Notes

- **Foreign keys:** every foreign key uses `ON DELETE RESTRICT`. Nothing is deleted in cascade, so stock history is never lost.
- **Archive, not delete:** "deleting" a product sets `active = FALSE`. Archived products keep their SKU and their movement history.
- **Quantity:** `products.quantity` changes only through stock movements. `stock_transactions` is append-only, and `quantity_after` records the stock level right after each movement.
- **Low stock:** calculated in queries as `quantity <= reorder_level`, not stored.
- **Timestamps:** all `DATETIME(6)` values hold UTC.
- **ADJUST:** the table above shows the schema after migration `002` (`database/migrations/002_stock_adjustments.sql`). Existing databases must run that migration first; see `database/README.md` section 8b.
