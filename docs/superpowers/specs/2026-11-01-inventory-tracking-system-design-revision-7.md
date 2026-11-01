# Inventory Tracking System — Design Specification

- **Date:** 2026-11-01
- **Revision:** 7 — final review candidate
- **Status:** Review candidate — awaiting student approval, then mentor review. Pending decisions in Section 10 remain pending.
- **Change history:**
  - Revision 4 — approved by the student (committed in `b9a9c57`).
  - Revision 5 — Spring Boot baseline changed to 4.1.2 (`[T-21]`).
  - Revision 6 — testing strategy aligned with the Backend Implementation Plan: existing `inventory_test` schema, guarded DELETE-only cleanup, Surefire/Failsafe execution (`[T-18]`).
  - Revision 7 — aligned with Backend Implementation Plan Revision 7: dashboard aggregates as `BigInteger` (exact decimal strings), zero-safe chart-width calculation, opaque database IDs (`[T-08]`); matching tests in Section 8; protection of pre-created E2E accounts made explicit.
- **Branch:** `feature/inventory-tracking-setup`
- **Scope:** Full-stack inventory tracking web application (React + Spring Boot + MySQL + Firebase Authentication)

> **How to read this document — source tags**
>
> | Tag | Meaning |
> |---|---|
> | *(no tag)* | Requirement taken from the **original project brief**. |
> | **`[D-xx]`** | **Proposed business/product decision** made during design review. **Pending mentor confirmation.** |
> | **`[T-xx]`** | **Technical design decision or assumption** made during design review. Does not change business behaviour, but is also **open to mentor review**. |
>
> All tagged items are collected in [Section 10](#10-decisions-pending-mentor-confirmation). Where a sentence mixes brief content with a design choice, the tag applies to the design choice.

---

## 1. Purpose and Success Criteria

### 1.1 Purpose
A professional inventory tracking system built as a Software Engineering learning and portfolio project, reviewed by a mentor. It manages products, categories and suppliers, records stock movements, and shows inventory status on a dashboard.

### 1.2 Success criteria
1. Runs locally from IntelliJ IDEA (backend) and VS Code (frontend) by following the README.
2. Firebase authentication can be demonstrated end to end, including USER vs ADMIN behaviour.
3. Stock IN/OUT can be demonstrated, with stock never becoming negative and every change recorded in history.
4. Backend, frontend and end-to-end tests are actually run, with results reported from real output.
5. UI is visually consistent, responsive (desktop, tablet, mobile) and accessible.
6. Architecture, APIs and database design are documented well enough to explain in a technical demonstration.
7. Work is delivered on the feature branch as a mentor-ready Pull Request; nothing is pushed or merged without approval.

### 1.3 Out of scope (unless later requested)
User management UI (promote/demote users), Google Sign-In `[D-20]`, Postman collection publishing, deployment/hosting, CI pipelines, multi-warehouse stock, purchase orders, report export, internationalisation, Firebase Auth Emulator / `firebase-tools`.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React (functional components + hooks), Vite, JavaScript, HTML5, CSS3. Libraries: `react-router-dom`, `firebase` (Auth only), `lucide-react`. Styling with CSS Modules + global design tokens `[T-13]`. |
| Backend | Java 17, **Spring Boot 4.1.2** `[T-21]` (Spring Framework 7, Spring Security 7, Hibernate ORM 7, Jackson 3 — versions managed by Spring Boot), Spring Web MVC, Spring Data JPA, Spring Security, Bean Validation, Firebase Admin SDK 9.x (**9.11.0** selected `[T-21]`), MySQL Connector/J (managed by Spring Boot) |
| Database | MySQL 8 — **8.0.16 or later required** so `CHECK` constraints are enforced. Local install verified: 8.0.45. |
| Authentication | Firebase Authentication — **Email/Password provider only** `[D-20]`; Firebase Admin SDK for backend token verification |
| Testing | Brief: JUnit 5, Spring Boot Test, Playwright. Selected: **JUnit Jupiter 6** (managed by Spring Boot 4.1.2; the successor of JUnit 5 with the same Jupiter programming model) `[T-21]`, Spring Boot Test, Playwright; Mockito, Vitest, React Testing Library, jsdom `[T-17]`. Maven Surefire runs `*Test` classes and Maven Failsafe runs `*IT` classes (Section 8.5) |
| Tooling | Git, GitHub, Maven, npm, IntelliJ IDEA, VS Code, Claude Code |

Exact dependency versions are confirmed against current official documentation during implementation planning, not assumed.

Deliberately **not** used `[T-13]`: axios, Redux, form libraries, chart libraries, UI component frameworks, H2, Testcontainers (Docker is not available locally), Firebase Emulator / `firebase-tools`.

---

## 3. Functional Requirements

### 3.1 Authentication and roles
- **FR-AUTH-1** Register, log in and log out using Firebase Authentication with the Email/Password provider `[D-20]`.
  - Registration form: email, display name (**required**, trimmed, 1–100 characters) `[D-25]`, password (minimum 8 characters) and password confirmation `[D-18]`.
  - Registration sends a Firebase verification email `[D-19]`.
- **FR-AUTH-2** All application pages except Login and Register require authentication (protected routes).
- **FR-AUTH-3** The backend verifies the Firebase ID token on every protected request, **including a revocation check** (`checkRevoked = true`). Invalid, expired, revoked and disabled-user tokens are rejected with 401; Firebase infrastructure failures return 503; unexpected Firebase errors return a generic 500 (classification in [Section 4.3](#43-authentication-and-user-provisioning-flow)) `[T-20]`.
- **FR-AUTH-4** Each Firebase UID maps to exactly one unique internal MySQL `users` record.
- **FR-AUTH-5** The MySQL user record is found or created, and the current role resolved, **during authentication of every protected request**, regardless of which endpoint is called (single flow defined in [Section 4.3](#43-authentication-and-user-provisioning-flow)) `[T-03]`.
- **FR-AUTH-6** Roles are `ADMIN` and `USER`. Permissions `[D-01]`:
  - USER: view products, categories, suppliers, dashboard and transaction history; record Stock IN and Stock OUT.
  - ADMIN: everything a USER can do, plus create, update and delete products, categories and suppliers.
- **FR-AUTH-7** Every new user receives `USER` `[D-02]`.
- **FR-AUTH-8** A user resolves to `ADMIN` only if **both** conditions hold `[D-02][D-03]`:
  1. their email appears in the backend allowlist property `app.security.admin-emails` (environment variable `APP_SECURITY_ADMIN_EMAILS`, comma-separated, compared trimmed and case-insensitively), **and**
  2. the verified Firebase token has `email_verified = true`.
- **FR-AUTH-9** Because the role is resolved on every protected request, removing an email from the allowlist demotes that user to `USER` on their next request `[D-04]`.
- **FR-AUTH-10** Unverified users may use the application with the `USER` role; a dismissible banner reminds them to verify `[D-19]`.
- **FR-AUTH-11** After a user verifies their email, the frontend reloads the Firebase user and force-refreshes the ID token with `getIdToken(true)` before calling `GET /api/auth/me`, so the backend receives the updated `email_verified` claim before ADMIN eligibility is evaluated `[T-03]`.
- **FR-AUTH-12** Admin emails are never hardcoded in source code and never exposed to the frontend.
- **FR-AUTH-13** All authorization is enforced by the backend. Frontend hiding of buttons and routes is for user experience only.

### 3.2 Dashboard
- **FR-DASH-1** Shows total products, total stock quantity, low-stock products, recent stock movements and an inventory/stock overview (brief). Specifically: low-stock count plus the top 5 low-stock products, the latest 10 movements, and a stock-by-category chart `[T-16]`.
- **FR-DASH-2** All dashboard figures include **active products only** `[D-05]`.
- **FR-DASH-3** A product is low stock when `quantity <= reorderLevel` (equality counts as low) `[D-08]`.

### 3.3 Product management
- **FR-PROD-1** Add, view, edit, delete and search products; filter by category. Create/edit/delete are ADMIN-only `[D-01]`.
- **FR-PROD-2** Product fields: SKU, name, price, available quantity, reorder level (brief); description (optional) `[T-17]`; category (**required**) and supplier (**optional**) `[D-09]`.
- **FR-PROD-3** SKU must be unique (brief). It is trimmed, stored uppercase, must match `^[A-Z0-9-]{3,50}$`, and stays unique across all products including archived ones `[D-10]`.
- **FR-PROD-4** Price is stored as `DECIMAL(12,2)` (brief: DECIMAL); it may be `0.00` but never negative `[D-11]`.
- **FR-PROD-5** Quantity changes **only** through Stock IN/OUT. New products start at quantity 0. Create/update requests have no quantity field; any `quantity` sent by a client is ignored `[D-07]`.
- **FR-PROD-6** Search matches name or SKU (contains, case-insensitive); filters: category, low-stock only `[D-24]`. Results are paginated `[T-10]`.
- **FR-PROD-7** "Delete" is a **soft delete (archive)**: the product is marked inactive `[D-05]`.
  - Archived products are hidden from product lists, product detail, dashboard and Stock IN/OUT forms.
  - Archived products cannot be used in Stock IN or Stock OUT (404).
  - Their SKU stays reserved.
  - Their transaction history remains intact and still shows product name and SKU.
- **FR-PROD-8** A product **cannot be archived while its quantity is greater than 0** → `409 PRODUCT_HAS_STOCK`. The user must first record a Stock OUT for the remaining quantity (e.g. note "Written off") `[D-16]`.

### 3.4 Category management
- **FR-CAT-1** Create, view, update and delete categories. Create/update/delete are ADMIN-only `[D-01]`.
- **FR-CAT-2** Category name is required and unique, compared **case- and accent-insensitively** through the explicit column collation `utf8mb4_0900_ai_ci` (so "Electronics", "electronics" and "ELECTRONICS" are duplicates) `[T-17][T-05]`.
- **FR-CAT-3** Deletion of categories in use is prevented (brief). "In use" means referenced by **any** product, **including archived products** → `409 RESOURCE_IN_USE` `[D-06]`.
- **FR-CAT-4** The category list includes `productCount` = number of products referencing the category, **counting both active and archived products**, because archived products still block deletion `[D-23]`.

### 3.5 Supplier management
- **FR-SUP-1** Add, view, edit and delete suppliers, with supplier contact information. Create/edit/delete are ADMIN-only `[D-01]`.
- **FR-SUP-2** Fields `[T-17]`: name (required, unique, compared case- and accent-insensitively via collation `utf8mb4_0900_ai_ci` `[T-05]`), contact person, email (validated format when provided), phone (free text, max 30), address.
- **FR-SUP-3** A supplier cannot be deleted while **any** product references it, including archived products → `409 RESOURCE_IN_USE` `[D-06]`.
- **FR-SUP-4** The supplier list includes `productCount`, **counting both active and archived products** `[D-23]`.

### 3.6 Stock management
- **FR-STK-1** Stock IN: select product, enter quantity, add a note → available stock increases, transaction recorded. Only active products can be selected `[D-05]`.
- **FR-STK-2** Stock OUT: select product, enter quantity, add a note → available stock decreases, transaction recorded. Only active products can be selected `[D-05]`.
- **FR-STK-3** Stock OUT requests above available stock are rejected (brief) with `409 INSUFFICIENT_STOCK` `[D-17]`.
- **FR-STK-4** Quantity per movement must be an integer from **1 to 1,000,000** `[D-15]`.
- **FR-STK-5** Note is optional, maximum 255 characters `[D-12]`.
- **FR-STK-6** The stock update and the transaction record happen in one database transaction (`@Transactional`); either both succeed or neither does.
- **FR-STK-7** Stock can never become negative (brief). Enforced by a service check, a pessimistic row lock and a database `CHECK` constraint `[T-04]`.
- **FR-STK-8** Each transaction stores `quantity_after`, the product's stock level immediately after the movement `[D-13]`.

### 3.7 Transaction history
- **FR-HIST-1** Displays stock IN and OUT records with product, quantity, user and date (brief); additionally SKU, type, quantity after and note `[D-13]`. User shown as display name, falling back to email `[D-25]`.
- **FR-HIST-1a** History shows the product's **current** name and SKU (joined from `products` at read time), not the values at the time of the movement. Because ADMINs can edit a product's name and SKU, older rows will display the updated values. No snapshot columns are added. Whether historical name/SKU snapshots are required is an **open question for the mentor** `[D-26]`.
- **FR-HIST-2** Search and filter transactions (brief): search by product name or SKU; filter by product, type and date range `[D-24]`. Results are paginated `[T-10]`.
  - Date range `[T-06]`: `from` is **inclusive** and `to` is **exclusive** (`from <= created_at < to`); both are optional ISO-8601 UTC instants.
  - A request with `from` later than `to` is rejected with `400 VALIDATION_FAILED`. `from` equal to `to` is valid and returns an empty page.
- **FR-HIST-3** Ordered deterministically by `created_at DESC, id DESC` `[T-10]`.
- **FR-HIST-4** Historical records are maintained (brief), including transactions of archived products `[D-05]`.
- **FR-HIST-5** Transactions are **append-only**: no API exists to edit or delete them `[T-12]`.

---

## 4. Architecture and Modules

### 4.1 System overview
```
 Browser (React + Vite, :5173)
   │  1. sign in (Email/Password) ──▶ Firebase Authentication (non-production project)
   │  ◀── ID token (JWT, ~1h, auto-refreshed by Firebase SDK)
   │
   │  2. /api/** with  Authorization: Bearer <idToken>
   ▼  (Vite dev proxy forwards /api → :8080)
 Spring Boot API (:8080)
   FirebaseAuthFilter
     ├─ verify token ──▶ FirebaseTokenVerifier ──▶ Firebase Admin SDK
     └─ resolve user ──▶ UserProvisioningService ──▶ users table (find-or-create, role)
   ▼  SecurityContext holds AuthenticatedUser { userId, uid, email, role }
 Controller → Service → Repository ──JPA──▶ MySQL 8 (inventory_db)
```

### 4.2 Authentication approach — stateless bearer token `[T-01]`
1. React signs in with the Firebase JS SDK and obtains an ID token.
2. `apiClient` attaches `Authorization: Bearer <idToken>` to every protected request.
3. The backend authenticates each request independently (Section 4.3).
4. No server session and no cookies, therefore CSRF protection is disabled and the session policy is `STATELESS`.

Rejected alternatives: server session cookie exchange (stateful, needs CSRF handling, more complexity); Spring OAuth2 Resource Server JWT validation (does not use the Firebase Admin SDK required by the brief).

### 4.3 Authentication and user provisioning flow `[T-03]`
This is the **single, authoritative** description of provisioning. For every request to `/api/**`:

1. **No `Authorization: Bearer` header** → request continues unauthenticated; Spring Security returns `401 UNAUTHENTICATED`.
2. **Verify token** `[T-20]`. `FirebaseAuthFilter` calls `FirebaseTokenVerifier.verify(token)`. The production implementation calls the Admin SDK method **`FirebaseAuth.verifyIdToken(idToken, true)`** — the second argument `checkRevoked = true` enables revocation checking. (The one-argument `verifyIdToken(idToken)` only checks signature, issuer, audience and expiry and does **not** detect revoked tokens.)
   - **Error classification.** The production verifier translates Firebase exceptions into three application exceptions, so the filter and tests never depend on Firebase types:

     | Firebase outcome | Application exception | Response |
     |---|---|---|
     | `FirebaseAuthException` with `AuthErrorCode` `INVALID_ID_TOKEN`, `EXPIRED_ID_TOKEN`, `REVOKED_ID_TOKEN`, `USER_DISABLED` or `USER_NOT_FOUND` (account deleted) | `InvalidTokenException` | `401 UNAUTHENTICATED` |
     | `AuthErrorCode.CERTIFICATE_FETCH_FAILED` (Google public keys could not be retrieved), or no `AuthErrorCode` with a platform `ErrorCode` of `UNAVAILABLE`, `DEADLINE_EXCEEDED` or `RESOURCE_EXHAUSTED`, or an I/O/network failure | `AuthServiceUnavailableException` | `503 AUTH_SERVICE_UNAVAILABLE` |
     | Any other Firebase error code, or an unexpected exception (e.g. misconfigured credentials) | `AuthVerificationException` | `500 INTERNAL_ERROR` |

   - Not every `AuthErrorCode` means "bad token": only the codes in the first row produce 401. Infrastructure failures produce 503, so a temporary Firebase outage does not sign users out.
   - Unexpected errors are logged server-side with their Firebase error codes (never the token itself) and return only the generic `INTERNAL_ERROR` message; no Firebase message, exception class or stack trace reaches the client.
   - The exact `AuthErrorCode` / `ErrorCode` constant names are checked against the selected Firebase Admin SDK version during implementation; the mapping is covered by unit tests (Section 8.1).
   - Cost: the revocation check looks up the user record in Firebase Authentication over the network on every request, adding some latency. This is accepted for the stronger security guarantee.
   - On success the filter obtains `{ uid, email, emailVerified, name }`.
3. **Resolve user.** The filter calls `UserProvisioningService.resolve(...)`, which:
   1. finds the `users` row by `firebase_uid`;
   2. if none exists, inserts one with role `USER`; if the insert fails with a duplicate-key error (concurrent first requests), re-reads the existing row;
   3. computes the role: `ADMIN` if `emailVerified` **and** email is in the allowlist, otherwise `USER` (FR-AUTH-8);
   4. updates `role`, `email` or `display_name` only if they differ from the stored values (no write on most requests).
   5. treats the token's `name` claim as untrusted input: trims it, stores `NULL` if blank, and truncates it to 100 characters to fit `users.display_name` `[D-25]`. (The display name is set by the Firebase client SDK, not sent in a request body to this API, so the backend cannot reject it with a 400; it sanitises it instead.)
4. **Establish principal.** The filter stores an `AuthenticatedUser { userId, firebaseUid, email, displayName, role }` in the `SecurityContext` with authority `ROLE_USER` or `ROLE_ADMIN`.
5. **Authorize.** `SecurityConfig` URL rules (Section 6.1) allow or deny with `403 FORBIDDEN`.
6. **Use.** Controllers and services read the current user from the `SecurityContext` (for example, `StockService` records `user_id` from it).

`GET /api/auth/me` performs **no provisioning of its own**; it simply returns the `AuthenticatedUser` already resolved in steps 2–4. Because every protected request runs the same flow, the first authenticated request — whichever endpoint it targets — creates the user record. In practice the frontend's first call after login is `GET /api/auth/me`.

### 4.4 Backend packages (`api/`, base package `com.inventory`)
| Package | Responsibility |
|---|---|
| `config` | CORS, Firebase app initialisation, `@ConfigurationProperties` (admin emails, allowed origin) |
| `security` | `SecurityConfig` (stateless, CSRF off, URL/role rules), `FirebaseAuthFilter`, `FirebaseTokenVerifier` interface + Admin SDK implementation, `AuthenticatedUser`, JSON 401/403 handlers |
| `controller` | HTTP only: validate request DTOs, call a service, return response DTO and status |
| `service` | Business rules: SKU rules, soft delete, in-use checks, stock IN/OUT, dashboard, user provisioning |
| `repository` | Spring Data JPA interfaces and custom queries (search, low stock, pessimistic lock) |
| `entity` | JPA entities mapped to `database/schema.sql`; never returned from the API |
| `dto` | Request/response records with Bean Validation annotations |
| `exception` | Custom exceptions and `@RestControllerAdvice` producing `ProblemDetail` responses |

(The package list is from the brief; class names are design decisions.)

### 4.5 Key design decisions
1. **`FirebaseTokenVerifier` abstraction** `[T-02]`. The only deliberate abstraction. Production uses the Admin SDK; tests use a fake verifier so security tests run without network or real credentials.
2. **Per-request provisioning and role resolution** `[T-03]` — see Section 4.3.
3. **Stock IN/OUT safety (three layers)** `[T-04]`:
   - `@Transactional` service method (brief): quantity update and transaction insert commit or roll back together.
   - Pessimistic write lock (`SELECT … FOR UPDATE`) on the product row, so concurrent movements are serialised.
   - MySQL `CHECK (quantity >= 0)` as a final safeguard.
4. **Schema source of truth** `[T-05]`. `database/schema.sql` defines the schema; Hibernate runs with `spring.jpa.hibernate.ddl-auto=validate` and never modifies it.
5. **UTC timestamp handling** `[T-06]`:
   - Java entity and DTO timestamp fields use `java.time.Instant` (an absolute point in time, no timezone ambiguity).
   - Columns are `DATETIME(6)` holding UTC wall-clock values (microsecond precision matches `Instant` and avoids MySQL rounding surprises).
   - Hibernate is configured with `hibernate.jdbc.time_zone=UTC` and the JDBC URL with `connectionTimeZone=UTC`, so values are written and read as UTC regardless of the server or JVM default timezone.
   - Timestamps are set by the application (`@CreationTimestamp` / `@UpdateTimestamp`), not by MySQL defaults that depend on the session timezone. `seed.sql` uses `UTC_TIMESTAMP(6)` explicitly.
   - Jackson serialises `Instant` as ISO-8601 UTC (e.g. `2026-11-01T09:30:00.123456Z`); the UI converts to the viewer's local time for display.
6. **Development networking** `[T-07]`. Vite dev server proxies `/api` to `http://localhost:8080`. CORS is still explicitly configured to allow only the frontend origin.
7. **Quantity data types** `[T-08]`:
   | Field | SQL | Java entity / DTO | JSON | Frontend |
   |---|---|---|---|---|
   | `products.quantity` → `quantity` | `BIGINT` | `long` | **decimal string**, e.g. `"1250"` (read-only) | `string`; `BigInt` when calculating |
   | `stock_transactions.quantity_after` → `quantityAfter` | `BIGINT` | `long` | **decimal string** | `string`; `BigInt` when calculating |
   | Dashboard `totalStockQuantity` | `SUM` of BIGINT | **`java.math.BigInteger`** | **decimal string** | `string`; `BigInt` when calculating |
   | Dashboard `stockByCategory[].totalQuantity` | `SUM` of BIGINT | **`java.math.BigInteger`** | **decimal string** | `string`; `BigInt` when calculating |
   | `stock_transactions.quantity` → `quantity` (movement) | `INT` | `int` / `Integer`, `@Min(1) @Max(1_000_000)` | number | `number` |
   | `products.reorder_level` → `reorderLevel` | `INT` | `int` / `Integer`, `@Min(0)` | number | `number` |

   **Why BIGINT.** An individual movement is capped at 1,000,000 `[D-15]`, but repeated Stock IN operations could push the running balance past the `INT` limit (2,147,483,647). The database columns therefore stay `BIGINT`.

   **Why `BigInteger` for aggregates.** A single `products.quantity` or `quantity_after` value always fits Java `long`, because the column is `BIGINT`. A **sum** over many such rows does not: MySQL returns `SUM(BIGINT)` as an exact `DECIMAL`, and two rows of 9,223,372,036,854,775,807 already exceed `Long.MAX_VALUE`. Dashboard aggregates are therefore read and held as `BigInteger` end to end and are **never** converted to `long`, `int`, `double` or any other potentially lossy type. Counts (`totalProducts`, `lowStockCount`, `productCount`) are row counts and stay `long` JSON numbers.

   **Why strings in JSON.** A JavaScript `number` is a 64-bit float and represents integers exactly only up to `Number.MAX_SAFE_INTEGER` (2^53 − 1 = 9,007,199,254,740,991). A MySQL `BIGINT` / Java `long` reaches 2^63 − 1, so larger values would be silently rounded by `JSON.parse`. To remove that risk, every `BIGINT`-backed quantity — individual values and aggregates — is serialised as a JSON **decimal string** of the exact integer, without exponent notation or fraction (Jackson `@JsonFormat(shape = JsonFormat.Shape.STRING)` on those DTO fields; Jackson 3 keeps the `com.fasterxml.jackson.annotation` package, and a slice test confirms the output `[T-21]`). `INT`-backed values stay JSON numbers because they are always safe.

   **Frontend handling.**
   - Values are kept as strings in state and passed straight to display; they are never converted with `Number()` / `parseInt()` for display.
   - Display formatting uses `BigInt(value).toLocaleString()` (thousands separators without precision loss) in `utils/format.js`.
   - Any client-side arithmetic or comparison on these values uses `BigInt` (e.g. `BigInt(quantity) <= BigInt(reorderLevel)`); low-stock status is in any case computed by the backend (`lowStock` boolean).
   - The only place a conversion to `number` is allowed is computing **bar widths** in the stock-by-category chart. `barWidthPercent(part, max)` in `utils/format.js` (both arguments are the API's decimal strings):
     1. If `BigInt(max) === 0n` (every category quantity is zero), return `0` — no division is performed, because `BigInt` division by zero throws.
     2. Otherwise compute the ratio entirely in `BigInt`: `BigInt(part) * 1000n / BigInt(max)` (0.1 % resolution).
     3. Convert to `Number` only for that final small result: `Number(ratio) / 10` is the width percentage (0–100).

     The displayed labels always use the exact decimal string, never the converted number.
   - **Database IDs** remain JSON numbers: they are auto-increment values that will not approach 2^53 in this application. The frontend treats them as **opaque identifiers**: it may pass them to API endpoints and compare them for equality, but never performs arithmetic on them and never assumes that every possible MySQL `BIGINT` value would be exactly representable as a JavaScript `Number`. (If IDs could ever exceed 2^53 − 1, they would switch to decimal strings like the quantities.)
8. **Configuration by environment variables only** (brief) — see Section 9.

---

## 5. Data Model

### 5.1 Relationships (brief)
```
categories 1 ───< products >─── 0..1 suppliers
                     │
                     1
                     │
users 1 ───< stock_transactions >─── 1 products
```
- One category has many products; a product has exactly one category `[D-09]`.
- One supplier has many products; a product has zero or one supplier `[D-09]`.
- One product has many stock transactions.
- One user performs many stock transactions.
- All foreign keys use `ON DELETE RESTRICT` — a database-level backstop for the 409 rules `[T-05]`.

### 5.2 General conventions
Primary keys, foreign keys, unique constraints, indexes, created/updated timestamps, DECIMAL prices and validation constraints are required by the brief. Design choices `[T-05][T-06]`: InnoDB; character set `utf8mb4` with the **explicit** collation `utf8mb4_0900_ai_ci` declared on the `inventory_db` / `inventory_test` databases and on every table in `schema.sql` (not left to the server default, which can differ between installations); `BIGINT AUTO_INCREMENT` primary keys, `DATETIME(6)` UTC timestamps, `created_at` / `updated_at` on all mutable tables, timestamps set by the application.

### 5.3 Tables

**`users`**
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK |
| firebase_uid | VARCHAR(128) | NOT NULL, UNIQUE |
| email | VARCHAR(255) | NOT NULL, indexed, **not** unique `[T-11]` |
| display_name | VARCHAR(100) | NULL `[D-25]` |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'USER', `CHECK (role IN ('USER','ADMIN'))` |
| created_at, updated_at | DATETIME(6) | NOT NULL |

`[T-11]` Email is not unique because identity is the Firebase UID; a re-created Firebase account receives a new UID for the same email.

**`categories`**
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK |
| name | VARCHAR(100) | NOT NULL, UNIQUE, collation `utf8mb4_0900_ai_ci` (case- and accent-insensitive uniqueness) |
| description | VARCHAR(255) | NULL |
| created_at, updated_at | DATETIME(6) | NOT NULL |

**`suppliers`**
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK |
| name | VARCHAR(150) | NOT NULL, UNIQUE, collation `utf8mb4_0900_ai_ci` (case- and accent-insensitive uniqueness) |
| contact_person | VARCHAR(100) | NULL |
| email | VARCHAR(255) | NULL |
| phone | VARCHAR(30) | NULL |
| address | VARCHAR(255) | NULL |
| created_at, updated_at | DATETIME(6) | NOT NULL |

**`products`**
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK |
| sku | VARCHAR(50) | NOT NULL, UNIQUE (includes archived products) `[D-10]` |
| name | VARCHAR(150) | NOT NULL |
| description | VARCHAR(500) | NULL |
| category_id | BIGINT | NOT NULL, FK → categories(id) ON DELETE RESTRICT |
| supplier_id | BIGINT | NULL, FK → suppliers(id) ON DELETE RESTRICT |
| price | DECIMAL(12,2) | NOT NULL, `CHECK (price >= 0)` `[D-11]` |
| quantity | **BIGINT** | NOT NULL, DEFAULT 0, `CHECK (quantity >= 0)` `[T-08]` |
| reorder_level | INT | NOT NULL, DEFAULT 0, `CHECK (reorder_level >= 0)` |
| active | BOOLEAN | NOT NULL, DEFAULT TRUE `[D-05]` |
| created_at, updated_at | DATETIME(6) | NOT NULL |

Indexes: `sku` (unique), `category_id`, `supplier_id`, `(active, name)` — the last supports the default list ordering `name ASC, id ASC` for active products (InnoDB appends the primary key to secondary indexes).

**`stock_transactions`** — append-only `[T-12]`
| Column | Type | Constraints |
|---|---|---|
| id | BIGINT | PK |
| product_id | BIGINT | NOT NULL, FK → products(id) ON DELETE RESTRICT |
| user_id | BIGINT | NOT NULL, FK → users(id) ON DELETE RESTRICT |
| type | VARCHAR(3) | NOT NULL, `CHECK (type IN ('IN','OUT'))` |
| quantity | INT | NOT NULL, `CHECK (quantity BETWEEN 1 AND 1000000)` `[D-15]` |
| quantity_after | **BIGINT** | NOT NULL, `CHECK (quantity_after >= 0)` `[D-13][T-08]` |
| note | VARCHAR(255) | NULL `[D-12]` |
| created_at | DATETIME(6) | NOT NULL |

Indexes: `(product_id, created_at)`, `(created_at)`, `(type, created_at)`, `user_id`.

`[T-12]` No `updated_at`: transactions are an immutable audit trail, so an update timestamp would imply edits are possible. This is a deliberate exception to the brief's "created and updated timestamps".

Ordering note `[T-10]`: InnoDB secondary indexes implicitly end with the primary key, so `(product_id, created_at)` effectively covers `(product_id, created_at, id)` and supports `WHERE product_id = ? ORDER BY created_at DESC, id DESC`; `(created_at)` likewise supports the global history ordering.

### 5.4 SQL files (`database/`) (brief)
- **`schema.sql`** — creates all tables, constraints and indexes. Contains **no** `DROP` statements `[T-18]`. It is applied manually by the developer (see `database/README.md`) and is **never executed by automated tests**; tests only read it (Section 8.2).
- **`seed.sql`** — demo categories, suppliers and products only. All seed products have quantity 0. **No seed users and no seed stock transactions**; stock is added through Stock IN by a real authenticated user `[D-14]`. Timestamps use `UTC_TIMESTAMP(6)` `[T-06]`.
- **`queries.sql`** — documented example queries: low-stock products, stock quantity/value per category, recent movements, movements per user, product movement history.

---

## 6. REST API

### 6.1 Authorization matrix `[D-01]`
| Endpoint | USER | ADMIN | No/invalid token |
|---|---|---|---|
| `GET /api/**` | ✅ | ✅ | 401 |
| `POST /api/stock/in`, `POST /api/stock/out` | ✅ | ✅ | 401 |
| `POST`/`PUT`/`DELETE` on `/api/products/**`, `/api/categories/**`, `/api/suppliers/**` | 403 | ✅ | 401 |

### 6.2 Endpoints
The product, category, supplier, stock and dashboard paths and methods are from the brief. Query parameters, response bodies, status codes and error codes are design decisions `[T-09][T-10]`.

**Auth** `[D-22]`
| Method | Path | Success | Notes |
|---|---|---|---|
| GET | `/api/auth/me` | 200 `{ id, email, displayName, role }` | Returns the user resolved by the authentication flow (Section 4.3); performs no provisioning itself. |

**Products** (active products only `[D-05]`)
| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/products?search=&categoryId=&lowStock=&page=0&size=20` | 200 paginated, ordered **`name ASC, id ASC`** | 400 |
| GET | `/api/products/{id}` | 200 | 404 (missing or archived) |
| POST | `/api/products` | 201 + `Location` header | 400, 404 (category/supplier), 409 `DUPLICATE_RESOURCE` |
| PUT | `/api/products/{id}` | 200 | 400, 404, 409 `DUPLICATE_RESOURCE` |
| DELETE | `/api/products/{id}` | 204 (archived) | 404, 409 `PRODUCT_HAS_STOCK` |

Product request body: `{ sku, name, description?, categoryId, supplierId?, price, reorderLevel }` — no quantity `[D-07]`.
Product response: `{ id, sku, name, description, category: { id, name }, supplier: { id, name } | null, price, quantity, reorderLevel, lowStock, createdAt, updatedAt }` — `quantity` is a decimal string `[T-08]`.

**Categories**
| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/categories` | 200 list ordered `name ASC`, each with `productCount` (active + archived) `[D-23]` | — |
| POST | `/api/categories` | 201 | 400, 409 `DUPLICATE_RESOURCE` |
| PUT | `/api/categories/{id}` | 200 | 400, 404, 409 `DUPLICATE_RESOURCE` |
| DELETE | `/api/categories/{id}` | 204 | 404, 409 `RESOURCE_IN_USE` |

**Suppliers**
| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/suppliers` | 200 list ordered `name ASC`, each with `productCount` (active + archived) `[D-23]` | — |
| POST | `/api/suppliers` | 201 | 400, 409 `DUPLICATE_RESOURCE` |
| PUT | `/api/suppliers/{id}` | 200 | 400, 404, 409 `DUPLICATE_RESOURCE` |
| DELETE | `/api/suppliers/{id}` | 204 | 404, 409 `RESOURCE_IN_USE` |

Category and supplier names are unique, so `name ASC` ordering is already deterministic.

**Stock**
| Method | Path | Success | Errors |
|---|---|---|---|
| POST | `/api/stock/in` | 201 transaction | 400, 404 (missing/archived product) |
| POST | `/api/stock/out` | 201 transaction | 400, 404, 409 `INSUFFICIENT_STOCK` |
| GET | `/api/stock/history?productId=&type=IN\|OUT&search=&from=&to=&page=0&size=20` | 200 paginated, ordered `created_at DESC, id DESC` | 400 (including `from` > `to`) |

Stock request body: `{ productId, quantity, note? }`.
Transaction response: `{ id, type, quantity, quantityAfter, note, product: { id, sku, name }, user: { id, displayName, email }, createdAt }` — `quantity` (movement, INT) is a number; `quantityAfter` is a decimal string `[T-08]`; `product.sku` / `product.name` are the product's **current** values `[D-26]`.
`from` / `to` are ISO-8601 instants (UTC) `[T-06]`; `from` is inclusive, `to` is exclusive (`from <= createdAt < to`); `from` later than `to` → `400 VALIDATION_FAILED` (FR-HIST-2).

**Dashboard**
| Method | Path | Success |
|---|---|---|
| GET | `/api/dashboard` | 200 `{ totalProducts, totalStockQuantity, lowStockCount, lowStockProducts[≤5], recentTransactions[≤10], stockByCategory[{ categoryName, totalQuantity }] }` — active products only `[D-05][T-16]`; `totalStockQuantity` and `totalQuantity` are exact aggregates (`BigInteger` in Java, may exceed `Long.MAX_VALUE`) serialised as decimal strings without exponent or fraction `[T-08]`; `totalProducts` and `lowStockCount` are JSON numbers |

### 6.3 Pagination `[T-10]`
- Response DTO: `{ content: [...], page, size, totalElements, totalPages }` (Spring's `Page` is not serialised directly).
- `page` is zero-based; default `size` 20; maximum `size` 100.
- Every paginated query has a deterministic order ending in `id`: products `name ASC, id ASC`; history `created_at DESC, id DESC`.

### 6.4 Validation limits `[T-17]`
Bean Validation limits match database column sizes:
- SKU 3–50 characters plus pattern `[D-10]`; product name ≤150; description ≤500.
- Category name ≤100, description ≤255.
- Supplier name ≤150, contact person ≤100, email ≤255 and valid format when provided, phone ≤30 free text, address ≤255.
- Price ≥ 0 `[D-11]` with at most 2 decimal places; reorder level ≥ 0.
- Stock quantity 1–1,000,000 `[D-15]`; note ≤255 `[D-12]`.
- Registration display name `[D-25]`: required, trimmed, 1–100 characters — enforced by the frontend form; the backend sanitises the token `name` claim to the same limit (Section 4.3, step 3.5).

### 6.5 Error responses — RFC 9457 `ProblemDetail` `[T-09]`
Centralised exception handling and correct HTTP status codes are required by the brief; the format and codes below are design decisions.

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "Insufficient stock: requested 8, available 5.",
  "instance": "/api/stock/out",
  "code": "INSUFFICIENT_STOCK",
  "fieldErrors": []
}
```

| Situation | Status | `code` |
|---|---|---|
| Bean Validation failure (`fieldErrors` populated: `{ field, message }`) | 400 | `VALIDATION_FAILED` |
| Malformed JSON / wrong parameter type | 400 | `MALFORMED_REQUEST` |
| Missing, invalid, expired or revoked token, or token of a disabled/deleted user | 401 | `UNAUTHENTICATED` `[T-20]` |
| Insufficient role | 403 | `FORBIDDEN` |
| Resource missing or archived | 404 | `NOT_FOUND` |
| Duplicate SKU, category name or supplier name | 409 | `DUPLICATE_RESOURCE` |
| Deleting a referenced category or supplier | 409 | `RESOURCE_IN_USE` `[D-06]` |
| Stock OUT above available stock | 409 | `INSUFFICIENT_STOCK` `[D-17]` |
| Archiving a product with quantity > 0 | 409 | `PRODUCT_HAS_STOCK` `[D-16]` |
| Firebase infrastructure failure during verification (public-key certificate retrieval, network or service unavailable) | 503 | `AUTH_SERVICE_UNAVAILABLE` `[T-20]` |
| Any unexpected error, including unexpected Firebase errors | 500 | `INTERNAL_ERROR` (generic message; details logged server-side only) |

Responses never include SQL details, exception class names, or stack traces.

---

## 7. Frontend Design

### 7.1 Dependencies `[T-13]`
Runtime: `react`, `react-dom`, `react-router-dom`, `firebase`, `lucide-react`.
Dev: `vite`, `@vitejs/plugin-react`, ESLint, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@playwright/test`.

### 7.2 Structure (`web/src/`)
```
main.jsx, App.jsx              router + providers
firebase.js                    Firebase app/auth initialisation from VITE_FIREBASE_* variables
context/AuthContext.jsx        current user, role, loading; login / register / logout / refreshAuth
services/apiClient.js          fetch wrapper: Bearer token, ProblemDetail → ApiError, 401 handling
services/productService.js, categoryService.js, supplierService.js,
         stockService.js, dashboardService.js, authService.js
hooks/useApi.js                loading / error / data state for requests
pages/                         Login, Register, Dashboard, Products, ProductForm (add/edit),
                               Categories, Suppliers, StockManagement, TransactionHistory,
                               NotFound, Forbidden
components/layout/             Sidebar, Navbar, AppLayout
components/                    DashboardCard, ProductTable, ProductForm, CategoryForm,
                               SupplierForm, StockForm, SearchBar, FilterPanel, StatusBadge,
                               LoadingState, ErrorMessage, ProtectedRoute,
                               Modal, ConfirmDialog, Toast, Pagination, EmptyState
styles/tokens.css              all design tokens as CSS variables
styles/base.css                reset, typography, focus styles
utils/validation.js, utils/format.js   (format.js: BigInt-safe quantity formatting [T-08], UTC → local dates)
```
Pages 1–9 and the first twelve components are from the brief. `NotFound`, `Forbidden`, `AppLayout`, `Modal`, `ConfirmDialog`, `Toast`, `Pagination` and `EmptyState` are additions `[T-14]`, needed for modals, delete confirmation, success feedback, paginated history, empty states and permission errors.

### 7.3 Routes `[T-14]`
| Path | Page | Access |
|---|---|---|
| `/login`, `/register` | Login, Register | logged-out users |
| `/` | Dashboard | authenticated |
| `/products` | Products list | authenticated |
| `/products/new`, `/products/:id/edit` | ProductForm | ADMIN `[D-01]` |
| `/categories` | Categories (modal create/edit) | view: authenticated; modify: ADMIN `[D-01]` |
| `/suppliers` | Suppliers (modal create/edit) | view: authenticated; modify: ADMIN `[D-01]` |
| `/stock` | Stock Management (IN / OUT tabs) | authenticated |
| `/transactions` | Transaction History | authenticated |
| `*` | NotFound | — |

### 7.4 Frontend authentication flow `[T-03]`
1. **Register:** `createUserWithEmailAndPassword` → `updateProfile({ displayName })` → `sendEmailVerification` → `getIdToken(true)` (so the token carries the display name) → `GET /api/auth/me`.
2. **Login:** `signInWithEmailAndPassword` → `GET /api/auth/me`; `AuthContext` stores `{ user, role }`.
3. **Reload:** `AuthContext` waits for Firebase to restore the session and shows a loading skeleton meanwhile (no login-page flash).
4. **Email verification refresh** (FR-AUTH-11): the verification banner offers an "I've verified my email" action; the app also checks when the window regains focus. Either path runs `user.reload()` → `getIdToken(true)` → `GET /api/auth/me`, and updates the stored role. Without the forced refresh the cached token would still contain `email_verified = false`.
5. **ProtectedRoute:** unauthenticated → redirect to `/login`, returning to the original page after login; `adminOnly` routes show the Forbidden page to USERs.
6. **apiClient:** obtains the token with `getIdToken()` (cached, auto-refreshed); converts ProblemDetail into `{ status, code, message, fieldErrors }`; forms map `fieldErrors` to inputs; 401 → sign out and redirect to `/login`; 503 / 500 → show an error message while keeping the user signed in.
7. **Logout:** Firebase `signOut()` → clear context → `/login`.
8. Unverified users see a dismissible "verify your email" banner `[D-19]`.

### 7.5 Design system
**Color tokens** (brief values; no raw colors inside components):
| Token | Value |
|---|---|
| `--color-primary` | `#2563EB` |
| `--color-navy` | `#0F172A` |
| `--color-teal` | `#0F766E` |
| `--color-bg` | `#F8FAFC` |
| `--color-surface` | `#FFFFFF` |
| `--color-text` | `#0F172A` |
| `--color-text-muted` | `#64748B` |
| `--color-border` | `#E2E8F0` |
| `--color-success` | `#16A34A` |
| `--color-warning` | `#D97706` |
| `--color-danger` | `#DC2626` |

**Typography** (brief): Inter, page headings 24–30px, section headings 18–20px, body 14–16px, supporting text 12–13px, consistent weights and line heights. Loaded from Google Fonts with fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (student decision).

**Spacing and shape** (brief): 4px spacing scale; rounded cards with subtle shadows; consistent button styles (variants primary, secondary, danger, ghost `[T-15]`).

**Layout** (brief): left sidebar, top navbar, main content area, summary cards, responsive tables, consistent forms and modals, search and filter controls.

**States** (brief): loading skeletons, professional empty states, error messages, success feedback (toasts `[T-14]`).

**Responsive behaviour** — responsiveness is required by the brief; breakpoints are design decisions `[T-15]`:
- Desktop ≥1024px: fixed sidebar.
- Tablet 768–1023px: icon-only sidebar.
- Mobile <768px: off-canvas drawer opened from the navbar; tables become stacked cards.

**Accessibility** — labels and keyboard-friendly navigation are required by the brief; specifics `[T-15]`: every input has a `<label>`; visible keyboard focus; drawer and modals trap focus and close with Esc; icon-only buttons have `aria-label`.

**Avoid** (brief): excessive gradients, extra colors, unnecessary animation, overcrowded dashboards, huge empty spaces, inconsistent font sizes, random component styles.

---

## 8. Testing Strategy

The brief requires JUnit 5, Spring Boot Test and Playwright, and lists the backend and frontend topics to cover. The brief's requirement — automated backend tests written with JUnit and Spring Boot Test — is kept; the version is a technical compatibility decision: Spring Boot 4.1.2 manages **JUnit Jupiter 6**, which is the version this project uses (not JUnit 5) `[T-21]`. The layering, tools and environments below are design decisions `[T-17][T-18][T-19]`.

### 8.1 Backend
Backend tests use JUnit Jupiter 6 `[T-21]`. Unit and slice tests are named `*Test` and run with Maven Surefire; MySQL integration tests are named `*IT` and run with Maven Failsafe (commands in Section 8.5).

**Service unit tests (JUnit Jupiter 6 + Mockito, no database; `*Test`):**
- Products: creation; SKU normalisation; duplicate SKU → 409; update; client-sent `quantity` ignored; missing/archived → 404; archive with stock → 409 `PRODUCT_HAS_STOCK`.
- Stock: IN increases quantity; OUT decreases quantity; `quantityAfter` correct; insufficient stock → 409; archived product → 404.
- Categories/suppliers: delete while referenced (including by archived products only) → 409; `productCount` includes archived products.
- User provisioning: new user → USER; verified + allowlisted → ADMIN; allowlisted but unverified → USER; removed from allowlist → demoted; duplicate-key recovery; no write when nothing changed; display name trimmed, blank → `NULL`, truncated to 100.
- **Production verifier unit test** (separate from the slice tests; `FirebaseAuth` mocked with Mockito):
  - asserts the verifier invokes `verifyIdToken(token, true)` — i.e. revocation checking is enabled;
  - asserts the error classification of Section 4.3: invalid / expired / revoked / disabled / not-found → `InvalidTokenException`; certificate-fetch and network/service failures → `AuthServiceUnavailableException`; other errors → `AuthVerificationException`.

**Web/security slice tests (`@WebMvcTest` + fake `FirebaseTokenVerifier`; `*Test`, no database):**
- No token → 401. The **fake verifier simulates** verification outcomes by throwing the application exceptions: invalid, expired, revoked or disabled-user token (`InvalidTokenException`) → 401 `UNAUTHENTICATED`; infrastructure failure (`AuthServiceUnavailableException`) → 503 `AUTH_SERVICE_UNAVAILABLE`; unexpected failure (`AuthVerificationException`) → 500 `INTERNAL_ERROR` with no internal details. These tests prove the HTTP mapping; they do not call Firebase.
- History: `from` > `to` → 400 `VALIDATION_FAILED`.
- `BIGINT` quantities (`quantity`, `quantityAfter`, `totalStockQuantity`, `totalQuantity`) are serialised as JSON strings.
- An aggregate above `Long.MAX_VALUE` (e.g. `18446744073709551614`) is serialised as exactly `"18446744073709551614"` — a JSON string with no exponent notation, no fraction and no precision loss; IDs in the same response are JSON numbers.
- USER on catalog `POST`/`PUT`/`DELETE` → 403; ADMIN → 2xx; USER Stock IN → 201.
- `GET /api/auth/me` returns the resolved role.
- Invalid body → 400 `VALIDATION_FAILED` with `fieldErrors`; malformed JSON → 400 `MALFORMED_REQUEST`.
- ProblemDetail shape correct; no stack trace or SQL details in responses.

**Integration tests (`@SpringBootTest` against the existing schema in MySQL `inventory_test`; `*IT`, run by Failsafe):**
- Application context starts with `ddl-auto=validate` against the existing `inventory_test` tables (proves entity types, including `BIGINT` and `DATETIME(6)`, match the schema created from `schema.sql`).
- `SchemaConformanceIT` (read-only) compares the existing `inventory_test` structure with the read-only `database/schema.sql`: tables, engine and collation, primary keys, unique constraints and secondary indexes with column order, foreign keys with referenced columns and delete/update rules, and CHECK constraint definitions (Section 8.2).
- Repository queries: search, category filter, low stock, history filters (including a row exactly at `from` being included and a row exactly at `to` being excluded); ordering `name ASC, id ASC` and `created_at DESC, id DESC`.
- Category and supplier names differing only by case (e.g. "Electronics" / "electronics") are rejected as duplicates by the `utf8mb4_0900_ai_ci` unique index.
- Timestamps round-trip as the same UTC `Instant`.
- Dashboard aggregates are exact beyond `Long.MAX_VALUE`: two active products with quantity 9,223,372,036,854,775,807 each give `totalStockQuantity` and their category's `totalQuantity` = 18,446,744,073,709,551,614; an empty inventory gives `0` (never `null`).
- Transaction rollback: failure while recording the transaction leaves quantity unchanged.
- Concurrency: two threads each Stock OUT 5 units of a product with 5 → exactly one succeeds, final quantity 0.
- Database `CHECK` rejects a direct negative quantity update.

### 8.2 Database separation `[D-21][T-18]`
| Environment | Database | Used by |
|---|---|---|
| Development | `inventory_db` | Developer running the app locally |
| Integration tests | `inventory_test` | `*IT` classes run by Maven Failsafe via `mvn verify` (`@SpringBootTest`) |
| End-to-end tests | `inventory_test` | Playwright, via a backend instance started against `inventory_test` |
| Production | — | **No automated test, cleanup process or E2E backend may ever connect to a production database.** |

Rules — **existing schema, guarded DELETE-only cleanup** `[T-18]`:
- `inventory_test` and its tables are created once, manually, by the developer from `database/schema.sql` (`database/README.md` §3). Automated tests **use this existing schema as-is** and it is never used for development data.
- Automated tests **never** execute `schema.sql`, and never run `DROP`, `TRUNCATE` or any other DDL against `inventory_test`. The test database account therefore needs no `DROP` privilege.
- Hibernate runs with `spring.jpa.hibernate.ddl-auto=validate`: it checks the entities against the existing tables and never changes them.
- **`SchemaConformanceIT`** (read-only: `SELECT` on `information_schema` only) compares the existing `inventory_test` structure with `database/schema.sql`, which it reads as a file and never executes. If they differ, the test fails and instructs the developer to re-create the test schema manually; nothing is re-created automatically.
- **Test data cleanup** uses `DatabaseCleaner`, which issues guarded `DELETE` statements in child-to-parent order, so foreign keys are never violated:
  1. `stock_transactions`
  2. `products`
  3. `users`
  4. `suppliers`
  5. `categories`
- **Guard:** before every cleanup, `DatabaseCleaner` checks `SELECT DATABASE()` and refuses to run unless the database name ends with `_test`. Spring test profiles (`test`, `e2e`) apply the same check at startup.
- Tests that only read (application context, `SchemaConformanceIT`) do not clean anything; tests that write data clean before each test and after their test class.
- Test configuration is separate from development configuration. Integration tests connect via `TEST_DB_URL`, `TEST_DB_USERNAME`, `TEST_DB_PASSWORD`.
- Integration tests and E2E tests share `inventory_test`, so they must **not run at the same time**.
- `schema.sql` contains no `DROP` statements, so even a manual run of it can never destroy data.

### 8.3 Frontend (Vitest + React Testing Library + jsdom)
- Validation utilities and Login/Register/Product form error messages (including display name required, ≤100 characters).
- `format.js` formats `BIGINT` decimal strings above 2^53 exactly (e.g. `"9007199254740993"` → `9,007,199,254,740,993`), including aggregates above `Long.MAX_VALUE` (e.g. `"18446744073709551614"` → `18,446,744,073,709,551,614`).
- `barWidthPercent`: `("0", "0")` → `0` (all quantities zero, no division); `("5", "10")` → `50`; `("1", "3")` → `33.3`; `("18446744073709551614", "18446744073709551614")` → `100` (BigInt-safe for values above 2^53).
- `ProtectedRoute`: redirect when logged out; Forbidden page for USER on admin routes.
- Loading skeleton and error states with mocked services.
- `apiClient`: ProblemDetail → `ApiError`; 401 handling. Firebase is mocked.
- Email-verification refresh calls `reload()` and `getIdToken(true)` before `/api/auth/me`.

### 8.4 End-to-end (Playwright)
**Environment `[D-21]`:**
- Frontend dev server + backend started with the `e2e` profile against the **existing** `inventory_test` schema. The `e2e` profile **refuses to start unless the database name ends with `_test`**.
- Before a run, E2E test data is cleared with the same guarded, DELETE-only cleanup as Section 8.2 (child-to-parent order, `_test` check first). The schema is never dropped, truncated, re-created or altered.
- E2E fixture data (if a scenario needs it) is created only through a separately documented, safe process — to be specified in the E2E phase — that inserts rows into the existing tables (for example through the API, or the INSERT-only, idempotent `database/seed.sql`) and never creates, alters or drops schema objects. It runs only after the `_test` guard.
- E2E tests never connect to a production database.
- A **dedicated non-production (development/test) Firebase project is mandatory**. E2E tests must **never** run against a production Firebase project. If only a production project is available, E2E tests are reported as **blocked**, not run.
- `APP_SECURITY_ADMIN_EMAILS` for the E2E backend includes the ADMIN test account.

**Test accounts (credentials only from environment variables, never committed):**
| Account | Variables | Notes |
|---|---|---|
| ADMIN | `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | Pre-created, email verified, in the admin allowlist; **never deleted or modified by tests** |
| USER | `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` | Pre-created normal account; **never deleted or modified by tests** |
| Registration | `E2E_REGISTER_EMAIL`, `E2E_REGISTER_PASSWORD` | Base address for **new** registrations — see below |

**Repeatable registration test `[T-19]`:** Scenario 1 never re-registers an existing account. For each run the test derives a **unique** address from `E2E_REGISTER_EMAIL` using plus-addressing (e.g. `qa.inventory@example.com` → `qa.inventory+e2e-<timestamp>@example.com`) and registers it with `E2E_REGISTER_PASSWORD`. In teardown, the test signs in as that new account and deletes it through the Firebase Authentication REST API (using the project's web API key), so test accounts do not accumulate in Firebase. Teardown deletes **only** the account created in that run; the pre-created ADMIN and USER accounts are never deleted in Firebase. Database cleanup may remove their `users` rows from `inventory_test`; these are re-created automatically by user provisioning on their next login (Section 4.3). The matching `users` row remains only in `inventory_test` and is removed by the next guarded cleanup (Section 8.2). If the mailbox provider does not support plus-addressing, Scenario 1 is reported as **blocked** rather than reusing an existing account.

**Scenarios** (from design review; brief requires important workflows):
1. Register a new account → logout → login.
2. USER sees no admin actions; direct visit to `/products/new` shows Forbidden.
3. ADMIN creates a category, a supplier and a product (quantity 0).
4. Stock IN 10 → Stock OUT 3 → product shows 7; history shows both rows with `quantityAfter`.
5. Stock OUT 100 → "Insufficient stock" message.
6. Archiving a product with stock → `PRODUCT_HAS_STOCK` message.
7. Mobile viewport: drawer opens; tables render as cards.

### 8.5 Test execution and reporting rules
**Backend (Maven, run from `api/`):**
- Maven **Surefire** runs the unit and slice tests (`*Test`) in the `test` phase. `mvn test` runs **only** these; it does **not** run integration tests.
- Maven **Failsafe** runs the MySQL integration tests (`*IT`) in the `integration-test` and `verify` phases, so integration tests run through `mvn verify`.
- **Full verification** is `mvn verify` **without skip properties and without test filters**. It runs both Surefire and Failsafe, and only its result may be reported as "the complete backend test suite passed" — after confirming that every `*IT` class produced a Failsafe report with no skipped tests.
- **Partial runs** — `mvn test`, a single test class or method (`-Dtest=…`, `-Dit.test=…`), or runs with `-DskipUTs` / `-DskipITs` — are allowed during development but are always reported as partial runs, stating what was skipped, and never as full verification.
- Exact plugin configuration and command syntax (including Windows PowerShell quoting) are defined in the Backend Implementation Plan.

**General:**
- Run the backend suite as above, `npm test` and configured Playwright tests; report exact pass, fail and skipped/blocked counts from actual output.
- If MySQL, Firebase credentials, test accounts or other services are unavailable, affected tests are reported as **blocked / not run**, never as passed.
- Firebase Emulator and `firebase-tools` are not installed at this stage.
- No Postman collection is created or published without explicit approval.

---

## 9. Configuration and Security

### 9.1 Environment variables `[T-18][T-19]`
| Variable | Used by | Purpose |
|---|---|---|
| `DB_URL` | backend | JDBC URL (`inventory_db` for development; `inventory_test` when running the `e2e` profile), including `connectionTimeZone=UTC` |
| `DB_USERNAME`, `DB_PASSWORD` | backend | MySQL credentials |
| `GOOGLE_APPLICATION_CREDENTIALS` | backend | Absolute path to the Firebase service-account JSON (non-production project), stored **outside** the repository |
| `APP_SECURITY_ADMIN_EMAILS` | backend | Comma-separated admin allowlist (binds to `app.security.admin-emails`) |
| `APP_CORS_ALLOWED_ORIGIN` | backend | Frontend origin, default `http://localhost:5173` |
| `TEST_DB_URL`, `TEST_DB_USERNAME`, `TEST_DB_PASSWORD` | integration tests, E2E guarded cleanup | `inventory_test` connection |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | frontend (`web/.env`); API key also used by E2E teardown | Firebase web configuration |
| `E2E_BASE_URL` | Playwright | Frontend URL under test |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | Playwright | ADMIN test account |
| `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` | Playwright | USER test account |
| `E2E_REGISTER_EMAIL`, `E2E_REGISTER_PASSWORD` | Playwright | Base address and password for per-run registration accounts |

### 9.2 Security rules
- Credentials stay outside source control and are supplied via environment variables (brief).
- `.env` files, service-account JSON files and other credentials are listed in `.gitignore` and never committed. Only `.env.example` files with placeholders are committed.
- The Firebase **web API key** identifies the project and is not a service-account secret; it is still kept in `web/.env` and out of Git (student decision).
- The Firebase **Admin service-account credential** exists only on the backend machine; it is never exposed to the frontend, logged, or committed (brief).
- Passwords are handled only by Firebase; the application never stores passwords (brief).
- Admin emails are never hardcoded or sent to the frontend `[D-02]`.
- E2E tests **must** use a dedicated non-production Firebase project and must never use a production project; local development also uses that non-production project `[D-21]`.
- Secrets are never pasted into prompts, logs or documentation (brief).

### 9.3 Manual Firebase setup (performed by the student)
1. Create a **dedicated development/test** Firebase project. This is required for E2E tests, which must never use a production project.
2. Enable the **Email/Password** sign-in provider.
3. Register a Web app and copy its config into `web/.env`.
4. Generate a service-account private key; store the JSON outside the repository; set `GOOGLE_APPLICATION_CREDENTIALS`.
5. Confirm `localhost` is in the authorised domains (default).
6. Create the ADMIN and USER E2E test accounts; verify the ADMIN account's email; add it to `APP_SECURITY_ADMIN_EMAILS`.
7. Choose a mailbox that supports plus-addressing for `E2E_REGISTER_EMAIL`.

---

## 10. Decisions Pending Mentor Confirmation

### 10.1 Business and product decisions `[D-xx]`
| ID | Decision |
|---|---|
| D-01 | USER: view everything + Stock IN/OUT. ADMIN: additionally create, update and delete products, categories, suppliers. |
| D-02 | Every new user gets USER; ADMIN comes only from the `app.security.admin-emails` environment allowlist; admin emails never hardcoded or sent to the frontend. |
| D-03 | ADMIN additionally requires `email_verified = true`. |
| D-04 | Role resolved on every request; removal from the allowlist demotes to USER on the next request. |
| D-05 | Product delete is a soft delete (archive): hidden from lists, detail, dashboard and stock forms; unusable for Stock IN/OUT; SKU reserved; history preserved. Dashboard figures use active products only. |
| D-06 | Categories and suppliers cannot be deleted while any product (including archived) references them → 409 `RESOURCE_IN_USE`. |
| D-07 | Quantity changes only through Stock IN/OUT; new products start at 0; no quantity field in product requests or forms. |
| D-08 | Low stock when `quantity <= reorderLevel`. |
| D-09 | Category required; supplier optional. |
| D-10 | SKU trimmed, uppercase, `^[A-Z0-9-]{3,50}$`, unique including archived products. |
| D-11 | Price may be 0.00, never negative. |
| D-12 | Stock movement note optional, ≤255 characters. |
| D-13 | `stock_transactions.quantity_after` stores the balance after each movement and is shown in history. |
| D-14 | Seed data: categories, suppliers, products (quantity 0) only; no seed users or transactions. |
| D-15 | Stock movement quantity between 1 and 1,000,000. |
| D-16 | Products with quantity > 0 cannot be archived → 409 `PRODUCT_HAS_STOCK`. |
| D-17 | Insufficient stock returns 409 Conflict. |
| D-18 | Password minimum 8 characters with confirmation field. |
| D-19 | Registration sends a verification email; unverified users may use the app as USER, with a verification banner. |
| D-20 | Email/Password sign-in only; no Google Sign-In unless the mentor requires it. |
| D-21 | Test environments: `inventory_test` for integration and E2E tests (never development or production databases); E2E **must** use a dedicated non-production Firebase project (never production; otherwise E2E is blocked) with ADMIN, USER and per-run registration accounts. |
| D-22 | Additional endpoint `GET /api/auth/me`. |
| D-23 | Category and supplier lists include `productCount`, counting active **and** archived products. |
| D-24 | Search/filter semantics: product search by name or SKU with category and low-stock filters; history search by product name or SKU with product, type and date-range filters. *(new in revision 2 — previously untagged)* |
| D-25 | Registration collects a **required** display name (trimmed, 1–100 characters, matching `users.display_name VARCHAR(100)`); backend sanitises the token `name` claim to the same limit; history shows display name, falling back to email. *(new in revision 2; length/required rule added in revision 3)* |
| D-26 | **Open question:** history currently shows the product's **current** name and SKU (no snapshot columns). Should it instead show the name/SKU as they were at the time of each movement? That would require adding snapshot columns (e.g. `product_name`, `product_sku`) to `stock_transactions`, which this spec does **not** add unless the mentor requires it. *(new in revision 3)* |

### 10.2 Technical design decisions `[T-xx]` (open to mentor review)
| ID | Decision |
|---|---|
| T-01 | Stateless bearer-token authentication with Firebase ID tokens; no server sessions; CSRF disabled. |
| T-02 | `FirebaseTokenVerifier` interface so tests use a fake verifier without real Firebase credentials. |
| T-03 | Single authentication flow: `FirebaseAuthFilter` verifies the token, `UserProvisioningService` finds or creates the user and resolves the role on every protected request; `/api/auth/me` only returns the resolved user. Frontend force-refreshes the token after email verification and registration. |
| T-04 | Pessimistic product-row lock and database `CHECK` constraints in addition to `@Transactional`. |
| T-05 | `database/schema.sql` is the schema source of truth; `ddl-auto=validate`; `ON DELETE RESTRICT` foreign keys; InnoDB, `utf8mb4` with explicit collation `utf8mb4_0900_ai_ci` (case- and accent-insensitive category/supplier name uniqueness), `BIGINT` keys. *(explicit collation added in revision 4)* |
| T-06 | UTC: `java.time.Instant` in Java, `DATETIME(6)` columns, `hibernate.jdbc.time_zone=UTC`, `connectionTimeZone=UTC`, application-set timestamps, `UTC_TIMESTAMP(6)` in seed data, ISO-8601 UTC in the API. History date range: `from` inclusive, `to` exclusive, `from` > `to` → 400. *(date-range rule added in revision 4)* |
| T-07 | Vite dev proxy for `/api` plus explicit CORS for the frontend origin. |
| T-08 | `BIGINT` / `long` for `products.quantity` and `stock_transactions.quantity_after`; `INT` for per-movement quantity and reorder level. Dashboard aggregates (`totalStockQuantity`, `stockByCategory[].totalQuantity`) are `java.math.BigInteger`, because `SUM` over BIGINT rows can exceed `Long.MAX_VALUE`; they are never converted to `long`, `double` or another lossy type. All BIGINT-backed API values (`quantity`, `quantityAfter`, `totalStockQuantity`, `totalQuantity`) are JSON decimal strings of the exact integer (no exponent, no fraction); the frontend displays them via `BigInt(...).toLocaleString()`, calculates with `BigInt`, and computes chart widths with `barWidthPercent`, which returns `0` when the maximum is `0`. Database IDs stay JSON numbers and are treated by the frontend as opaque identifiers (no arithmetic). *(string representation added in revision 3; `BigInteger` aggregates, zero-safe chart width and opaque-ID rule added in revision 7)* |
| T-09 | RFC 9457 `ProblemDetail` error format with `code` and `fieldErrors`; status/code mapping in Section 6.5. |
| T-10 | Pagination DTO; default size 20, max 100; deterministic ordering (`name ASC, id ASC`; `created_at DESC, id DESC`). |
| T-11 | `users.email` indexed but not unique; identity is the Firebase UID. |
| T-12 | `stock_transactions` is append-only, with no `updated_at` column and no edit/delete endpoints. |
| T-13 | Minimal dependencies: no axios, Redux, form, chart or UI frameworks; CSS Modules with global tokens; no H2 or Testcontainers. |
| T-14 | Additional pages/components: NotFound, Forbidden, AppLayout, Modal, ConfirmDialog, Toast, Pagination, EmptyState; route structure in Section 7.3. |
| T-15 | Responsive breakpoints (1024px / 768px), button variants, and accessibility specifics. |
| T-16 | Dashboard shows top 5 low-stock products, latest 10 movements and a hand-built stock-by-category chart. |
| T-17 | Validation limits mirror column sizes; price max 2 decimal places; optional product description; category/supplier name uniqueness; additional test tools (Mockito, Vitest, React Testing Library, jsdom). |
| T-18 | Database separation and safety guards: automated tests use the **existing** `inventory_test` schema; they never execute `schema.sql` and never run `DROP`, `TRUNCATE` or other DDL; `ddl-auto=validate` plus read-only `SchemaConformanceIT` detect schema drift; test data is removed only by `DatabaseCleaner`'s guarded `DELETE` statements (child-to-parent: `stock_transactions`, `products`, `users`, `suppliers`, `categories`); `_test`-suffix checks before every cleanup and at startup of the `test` and `e2e` profiles; integration and E2E tests share `inventory_test` but never run concurrently. *(revised in revision 6: previously "reset scripts" that dropped tables and re-applied `schema.sql`; changed to the least-privilege approach of the Backend Implementation Plan, decision D-PLAN-1)* |
| T-19 | Repeatable E2E registration using per-run plus-addressed emails derived from `E2E_REGISTER_EMAIL`, deleted via the Firebase Auth REST API in teardown. |
| T-20 | Token verification uses `FirebaseAuth.verifyIdToken(idToken, true)` (revocation check enabled, one extra Firebase lookup per request). Classification (Section 4.3): invalid, expired, revoked, disabled-user and deleted-user tokens → 401 `UNAUTHENTICATED`; certificate-fetch and network/service failures → 503 `AUTH_SERVICE_UNAVAILABLE`; any other Firebase or unexpected error → 500 `INTERNAL_ERROR` without internal details. Slice tests use the fake verifier to simulate these outcomes; a separate unit test proves the production verifier calls `verifyIdToken(token, true)` and applies the classification. *(new in revision 3; classification refined in revision 4)* |
| T-21 | **Spring Boot 4.1.2** replaces the 3.x baseline, because Spring Boot 3.5 (the last 3.x line) reached end of open-source support on 2026-06-30, while 4.1 is supported until 2027-07-31 and runs on Java 17. Consequences: Spring Framework 7.0.10, Spring Security 7.1.2, Hibernate ORM 7.4.13, Jackson 3.1.7 (default JSON library; Jackson 2 support in Boot 4 is deprecated and not used), MySQL Connector/J 9.7.0, JUnit Jupiter 6.0.3 (successor of JUnit 5 named in the brief), modular starters (`spring-boot-starter-webmvc`, module-specific test starters). Firebase Admin SDK **9.11.0** (latest 9.x): it uses Gson, not Jackson, so it does not conflict with Jackson 3; Spring Boot's dependency management upgrades its Netty (4.2.18 → 4.2.19), httpclient5 (5.6.4 → 5.6.5) and slf4j (2.0.19 → 2.0.20) to patch-compatible versions. Hibernate 7 maps `Instant` to `DATETIME` on MySQL, matching `DATETIME(6)`; remaining mapping details (`BOOLEAN`/`TINYINT(1)`, `@Enumerated` columns) are confirmed by the `ddl-auto=validate` integration test in the first backend milestone. *(new in revision 5; pending mentor review)* |

---

## 11. Repository Layout

```
Inventory-Tracking-System-/      (repository root; the brief's "Inventory-Tracking-System/")
├── api/                    Spring Boot application (Maven)
├── web/                    React + Vite application
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── queries.sql
├── docs/
│   ├── architecture.md
│   ├── database-design.md
│   ├── api-documentation.md
│   └── superpowers/specs/  design specifications (this file)
├── README.md
├── .gitignore
└── .env.example            (plus api/.env.example and web/.env.example as needed)
```

## 12. Delivery Workflow (brief)
1. All work on `feature/inventory-tracking-setup`; never on `main`; never force-push.
2. Phases follow the project brief (database → backend → security → APIs → stock → frontend → integration → testing → polish → documentation → verification).
3. Each phase ends with relevant checks run and results reported.
4. Commits, pushes, Pull Request creation and merges happen only with explicit student approval.
