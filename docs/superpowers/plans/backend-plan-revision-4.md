# Backend Implementation Plan — Inventory Tracking System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (the student has ruled out multi-agent execution). Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project rules overriding the skill template:**
> - There are **no commit steps**. Every task ends with a *checkpoint*: run the task's tests, report exact results to the student, and wait. Commits, pushes and PRs happen only with explicit student approval.
> - Steps marked **⛔ APPROVAL GATE** must not run until the student explicitly approves them in the conversation. They are the steps that execute integration tests which write to (and clean) `inventory_test`.

**Plan revision:** 4 — after third technical review (skip-property semantics for Surefire/Failsafe 3.5.6, partial runs vs full verification, semantics-preserving CHECK normalisation). Revision 3 added approval gates, read-only vs data-writing integration tests, deeper schema conformance, explicit `skipUTs`/`skipITs`, the empty-inventory dashboard and IntelliJ configuration.

**Goal:** Build the Spring Boot REST API (`api/`) described in the design spec: Firebase-authenticated, role-protected endpoints for products, categories, suppliers, stock IN/OUT, history and dashboard, on the existing MySQL schema.

**Architecture:** Layered Spring Boot 4.1.2 app (`controller → service → repository → entity`, DTO records at the edge). A `FirebaseAuthFilter` verifies Bearer ID tokens through a `FirebaseTokenVerifier` interface (Admin SDK in production, a fake in tests), provisions the MySQL user per request, and sets `ROLE_USER`/`ROLE_ADMIN`. Hibernate validates against the existing schema (never generates DDL); errors are RFC 9457 `ProblemDetail` with a `code`.

**Tech Stack:** Java 17, Spring Boot 4.1.2 (Spring Framework 7.0.10, Spring Security 7.1.2, Hibernate ORM 7.4.13, Jackson 3.1.7, MySQL Connector/J 9.7.0, JUnit Jupiter 6.0.3, Mockito 5.23.0), Firebase Admin SDK 9.11.0, Maven 3.9.6 (Surefire 3.5.6 + Failsafe 3.5.6, versions managed by Spring Boot 4.1.2), MySQL 8.0.45.

**Spec:** `docs/superpowers/specs/2026-11-01-inventory-tracking-system-design.md` (Revision 5). Section numbers below (§) refer to it. Files under `database/` are **read-only** for this phase: `schema.sql` is only ever read by a parser; it is never executed or modified.

---

## Global Constraints

- Java **17**; Spring Boot **4.1.2** parent; Firebase Admin **9.11.0**; no other versions pinned — everything else comes from Spring Boot dependency management `[T-21]`.
- Dependencies limited to: `spring-boot-starter-webmvc`, `-data-jpa`, `-security`, `-validation`, `com.mysql:mysql-connector-j` (runtime), `com.google.firebase:firebase-admin`; test: `spring-boot-starter-test`, `spring-boot-starter-webmvc-test`, `spring-security-test`. Build plugins: `spring-boot-maven-plugin`, `maven-surefire-plugin`, `maven-failsafe-plugin` (versions from the Boot parent). No Lombok, MapStruct, H2 or Testcontainers `[T-13]`.
- `spring.jpa.hibernate.ddl-auto=validate`; `spring.jpa.open-in-view=false`; `spring.jpa.properties.hibernate.jdbc.time_zone=UTC`; JDBC URL includes `connectionTimeZone=UTC` `[T-05][T-06]`.
- Timestamps: `java.time.Instant`, set by Hibernate (`@CreationTimestamp`/`@UpdateTimestamp`, JVM source); serialised ISO-8601 UTC `[T-06]`.
- BIGINT-backed API values (`quantity`, `quantityAfter`, `totalStockQuantity`, `totalQuantity`) are JSON **strings** via `@JsonFormat(shape = JsonFormat.Shape.STRING)`; INT-backed values and IDs are numbers `[T-08]`.
- Every paginated/ordered query ends with `id`: products `name ASC, id ASC`; history `createdAt DESC, id DESC`; categories/suppliers `name ASC` `[T-10]`.
- Page params: `page ≥ 0` (default 0), `1 ≤ size ≤ 100` (default 20) `[T-10]`.
- Error body = `ProblemDetail` + `code` + `fieldErrors` (always present, `[]` when empty); never SQL, constraint/table names, class names, stack traces or token contents `[T-09]`.
- Aggregates over possibly-empty sets use `coalesce(…, 0)` in the query and primitive `long` results, so an empty inventory yields `0`, never `null` `[T-16]`.
- Config only from environment: `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS`, `APP_SECURITY_ADMIN_EMAILS`, `APP_CORS_ALLOWED_ORIGIN` (default `http://localhost:5173`) (§9.1). No secrets in Git.
- Automated tests touch **only** a database whose name ends with `_test`; a guard enforces it (§8.2, `[T-18]`). No DDL, `DROP`, `TRUNCATE`, extra privileges, root operations or production/shared database access.
- Test class naming: `*Test` = unit/slice tests (no database, Surefire); `*IT` = MySQL integration tests (Failsafe). Support classes must match **neither** pattern nor start with `Test` (Surefire's default includes `Test*`).
- Package root `com.inventory`; Maven `groupId com.inventory`, `artifactId inventory-api`, project folder `api/`.

## Test Execution Strategy (Maven)

Spring Boot 4.1.2 manages **Surefire 3.5.6** and **Failsafe 3.5.6** (`maven-surefire-plugin.version`, `maven-failsafe-plugin.version` in `spring-boot-dependencies-4.1.2.pom`, checked 2026-11-01).

`pom.xml` declares, under `<properties>`: `<skipUTs>false</skipUTs>` and `<skipITs>false</skipITs>`; and under `<build><plugins>`:

- **Surefire** (bound to `test`):
  - `<skipTests>${skipUTs}</skipTests>` — Surefire's only skip switch, rebound to the project property `skipUTs`.
  - `<excludes><exclude>**/*IT.java</exclude></excludes>` (default includes otherwise).
- **Failsafe** (`integration-test` + `verify`; executions and `classesDirectory` come from the Boot parent's `pluginManagement`, which does **not** activate the plugin, so it is declared explicitly):
  - `<skipITs>${skipITs}</skipITs>`.
  - `<skipTests>false</skipTests>` — neutralises the command-line `-DskipTests` for Failsafe (see below).
  - `<includes><include>**/*IT.java</include></includes>`.
- Both: `<systemPropertyVariables><inventory.schemaFile>${project.basedir}/../database/schema.sql</inventory.schemaFile></systemPropertyVariables>`.
- Neither sets `failIfNoSpecifiedTests=false` (defaults `surefire.failIfNoSpecifiedTests=true`, `failsafe.failIfNoSpecifiedTests=true`), so a mistyped `-Dtest` / `-Dit.test` fails the build instead of passing with zero tests.

**How the skip switches interact.** A Maven plugin parameter that is configured explicitly in the POM takes its value from that configuration; the parameter's own user property (for example `skipTests`) is only consulted when the parameter is *not* configured. Applied here:

| Command-line property | Surefire 3.5.6 (`skipTests` configured as `${skipUTs}`) | Failsafe 3.5.6 (`skipITs` = `${skipITs}`, `skipTests` = `false`) |
|---|---|---|
| *(none)* | runs | runs |
| `-DskipUTs` | **skipped** (`${skipUTs}` → `true`) | runs |
| `-DskipITs` | runs | **skipped** |
| `-DskipTests` | runs — the explicit `${skipUTs}` configuration wins over the `skipTests` user property | runs — Failsafe 3.5.6 would otherwise still bind its deprecated `skipTests` parameter to `-DskipTests` (that binding is only removed in 3.6.0); the explicit `false` overrides it |
| `-Dmaven.test.skip` | skipped, and test classes are not compiled | skipped |

Without the explicit Failsafe `<skipTests>false</skipTests>`, `mvn verify -DskipTests` on 3.5.6 would run the unit tests and silently skip the integration tests — the opposite of what the flag name suggests. With it, `-DskipTests` has **no effect** in this project; it is documented as "do not use". `-Dmaven.test.skip` is likewise not used. All of the above follows the official plugin documentation and is **not yet executed** — Task 1 Step 6 runs each row and records the actual result.

**Partial runs versus full verification.**

- **Full verification** is exactly `mvn verify` **with no skip property and no test filter** (`skipUTs`, `skipITs`, `skipTests`, `maven.test.skip`, `test`, `it.test` all absent). Only this command may be reported as "the complete backend test suite passed", and only after the Task 11 skip check below succeeds.
- **Partial runs** — `mvn test`, `-Dtest=…`, `-Dit.test=…`, `-DskipUTs`, `-DskipITs` — are legitimate during development (for example `mvn verify -DskipITs` to run all unit/slice tests while intentionally skipping integration tests). Every report of a partial run states what was intentionally skipped, e.g. *"Partial run: unit/slice tests 84/84 passed; integration tests intentionally skipped (-DskipITs). This is not a full verification."* A partial run is never presented as full verification.

All commands run from `api/`:

| Purpose | Command | Kind | Touches DB? |
|---|---|---|---|
| One unit/slice test class | `mvn test -Dtest=ProductServiceTest` | partial | no |
| One unit test method | `mvn test -Dtest=ProductServiceTest#archiveWithStockIsBlocked` | partial | no |
| All unit/slice tests | `mvn test` | partial | no |
| All unit/slice tests through the full lifecycle, integration tests intentionally skipped | `mvn verify -DskipITs` | partial | no |
| One **read-only** integration test | `mvn verify -DskipUTs -Dit.test=SchemaConformanceIT` | partial | reads only |
| One **data-writing** integration test | `mvn verify -DskipUTs -Dit.test=StockServiceIT` | partial | ⛔ writes + cleans `inventory_test` |
| One integration test method | `mvn verify -DskipUTs -Dit.test=StockServiceIT#concurrentStockOutOfLastUnitsAllowsExactlyOne` | partial | ⛔ if data-writing |
| All integration tests | `mvn verify -DskipUTs` | partial | ⛔ |
| **Complete suite** | `mvn verify` | **full verification** | ⛔ |

The final check (Task 11) proves no `*IT` was skipped in the full run: the number of `src/test/java/**/*IT.java` classes must equal the number of `target/failsafe-reports/TEST-*IT.xml` files, and each report must have `tests > 0`, `skipped="0"`, `failures="0"`, `errors="0"`.

## Test Database Strategy (least privilege)

The schema already exists in `inventory_test` (created from `database/schema.sql` during the database phase; verified 2026-11-01: 5 tables, 20 constraints, 17 indexes, 0 rows). Integration tests **use it as-is**; nothing drops, truncates or re-creates tables.

**Two kinds of integration test, two base classes:**

| Base class (test support) | Used by | Cleanup | Approval |
|---|---|---|---|
| `ReadOnlyIntegrationSupport` | `ApplicationContextIT`, `SchemaConformanceIT` | **none** — these tests only run `SELECT` / `information_schema` queries | may run without a gate |
| `DataWritingIntegrationSupport` | every other `*IT` | `DatabaseCleaner.deleteAll()` in `@BeforeEach` **and** `@AfterAll` | ⛔ gated (below) |

1. **Guard** — `TestDatabaseGuard` (active in `test` and `e2e` profiles) refuses to start unless `SELECT DATABASE()` ends with `_test`. `DatabaseCleaner` repeats the check immediately before every cleanup.
2. **Mapping check** — `ddl-auto=validate` fails startup if any entity does not match the tables.
3. **Drift check** — `SchemaConformanceIT` (read-only, see *Schema Conformance*).
4. **Isolation** — `DatabaseCleaner.deleteAll()`: guard, then `DELETE FROM stock_transactions; DELETE FROM products; DELETE FROM users; DELETE FROM suppliers; DELETE FROM categories;` (child → parent, so foreign keys are never violated). Before each test it guarantees a known empty state; after the class it leaves `inventory_test` empty again. `TRUNCATE` is not used (it needs `DROP`). AUTO_INCREMENT values keep growing; no test assumes specific IDs.
5. **Convention enforcement** — `IntegrationTestConventionsTest` (unit test, Surefire, no DB) scans compiled test classes: every `*IT` must extend exactly one of the two base classes, and only the classes on an explicit read-only allowlist (`ApplicationContextIT`, `SchemaConformanceIT`) may extend `ReadOnlyIntegrationSupport`. A new data-writing `*IT` that forgets the cleaner therefore fails the unit build.
6. Integration tests and E2E tests both use `inventory_test` and must not run at the same time (§8.2).

**⛔ Approval gates for data-writing tests.** `DatabaseCleaner.deleteAll()` deletes **all rows** in the five tables of `inventory_test`. Therefore:
- No data-writing `*IT` and no cleanup runs until the student approves.
- **Gate G1 (Task 2)** is the **first execution ever** of a data-writing integration test. Before asking, the assistant reports the current `inventory_test` row counts (read-only query) so the student knows exactly what would be deleted.
- Each later task that introduces new data-writing `*IT` classes has its own gate (G2–G7) before their first run. A gate is passed only by explicit student approval in the conversation; approval of one gate does not extend to the next.
- Re-running an already-approved data-writing `*IT` within the same task after a fix is covered by that task's gate; the final full `mvn verify` (Task 11) has its own gate (G8).

**Deviation from spec §8.2 / `[T-18]`:** the spec says the test reset "drops the tables and re-applies `database/schema.sql`". This plan replaces that with the steps above, which need no `DROP` privilege and never execute `schema.sql`. → **Decision D-PLAN-1**.

## Schema Conformance (read-only)

`SchemaConformanceIT` compares `inventory_test` with `database/schema.sql` **as text**. `SchemaSqlModel.parse(Path)` (test support) reads the file with regular expressions matched to its formatting and builds an expected model; the test queries `information_schema` for `DATABASE()` and compares. Nothing is executed against the database except `SELECT`s.

| Aspect | Expected (parsed from `schema.sql`) | Actual (`information_schema`) | Comparison |
|---|---|---|---|
| Tables | `CREATE TABLE <t>` names | `TABLES.TABLE_NAME` | equal sets |
| Engine / collation | trailing `ENGINE = InnoDB … COLLATE = utf8mb4_0900_ai_ci` per table | `TABLES.ENGINE`, `TABLES.TABLE_COLLATION` | equal per table |
| Primary keys | `CONSTRAINT pk_<t> PRIMARY KEY (cols)` | `STATISTICS` where `INDEX_NAME = 'PRIMARY'` ordered by `SEQ_IN_INDEX` | equal column lists |
| Unique constraints | `CONSTRAINT <name> UNIQUE (cols)` | `TABLE_CONSTRAINTS` type `UNIQUE` + `STATISTICS` columns by `SEQ_IN_INDEX` | equal names and ordered columns |
| Secondary indexes | `INDEX <name> (cols)` | `STATISTICS` (`NON_UNIQUE = 1`) columns by `SEQ_IN_INDEX` | equal names and ordered columns; no extra indexes |
| Foreign keys | `CONSTRAINT <name> FOREIGN KEY (col) REFERENCES <t> (col) ON DELETE <rule> ON UPDATE <rule>` | `KEY_COLUMN_USAGE` (source column, `REFERENCED_TABLE_NAME`, `REFERENCED_COLUMN_NAME`, `ORDINAL_POSITION`) + `REFERENTIAL_CONSTRAINTS` (`DELETE_RULE`, `UPDATE_RULE`) | equal per constraint name |
| CHECK constraints | `CONSTRAINT <name> CHECK (<expr>)` (the text inside the CHECK's own parentheses) | `CHECK_CONSTRAINTS.CHECK_CLAUSE` | equal names; expressions equal after the semantics-preserving normalisation below |

**CHECK normalisation — only rewrites known to be semantically equivalent.** MySQL stores CHECK expressions in its own canonical form (observed in the database phase, e.g. ``((`role` collate utf8mb4_bin) in (_utf8mb4\'USER\',_utf8mb4\'ADMIN\'))``). `SchemaSqlModel.normaliseCheck` tokenises the expression (string literals are single tokens and are **never altered**) and applies, in order:

1. **Unescape** `\'` → `'` inside the stored clause (escaping artefact of `information_schema`, not part of the expression).
2. **Remove the `_utf8mb4` introducer** directly in front of a string literal (MySQL adds the column's character set explicitly; the literal's value is unchanged).
3. **Remove backticks** around identifiers (quoting does not change meaning for these plain names).
4. **Lower-case keywords and identifiers outside string literals** (`IN`/`in`, `BETWEEN`/`between`, `COLLATE`/`collate`, column names are case-insensitive in MySQL). **String literal contents keep their case** — `'USER'` and `'user'` remain different, which matters under `utf8mb4_bin`.
5. **Whitespace:** collapse runs to one space; remove spaces directly after `(`, before `)` and around `,`.
6. **Remove exactly two kinds of parentheses that MySQL adds and that cannot change meaning:**
   - one pair that encloses the **entire** expression (only if the `(` at position 0 matches the `)` at the last position — `(a) and (b)` is untouched);
   - a pair that encloses **only** `<identifier> collate <collation>` (COLLATE binds tighter than every comparison operator, so the grouping is redundant).

   **All other parentheses are kept**, so `(a or b) and c` and `a or (b and c)` stay different, and `IN ( … )` lists keep their brackets.

Worked example: `role COLLATE utf8mb4_bin IN ('USER', 'ADMIN')` (schema.sql) and ``((`role` collate utf8mb4_bin) in (_utf8mb4\'USER\',_utf8mb4\'ADMIN\'))`` (MySQL) both normalise to `role collate utf8mb4_bin in ('USER','ADMIN')`. `quantity BETWEEN 1 AND 1000000` and ``(`quantity` between 1 and 1000000)`` both normalise to `quantity between 1 and 1000000`.

If an expression still differs after normalisation, the test fails and prints **both original strings**; no further rewriting is attempted.

On any mismatch the test fails with: *"inventory_test does not match database/schema.sql (<aspect>: expected …, found …) — re-create it manually as described in database/README.md §3"*. Column types and nullability are covered by `ddl-auto=validate`.

## Schema File Location

`file:../database/schema.sql` depends on the working directory. Instead, `SchemaFile.locate()` (test support) resolves the file in this order:

1. **Explicit system property `inventory.schemaFile`.** Under Maven, Surefire and Failsafe set it to `${project.basedir}/../database/schema.sql`. If the property is set but the file does not exist, `locate()` fails immediately (an explicit misconfiguration is not silently overridden).
2. **Fallback search** (property not set): starting at `user.dir`, check `<dir>/database/schema.sql` for the directory itself and up to 3 parents. This finds the file when the working directory is the repository root (level 0) or `api/` (level 1).
3. **Otherwise fail** with: *"Cannot locate database/schema.sql. Tried system property inventory.schemaFile (<value or 'not set'>) and searched upward from <user.dir>. Run tests through Maven, or set the JUnit working directory to the repository root or api/, or add -Dinventory.schemaFile=<absolute path to database/schema.sql>."*

The file is opened **read-only** by `SchemaSqlModel`; it is never executed, copied or modified.

**Direct JUnit runs in IntelliJ.** The plan does **not** assume IntelliJ passes Maven's `systemPropertyVariables` to tests it runs with its own JUnit runner. Documented setup (`api/README.md`, Task 11):

- **Recommended:** in *Run → Edit Configurations… → Edit configuration templates… → JUnit*, set **Working directory** to the absolute path of `api/` (e.g. `D:\projects\Inventory-Tracking-System-\api`). With that, `SchemaFile` finds the schema via the fallback (level 1) and the `test` profile finds `test-db.properties`.
- **Alternative / explicit:** add VM option `-Dinventory.schemaFile=D:\projects\Inventory-Tracking-System-\database\schema.sql` to the same template.
- **Or** run tests through Maven from IntelliJ's Maven tool window (`test` / `verify`), which uses the `pom.xml` configuration exactly.
- If neither is configured and the working directory is elsewhere, tests fail fast with the message above rather than reading a wrong file.

`test-db.properties` is located the same way: `application-test.yml` imports `optional:file:./test-db.properties,optional:file:./api/test-db.properties`, so it is found from `api/` or from the repository root. If neither file exists, startup fails on the unresolved `TEST_DB_URL` placeholder, and `api/README.md` explains the fix.

## Database Constraint Mapping

`DataIntegrityViolationException` is classified from **structured** data:

1. Walk the cause chain. First `org.hibernate.exception.ConstraintViolationException` → `getConstraintName()` and `getKind()` (confirm in Hibernate 7.4.13 with `javap` in Task 3; skip if absent).
2. First `java.sql.SQLException` → `getSQLState()` and `getErrorCode()` (MySQL vendor code).
3. Classify (only when SQLSTATE class is `23`):

| Condition | Category | HTTP / `code` |
|---|---|---|
| kind `UNIQUE` **or** vendor `1062` | `DUPLICATE` | 409 `DUPLICATE_RESOURCE` |
| vendor `1451` or `1217` (parent row still referenced) | `STILL_REFERENCED` | 409 `RESOURCE_IN_USE` |
| vendor `1452` or `1216` (referenced parent missing) | `PARENT_MISSING` | 404 `NOT_FOUND` |
| anything else (incl. NOT NULL `1048`; CHECK `3819` has SQLSTATE `HY000`) | `OTHER` | 500 `INTERNAL_ERROR` |

4. The constraint name only selects a client-safe message (`uk_products_sku` → "A product with this SKU already exists."; `uk_categories_name` → "A category with this name already exists."; `uk_suppliers_name` → "A supplier with this name already exists."; `fk_products_category` → "This category is used by one or more products."; `fk_products_supplier` → "This supplier is used by one or more products."; unknown/null → generic per category). Name, SQLSTATE and vendor code are logged server-side only.
5. Services still check business rules first; the mapping is the safety net for races. `uk_users_firebase_uid` is handled inside provisioning (Task 5).

## Decisions Requiring Student Approval

- **D-PLAN-1** — Amend spec §8.2 and `[T-18]`: integration tests use the existing `inventory_test` schema with guard + `validate` + `SchemaConformanceIT` + DELETE-based cleanup (data-writing tests only, behind approval gates); no automated DROP/re-create; `schema.sql` never executed by tests. (E2E reset in the frontend phase will be planned separately under the same rules.)
- **D-PLAN-2** — A database foreign-key failure because a referenced row is missing (race between check and insert) maps to 404 `NOT_FOUND`.
- **Gates G1–G8** — each requires explicit approval at the time it is reached (see *Test Database Strategy*).

## Prerequisites (student actions)

- **P1 — Test DB credentials file (never committed, never read by the assistant).** Create `api/test-db.properties`:
  ```properties
  TEST_DB_URL=jdbc:mysql://localhost:3306/inventory_test?connectionTimeZone=UTC
  TEST_DB_USERNAME=inventory_dev
  TEST_DB_PASSWORD=<your password>
  ```
  The `test` profile imports it from `./test-db.properties` or `./api/test-db.properties` (works from `api/` and from the repository root); `.gitignore` excludes it. IntelliJ setup: see *Schema File Location → Direct JUnit runs in IntelliJ*.
- **P2 — Not needed for automated tests:** a Firebase service-account key. Without it the app cannot *start* in the default profile, so a manual `mvn spring-boot:run` smoke test is reported **not verified** unless provided (§9.3).
- No additional MySQL privileges and no root-level operations are required.

## Compatibility Risks and Mitigations

| # | Risk | Mitigation (task) |
|---|---|---|
| R1 | Boot 4 modular starters / test-module artifact names | Task 1 `mvn dependency:tree`; adjust from Boot 4.1 docs if needed, report |
| R2 | Hibernate 7 maps `@Enumerated(STRING)` to native MySQL `ENUM` → `validate` fails against `VARCHAR` | `@JdbcTypeCode(SqlTypes.VARCHAR)` on enum fields (Task 2); `ApplicationContextIT` proves it |
| R3 | `BOOLEAN`/`TINYINT(1)` vs Hibernate boolean under `validate` | Same test; fallback `@JdbcTypeCode(SqlTypes.TINYINT)` on `active`, reported |
| R4 | `Instant` ↔ `DATETIME(6)` | Hibernate 7 doc: `Instant` → `DATETIME` on MySQL; `TimestampRoundTripIT` (Task 2) |
| R5 | Firebase transitive deps overridden by Boot (Netty, httpclient5, slf4j patch bumps) | Task 1 records `dependency:tree`; `FirebaseConfig` only loads when `app.firebase.enabled=true` |
| R6 | Jackson 3 vs `@JsonFormat` | Slice tests assert BIGINT fields are JSON strings (Tasks 8–10) |
| R7 | Spring Security 7 DSL changes | Lambda DSL only; `SecurityRulesTest` (Task 6) |
| R8 | Real Firebase verification untestable without P2 | `FirebaseAdminTokenVerifierTest` mocks `FirebaseAuth`; end-to-end check deferred to integration/E2E phase |
| R9 | Hibernate may not extract a constraint name / kind for every MySQL error (generic `1216/1217`) | Fallback to SQLSTATE + vendor code; `ConstraintMappingIT` records real behaviour (Task 3) |
| R10 | Failsafe not activated, or skip flags mis-bound (Failsafe 3.5.6 still binds `skipTests` to `-DskipTests`) → `*IT` silently skipped | Plugin declared explicitly; `skipUTs`/`skipITs` bound separately; Failsafe `<skipTests>false</skipTests>`; Task 1 Step 6 runs every skip combination; Task 11 count check; partial runs labelled as such |
| R11 | `inventory_test` schema drifts from `schema.sql` | `SchemaConformanceIT` (indexes, FKs, CHECKs, collation) fails with manual re-create instructions |
| R12 | `schema.sql` formatting changes break the regex parser | Parser fails loudly on an unrecognised `CONSTRAINT`/`INDEX` line instead of skipping it (`SchemaSqlModelTest`) |
| R13 | IntelliJ's own JUnit runner may not receive Maven `systemPropertyVariables` or the expected working directory | Not assumed: `SchemaFile` fallback search + `test-db.properties` dual import + clear failure message; IntelliJ template documented (working directory `api/` or explicit `-Dinventory.schemaFile`); `SchemaFileTest` covers each path |

## Review Focus

1. **Search input containing `%` or `_`** must match literally → `ProductRepositoryIT.searchTreatsWildcardsLiterally` (Task 8).
2. **SKU differing only by case/whitespace** → 409 `DUPLICATE_RESOURCE`, not 500 → `ProductServiceTest.createRejectsNormalisedDuplicateSku` (Task 8).
3. **Renaming a category to a case variant of its own name** must succeed → `CategoryServiceTest.updateAllowsCaseChangeOfOwnName` (Task 7).
4. **Out-of-range paging** (`size=101`, `size=0`, `page=-1`) → 400 `VALIDATION_FAILED` → `ProductControllerTest.rejectsOutOfRangePaging`, `StockControllerTest.historyRejectsOutOfRangePaging` (Tasks 8, 9).
5. **Valid Firebase token without an email claim** → 401 → `UserProvisioningServiceTest.tokenWithoutEmailIsRejected` (Task 5).

---

## File Structure

```
.gitignore                                   target/, .idea/, *.iml, .env, .env.*, !.env.example,
                                             *service-account*.json, api/test-db.properties, node_modules/
api/
  pom.xml                                    deps + Surefire/Failsafe configuration above
  .env.example                               placeholders for §9.1 backend variables
  README.md                                  configuration, running, test commands, approval note
  src/main/java/com/inventory/
    InventoryApiApplication.java
    config/  AppSecurityProperties, AppCorsProperties, AppFirebaseProperties (records),
             FirebaseConfig, TestDatabaseGuard
    security/ SecurityConfig, FirebaseAuthFilter, FirebaseTokenVerifier, FirebaseAdminTokenVerifier,
              VerifiedToken, AuthenticatedUser, InvalidTokenException, AuthServiceUnavailableException,
              AuthVerificationException, ProblemDetailWriter, JsonAuthenticationEntryPoint,
              JsonAccessDeniedHandler
    entity/  AppUser, Category, Supplier, Product, StockTransaction, Role, TransactionType
    repository/ AppUserRepository, CategoryRepository, SupplierRepository, ProductRepository,
                StockTransactionRepository, NameCount (projection record)
    service/ UserProvisioningService, CategoryService, SupplierService, ProductService,
             StockService, DashboardService
    controller/ AuthController, CategoryController, SupplierController, ProductController,
                StockController, DashboardController
    dto/     PageResponse, IdName, MeResponse, CategoryRequest/Response, SupplierRequest/Response,
             ProductRequest/Response, StockMovementRequest, StockTransactionResponse,
             DashboardResponse, LowStockProduct, CategoryStock (Task 2)
    exception/ ErrorCode, ApiFieldError, ApiException, NotFoundException, DuplicateResourceException,
               ResourceInUseException, InsufficientStockException, ProductHasStockException,
               RequestValidationException, ConstraintViolationClassifier, GlobalExceptionHandler
    util/    LikePatterns
  src/main/resources/ application.yml, application-e2e.yml
  src/test/resources/ application-test.yml
  src/test/java/com/inventory/
    support/ ReadOnlyIntegrationSupport, DataWritingIntegrationSupport (abstract bases),
             DatabaseCleaner, SchemaFile, SchemaSqlModel, Fixtures, FakeFirebaseTokenVerifier,
             WebSlice (meta-annotation)
    IntegrationTestConventionsTest.java
    …one *Test / *IT class per production area, named in each task
```

Spec-to-task mapping: §4.2–4.3 → Tasks 4–6; §5 → Task 2; §6.1 → Task 6; §6.2 → Tasks 6–10; §6.3–6.5 → Task 3 + each API task; §8.1 → every task; §8.2 → Tasks 1–2 (as amended by D-PLAN-1); §9 → Tasks 1, 11.

---

### Task 1: Maven project, test split, configuration and test-database guard

**Spec:** §2, §4.5 items 4–8, §8.2, §9.1–9.2, `[T-05][T-06][T-18][T-21]`; plan sections *Test Execution Strategy*, *Test Database Strategy*, *Schema File Location*.

**Database access in this task: read-only only** (no gate needed).

**Files:**
- Create: `.gitignore`, `api/pom.xml`, `api/.env.example`, `api/src/main/java/com/inventory/InventoryApiApplication.java`, `config/AppSecurityProperties.java`, `config/AppCorsProperties.java`, `config/AppFirebaseProperties.java`, `config/TestDatabaseGuard.java`, `src/main/resources/application.yml`, `src/main/resources/application-e2e.yml`
- Create (test): `src/test/resources/application-test.yml`, `support/SchemaFile.java`, `support/DatabaseCleaner.java`, `support/ReadOnlyIntegrationSupport.java`, `support/DataWritingIntegrationSupport.java`, `IntegrationTestConventionsTest.java`, `config/TestDatabaseGuardTest.java`, `support/SchemaFileTest.java`, `support/DatabaseCleanerTest.java`, `ApplicationContextIT.java`

**Interfaces:**
- Produces:
  - `record AppSecurityProperties(List<String> adminEmails)` → `app.security` (env `APP_SECURITY_ADMIN_EMAILS`, comma-separated, default empty); `record AppCorsProperties(String allowedOrigin)` → `app.cors`; `record AppFirebaseProperties(boolean enabled)` → `app.firebase` (default `true`; `false` in `test`).
  - `TestDatabaseGuard` — `@Component @Profile({"test","e2e"})`; at startup runs `SELECT DATABASE()` and calls `static void requireTestDatabase(String name)`, which throws `IllegalStateException("Refusing to use database '<name>': name must end with _test")` unless `name != null && name.endsWith("_test")`.
  - `static Path SchemaFile.locate()` → delegates to `static Path locate(String propertyValue, Path startDir)` with `System.getProperty("inventory.schemaFile")` and `Path.of(System.getProperty("user.dir"))`; resolution order and failure message as in *Schema File Location*.
  - `DatabaseCleaner.deleteAll(JdbcTemplate)` — `requireTestDatabase(SELECT DATABASE())`, then the five `DELETE` statements in child → parent order. Statement list exposed as `static List<String> DELETE_STATEMENTS` for the unit test.
  - `abstract class ReadOnlyIntegrationSupport` — `@SpringBootTest @ActiveProfiles("test")`; exposes `protected JdbcTemplate jdbc`; **no cleanup**.
  - `abstract class DataWritingIntegrationSupport` — same annotations; `@BeforeEach` and `@AfterAll` (static, via `@TestInstance(PER_CLASS)`) call `DatabaseCleaner.deleteAll(jdbc)`.
  - `IntegrationTestConventionsTest` — scans `target/test-classes` for `*IT.class`; asserts each extends exactly one base and `READ_ONLY_ALLOWLIST = Set.of("ApplicationContextIT", "SchemaConformanceIT")` matches the `ReadOnlyIntegrationSupport` subclasses exactly.

- [ ] **Step 1:** Create `pom.xml` per Global Constraints and *Test Execution Strategy*. Run `mvn dependency:tree -DoutputFile=<session scratchpad>/dependency-tree.txt` (absolute scratchpad path; never inside the repository). Expected: resolves; record netty, httpclient5, gson, guava and Jackson 2/3 versions for the report (R1, R5).
- [ ] **Step 2: Write failing tests**
  ```java
  // TestDatabaseGuardTest
  @Test void acceptsTestSuffix()       { assertDoesNotThrow(() -> TestDatabaseGuard.requireTestDatabase("inventory_test")); }
  @Test void rejectsDevelopmentDb()    { assertThrows(IllegalStateException.class, () -> TestDatabaseGuard.requireTestDatabase("inventory_db")); }
  @Test void rejectsNullAndLookalike() { assertThrows(IllegalStateException.class, () -> TestDatabaseGuard.requireTestDatabase(null));
                                         assertThrows(IllegalStateException.class, () -> TestDatabaseGuard.requireTestDatabase("inventory_test_backup")); }
  // SchemaFileTest (uses the two-argument overload; no reliance on the JVM's real working directory)
  @Test void locatesSchemaFromMavenProperty()  { assertThat(SchemaFile.locate()).exists().hasFileName("schema.sql"); }  // under Maven
  @Test void fallbackFindsSchemaFromApiDir()   { assertThat(SchemaFile.locate(null, repoRoot.resolve("api"))).isEqualTo(repoRoot.resolve("database/schema.sql")); }
  @Test void fallbackFindsSchemaFromRepoRoot() { assertThat(SchemaFile.locate(null, repoRoot)).isEqualTo(repoRoot.resolve("database/schema.sql")); }
  @Test void explicitMissingPathFailsFast()    { assertThatThrownBy(() -> SchemaFile.locate("C:/nope/schema.sql", repoRoot)).hasMessageContaining("inventory.schemaFile"); }
  @Test void notFoundMessageExplainsFixes(@TempDir Path elsewhere) {
      assertThatThrownBy(() -> SchemaFile.locate(null, elsewhere))
          .hasMessageContaining("working directory").hasMessageContaining("-Dinventory.schemaFile"); }
  // repoRoot = SchemaFile.locate().getParent().getParent()  (resolved once from the Maven property)
  // DatabaseCleanerTest (no DB: mocked JdbcTemplate)
  @Test void refusesNonTestDatabaseBeforeDeleting()   // SELECT DATABASE() → "inventory_db" ⇒ IllegalStateException; verify(jdbc, never()).update(startsWith("DELETE"))
  @Test void deletesChildTablesBeforeParents()        // DELETE_STATEMENTS order: stock_transactions, products, users, suppliers, categories
  // IntegrationTestConventionsTest
  @Test void everyIntegrationTestUsesABaseClass()
  @Test void onlyAllowlistedTestsAreReadOnly()
  // ApplicationContextIT extends ReadOnlyIntegrationSupport  (read-only)
  @Test void usesTestDatabase() { assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("inventory_test"); }
  ```
- [ ] **Step 3:** Run `mvn test` → FAIL (classes missing).
- [ ] **Step 4:** Implement. `application.yml` per Global Constraints. `application-test.yml`: `spring.config.import: optional:file:./test-db.properties,optional:file:./api/test-db.properties`, datasource from `TEST_DB_*`, `app.firebase.enabled: false`. `application-e2e.yml`: comment that `DB_URL` must point at `inventory_test`. IntelliJ setup is documented in Task 11 (no assumption that Maven properties reach IntelliJ's runner).
- [ ] **Step 5:** Run `mvn test` → PASS (unit tests only; no DB access).
- [ ] **Step 6: Prove the Maven test split and skip semantics (read-only; only `ApplicationContextIT` exists yet).** Record the actual log lines for each:
  - `mvn verify` → Surefire runs all unit tests **and** Failsafe runs `ApplicationContextIT` (`Tests run: 1, Failures: 0, Errors: 0, Skipped: 0`); `target/failsafe-reports/TEST-com.inventory.ApplicationContextIT.xml` has `tests="1" skipped="0"`.
  - `mvn verify -DskipUTs -Dit.test=ApplicationContextIT` → Surefire reports tests skipped; Failsafe runs `ApplicationContextIT`.
  - `mvn verify -DskipITs` → Surefire runs all unit tests; Failsafe reports tests skipped. Reported as a *partial run*.
  - `mvn verify -DskipTests` → **both** suites still run (proves Surefire's `${skipUTs}` configuration and Failsafe's explicit `<skipTests>false</skipTests>` override the command-line property). If either suite is skipped, stop and report — the configuration does not behave as documented.
  - `mvn verify -DskipUTs -Dit.test=DoesNotExistIT` → build **fails** (no silent pass).
  - `mvn test -Dtest=DoesNotExistTest` → build **fails**.
- [ ] **Checkpoint:** report all outputs and dependency versions; confirm `git status` does not list `test-db.properties`; report current `inventory_test` row counts (read-only) in preparation for gate G1.

---

### Task 2: Entities, repositories, schema validation and drift check

**Spec:** §5.2–5.3, `[T-05][T-06][T-08][T-11][T-12][T-16]`, R2–R4, R11–R12.

**Files:**
- Create: `entity/Role.java`, `entity/TransactionType.java`, `entity/AppUser.java`, `entity/Category.java`, `entity/Supplier.java`, `entity/Product.java`, `entity/StockTransaction.java`, `repository/*.java`, `repository/NameCount.java`, `dto/CategoryStock.java` (returned by `ProductRepository.stockByCategory()`; reused by Task 10)
- Test: `support/SchemaSqlModel.java`, `support/SchemaSqlModelTest.java`, `support/Fixtures.java`, `SchemaConformanceIT.java` (read-only), `TimestampRoundTripIT.java`, `repository/ProductRepositoryIT.java`, `repository/StockTransactionRepositoryIT.java`, `repository/CategoryRepositoryIT.java` (data-writing)

**Interfaces:**
- Produces (entities mirror §5.3 columns exactly; `AppUser` → `@Table(name = "users")`):
  - `enum Role { USER, ADMIN }`, `enum TransactionType { IN, OUT }` — `@Enumerated(EnumType.STRING) @JdbcTypeCode(SqlTypes.VARCHAR)`.
  - `Product`: `Long id; String sku; String name; String description; Category category (@ManyToOne LAZY, not null); Supplier supplier (@ManyToOne LAZY, nullable); BigDecimal price; long quantity; int reorderLevel; boolean active; Instant createdAt, updatedAt`.
  - `StockTransaction`: `Long id; Product product; AppUser user; TransactionType type; int quantity; long quantityAfter; String note; Instant createdAt` — constructor-only, no setters (append-only).
  - `ProductRepository`:
    - `Page<Product> search(String pattern, Long categoryId, boolean lowStockOnly, Pageable p)` — JPQL over active products; `(:categoryId is null or p.category.id = :categoryId)`; `(:lowStockOnly = false or p.quantity <= p.reorderLevel)`; `(:pattern is null or p.name like :pattern escape '!' or p.sku like :pattern escape '!')`.
    - `Optional<Product> findByIdAndActiveTrue(Long id)`; `@Lock(PESSIMISTIC_WRITE) Optional<Product> findActiveByIdForUpdate(Long id)`.
    - `boolean existsBySku(String)`, `existsBySkuAndIdNot(String, Long)`, `existsByCategoryId(Long)`, `existsBySupplierId(Long)` (archived included).
    - `List<NameCount> countByCategory()`, `countBySupplier()` — `record NameCount(Long id, long count)`, archived included.
    - Dashboard:
      - `long countByActiveTrue()`
      - `@Query("select coalesce(sum(p.quantity), 0) from Product p where p.active = true") long sumActiveQuantity()` — **returns 0 when no active products exist**
      - `long countActiveLowStock()`
      - `List<Product> findTop5ActiveLowStock()` (`quantity asc, name asc, id asc`)
      - `List<CategoryStock> stockByCategory()` — all categories, `coalesce(sum(p.quantity), 0)` over active products (outer join), ordered by category name. `record CategoryStock(String categoryName, @JsonFormat(shape=STRING) long totalQuantity)`.
  - `StockTransactionRepository`: `Page<StockTransaction> history(Long productId, TransactionType type, String pattern, Instant from, Instant to, Pageable p)` — joins product + user, no `active` filter, `createdAt >= :from` / `< :to` when non-null; `List<StockTransaction> findTop10ByOrderByCreatedAtDescIdDesc()`.
  - `CategoryRepository`/`SupplierRepository`: `existsByName(String)`, `existsByNameAndIdNot(String, Long)`, `findAllByOrderByNameAsc()`. `AppUserRepository`: `Optional<AppUser> findByFirebaseUid(String)`.
  - `SchemaSqlModel` (test): `static SchemaSqlModel parse(Path)` → `tables()`, `tableOptions(table)` (engine, collation), `primaryKey(table)`, `uniques(table)`, `indexes(table)` (name → ordered columns), `foreignKeys(table)` (name → column, refTable, refColumn, onDelete, onUpdate), `checks(table)` (name → expression); `static String normaliseCheck(String)`.
  - `Fixtures` (test): `category(name)`, `supplier(name)`, `product(sku, category, supplier, qty, reorder, active)`, `user(uid, email)`, `transaction(product, user, type, qty, after, Instant createdAt)`.

- [ ] **Step 1: Write failing unit tests**
  ```java
  // SchemaSqlModelTest (parses the real file; no DB)
  @Test void parsesAllFiveTables()           // tables() == {users, categories, suppliers, products, stock_transactions}
  @Test void parsesForeignKeyDetails()       // fk_products_category: category_id → categories(id), RESTRICT/RESTRICT
  @Test void parsesIndexColumnOrder()        // idx_stock_transactions_product_created == [product_id, created_at]
  // CHECK normalisation — equivalent forms match
  @Test void normalisesMySqlCollateInClause()  // both → "role collate utf8mb4_bin in ('USER','ADMIN')":
                                               //   "role COLLATE utf8mb4_bin IN ('USER', 'ADMIN')"
                                               //   "((`role` collate utf8mb4_bin) in (_utf8mb4\\'USER\\',_utf8mb4\\'ADMIN\\'))"
  @Test void normalisesBetweenClause()         // "quantity BETWEEN 1 AND 1000000" == "(`quantity` between 1 and 1000000)"
  @Test void normalisesSimpleComparison()      // "price >= 0" == "(`price` >= 0)"
  // CHECK normalisation — meaningful differences survive
  @Test void literalCaseIsPreserved()          // normaliseCheck("role in ('USER')") != normaliseCheck("role in ('user')")
  @Test void meaningfulParenthesesArePreserved() // normaliseCheck("(a or b) and c") != normaliseCheck("a or (b and c)")
  @Test void partialOuterParenthesesAreKept()  // normaliseCheck("(a > 0) and (b > 0)") == "(a > 0) and (b > 0)"
  @Test void differentOperatorsDiffer()        // normaliseCheck("price >= 0") != normaliseCheck("price > 0")
  @Test void failsOnUnrecognisedConstraintLine() // R12: a "CONSTRAINT x WEIRD (...)" line → IllegalStateException
  ```
- [ ] **Step 2:** Run `mvn test -Dtest=SchemaSqlModelTest` → FAIL; implement `SchemaSqlModel`; re-run → PASS.
- [ ] **Step 3: Write failing integration tests**
  ```java
  // SchemaConformanceIT extends ReadOnlyIntegrationSupport  (read-only; no cleanup)
  @Test void tablesEnginesAndCollationsMatch()
  @Test void primaryKeysMatch()
  @Test void uniqueConstraintsMatchNamesAndColumnOrder()
  @Test void secondaryIndexesMatchNamesAndColumnOrder()   // and no extra indexes in the database
  @Test void foreignKeysMatchColumnsTargetsAndRules()     // source column, referenced table/column, DELETE_RULE, UPDATE_RULE
  @Test void checkConstraintsMatchNormalisedExpressions()
  // TimestampRoundTripIT extends DataWritingIntegrationSupport
  @Test void instantRoundTripsAsUtc()     // JDBC insert created_at '2026-11-01 09:30:00.123456' → entity.getCreatedAt() == Instant.parse("2026-11-01T09:30:00.123456Z")
  // ProductRepositoryIT extends DataWritingIntegrationSupport
  @Test void searchExcludesArchivedAndOrdersByNameThenId()
  @Test void lowStockFilterUsesLessOrEqual()               // 5/5 included; 6/5 excluded
  @Test void countByCategoryIncludesArchived()             // 1 active + 1 archived → 2
  @Test void dashboardAggregatesIgnoreArchived()
  @Test void sumActiveQuantityIsZeroForEmptyInventory()    // no products at all → 0
  @Test void sumActiveQuantityIsZeroWhenAllArchived()      // only archived products (qty 0) → 0
  @Test void stockByCategoryIsZeroForCategoryWithoutActiveProducts()
  // StockTransactionRepositoryIT extends DataWritingIntegrationSupport
  @Test void historyIncludesArchivedProducts()
  @Test void historyFromInclusiveToExclusive()             // rows at from, between, at to → 2
  @Test void historyOrdersByCreatedAtDescThenIdDesc()
  // CategoryRepositoryIT extends DataWritingIntegrationSupport
  @Test void caseVariantNameViolatesUniqueIndex()          // saveAndFlush "electronics" after "Electronics" → DataIntegrityViolationException
  ```
- [ ] **Step 4:** Implement entities and repositories. Run `mvn test` (includes `IntegrationTestConventionsTest`) → PASS.
- [ ] **Step 5 (read-only):** Run `mvn verify -DskipUTs -Dit.test='ApplicationContextIT,SchemaConformanceIT'` → PASS. `ApplicationContextIT` now also exercises `validate` against the five entities; if it fails on `active` (R3), apply the fallback and report.
- [ ] **Step 6 — ⛔ APPROVAL GATE G1 (first execution ever of a data-writing integration test).** Stop. Report: the data-writing classes about to run (`TimestampRoundTripIT`, `ProductRepositoryIT`, `StockTransactionRepositoryIT`, `CategoryRepositoryIT`), that `DatabaseCleaner` will delete **all rows** in the five tables of `inventory_test` before each test and after each class, and the current `inventory_test` row counts. Wait for explicit approval.
- [ ] **Step 7 (after G1):** Run `mvn verify -DskipUTs -Dit.test='TimestampRoundTripIT,*RepositoryIT'` → PASS; then read-only row-count query shows `inventory_test` empty.
- [ ] **Checkpoint:** results, any R2/R3 mitigation applied.

---

### Task 3: Error model, constraint classification and shared DTOs

**Spec:** §6.3, §6.5, `[T-09][T-10]`, database README §11; plan section *Database Constraint Mapping*.

**Files:**
- Create: `exception/ErrorCode.java`, `exception/ApiFieldError.java`, `exception/ApiException.java`, `NotFoundException`, `DuplicateResourceException`, `ResourceInUseException`, `InsufficientStockException`, `ProductHasStockException`, `RequestValidationException`, `exception/ConstraintViolationClassifier.java`, `exception/GlobalExceptionHandler.java`, `security/ProblemDetailWriter.java`, `dto/PageResponse.java`, `dto/IdName.java`
- Test: `exception/ConstraintViolationClassifierTest.java`, `exception/GlobalExceptionHandlerTest.java` (standalone MockMvc + test-only `ThrowingController`), `exception/ConstraintMappingIT.java` (data-writing)

**Interfaces:**
- Produces:
  - `enum ErrorCode { VALIDATION_FAILED, MALFORMED_REQUEST, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, DUPLICATE_RESOURCE, RESOURCE_IN_USE, INSUFFICIENT_STOCK, PRODUCT_HAS_STOCK, AUTH_SERVICE_UNAVAILABLE, INTERNAL_ERROR }`, each with its `HttpStatus` (§6.5).
  - `record ApiFieldError(String field, String message)`.
  - `abstract class ApiException extends RuntimeException { ErrorCode code(); }`; `InsufficientStockException(int requested, long available)` → `"Insufficient stock: requested 8, available 5."`; `RequestValidationException(String field, String message)`.
  - `ConstraintViolationClassifier`: `enum Category { DUPLICATE, STILL_REFERENCED, PARENT_MISSING, OTHER }`; `record Classification(Category category, String constraintName, String sqlState, Integer vendorCode)`; `Classification classify(Throwable t)`; `String clientMessage(Classification c)` (never returns the constraint name).
  - `ProblemDetailWriter`: `ProblemDetail build(ErrorCode, String detail, String instance, List<ApiFieldError>)`; `void write(HttpServletResponse, ProblemDetail)`.
  - `record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages)` + `static <E,T> PageResponse<T> of(Page<E>, Function<E,T>)`; `record IdName(Long id, String name)`.
  - `GlobalExceptionHandler`: validation → 400 `VALIDATION_FAILED` + `fieldErrors`; malformed → 400 `MALFORMED_REQUEST`; `ApiException` → its code; `DataIntegrityViolationException` → classifier; `Exception` → 500 `INTERNAL_ERROR`, detail `"An unexpected error occurred."`.

- [ ] **Step 1:** Confirm Hibernate 7.4.13 API with `javap` (`ConstraintViolationException#getKind()` present or not); adapt `classify`.
- [ ] **Step 2: Write failing tests**
  ```java
  // ConstraintViolationClassifierTest
  static DataIntegrityViolationException chain(String sqlState, int vendor, String constraint) {
      var sql = new SQLIntegrityConstraintViolationException("raw message", sqlState, vendor);
      return new DataIntegrityViolationException("x", new org.hibernate.exception.ConstraintViolationException("x", sql, constraint));
  }
  @Test void duplicateFromVendorCode()          // chain("23000",1062,"uk_products_sku") → DUPLICATE, "uk_products_sku"
  @Test void stillReferenced1217And1451()       @Test void parentMissing1216And1452()
  @Test void nullConstraintNameStillClassified()@Test void notNullViolationIsOther()
  @Test void checkViolationIsOther()            // "HY000", 3819
  @Test void clientMessageNeverContainsConstraintName()
  // GlobalExceptionHandlerTest
  @Test void validationErrorHasFieldErrors() @Test void malformedJsonIs400Malformed() @Test void apiExceptionUsesItsCode()
  @Test void duplicateMapsTo409() @Test void stillReferencedMapsTo409() @Test void parentMissingMapsTo404()
  @Test void unexpectedErrorHidesInternals() @Test void everyErrorHasStandardFields()
  // ConstraintMappingIT extends DataWritingIntegrationSupport
  @Test void realDuplicateCategoryIsDuplicate()
  @Test void realDeleteOfReferencedCategoryIsStillReferenced()   // repository delete + flush, bypassing service
  @Test void realInsertWithMissingCategoryIsParentMissing()
  ```
- [ ] **Step 3:** `mvn test -Dtest='ConstraintViolationClassifierTest,GlobalExceptionHandlerTest'` → FAIL; implement; re-run → PASS.
- [ ] **Step 4 — ⛔ APPROVAL GATE G2** (first run of `ConstraintMappingIT`; cleans `inventory_test`). Wait for approval.
- [ ] **Step 5 (after G2):** `mvn verify -DskipUTs -Dit.test=ConstraintMappingIT` → PASS. Report constraint names / vendor codes actually observed (R9).
- [ ] **Checkpoint.**

---

### Task 4: Firebase token verification

**Spec:** §4.3 step 2, §4.5 item 1, `[T-02][T-20]`. **No database access.**

**Files:**
- Create: `security/VerifiedToken.java`, `security/FirebaseTokenVerifier.java`, `security/InvalidTokenException.java`, `security/AuthServiceUnavailableException.java`, `security/AuthVerificationException.java`, `security/FirebaseAdminTokenVerifier.java`, `config/FirebaseConfig.java`
- Test: `security/FirebaseAdminTokenVerifierTest.java`, `support/FakeFirebaseTokenVerifier.java`

**Interfaces:**
- Produces:
  - `record VerifiedToken(String uid, String email, boolean emailVerified, String name)`.
  - `interface FirebaseTokenVerifier { VerifiedToken verify(String idToken); }` — throws only the three runtime exceptions.
  - `FirebaseAdminTokenVerifier(FirebaseAuth auth)` calls **`auth.verifyIdToken(idToken, true)`**. Classification (`getAuthErrorCode()` for auth-specific errors, `getErrorCode()` for platform errors):
    - `AuthErrorCode` ∈ {`INVALID_ID_TOKEN`, `EXPIRED_ID_TOKEN`, `REVOKED_ID_TOKEN`, `USER_DISABLED`, `USER_NOT_FOUND`} → `InvalidTokenException`
    - `AuthErrorCode.CERTIFICATE_FETCH_FAILED`, or `getAuthErrorCode() == null` with `ErrorCode` ∈ {`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`}, or cause `IOException` → `AuthServiceUnavailableException`
    - anything else → `AuthVerificationException`; log Firebase codes only, never the token.
    - Confirm the enum constant names against the 9.11.0 jar with `javap` (§4.3).
  - `FirebaseConfig` — `@Configuration @ConditionalOnProperty(name = "app.firebase.enabled", havingValue = "true", matchIfMissing = true)`; beans `FirebaseApp` (`GoogleCredentials.getApplicationDefault()`), `FirebaseAuth`, `FirebaseTokenVerifier`.
  - `FakeFirebaseTokenVerifier` (test): `"user-token"` → uid `u-user`, `user@example.com`, verified; `"admin-token"` → `u-admin`, `admin@example.com`, verified; `"unverified-admin-token"` → `admin@example.com`, unverified; `"no-email-token"` → email null; `"revoked-token"`/`"disabled-token"`/`"expired-token"` → `InvalidTokenException`; `"firebase-down-token"` → `AuthServiceUnavailableException`; `"boom-token"` → `AuthVerificationException`; anything else → `InvalidTokenException`.

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void callsVerifyIdTokenWithRevocationCheck()   // verify(auth).verifyIdToken("t", true); verify(auth, never()).verifyIdToken("t")
  @Test void mapsDecodedTokenFields()
  @ParameterizedTest @EnumSource(value = AuthErrorCode.class, names = {"INVALID_ID_TOKEN","EXPIRED_ID_TOKEN","REVOKED_ID_TOKEN","USER_DISABLED","USER_NOT_FOUND"})
  void authFailuresAreInvalidToken(AuthErrorCode c)
  @Test void certificateFetchFailureIsUnavailable()
  @ParameterizedTest @EnumSource(value = ErrorCode.class, names = {"UNAVAILABLE","DEADLINE_EXCEEDED","RESOURCE_EXHAUSTED"})
  void platformOutagesAreUnavailable(ErrorCode c)
  @Test void ioFailureIsUnavailable()
  @Test void otherErrorsAreVerificationFailures()      // ErrorCode.PERMISSION_DENIED, authErrorCode null
  ```
- [ ] **Step 2:** `mvn test -Dtest=FirebaseAdminTokenVerifierTest` → FAIL; implement; re-run → PASS.
- [ ] **Checkpoint.**

---

### Task 5: User provisioning and role resolution

**Spec:** §3.1 FR-AUTH-4…9, §4.3 step 3, `[D-02][D-03][D-04][D-25][T-03][T-11]`.

**Files:**
- Create: `security/AuthenticatedUser.java`, `service/UserProvisioningService.java`
- Test: `service/UserProvisioningServiceTest.java`, `service/UserProvisioningServiceIT.java` (data-writing)

**Interfaces:**
- Consumes: `VerifiedToken` (Task 4), `AppUserRepository` (Task 2), `AppSecurityProperties` (Task 1).
- Produces:
  - `record AuthenticatedUser(Long userId, String firebaseUid, String email, String displayName, Role role)` + `Collection<GrantedAuthority> authorities()`.
  - `AuthenticatedUser UserProvisioningService.resolve(VerifiedToken token)` — no method-level `@Transactional`; `saveAndFlush` on insert; on `DataIntegrityViolationException` re-read `findByFirebaseUid`. Role `ADMIN` iff `emailVerified` and email (trimmed, case-insensitive) in the allowlist. Writes only when role/email/displayName changed. Display name: trim, blank → `null`, truncate to 100. Null/blank email → `InvalidTokenException`.

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void newUserGetsUserRole() @Test void verifiedAllowlistedEmailGetsAdmin() @Test void allowlistedButUnverifiedStaysUser()
  @Test void removedFromAllowlistIsDemoted() @Test void noWriteWhenNothingChanged() @Test void duplicateKeyOnInsertRereadsExistingRow()
  @Test void displayNameIsSanitised() @Test void tokenWithoutEmailIsRejected()   // Review Focus 5
  // UserProvisioningServiceIT extends DataWritingIntegrationSupport
  @Test void firstResolveInsertsRowSecondReusesIt()
  ```
- [ ] **Step 2:** `mvn test -Dtest=UserProvisioningServiceTest` → FAIL; implement; re-run → PASS.
- [ ] **Step 3 — ⛔ APPROVAL GATE G3** (first run of `UserProvisioningServiceIT`).
- [ ] **Step 4 (after G3):** `mvn verify -DskipUTs -Dit.test=UserProvisioningServiceIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 6: Security filter chain, CORS and `GET /api/auth/me`

**Spec:** §4.2–4.3, §6.1, §6.2 Auth, §6.5 (401/403/503/500), FR-AUTH-12/13, `[D-01][D-22][T-01][T-07][T-20]`. **No database access** (slice tests mock provisioning).

**Files:**
- Create: `security/FirebaseAuthFilter.java`, `security/JsonAuthenticationEntryPoint.java`, `security/JsonAccessDeniedHandler.java`, `security/SecurityConfig.java`, `dto/MeResponse.java`, `controller/AuthController.java`
- Test: `support/WebSlice.java`, `security/SecurityRulesTest.java`, `controller/AuthControllerTest.java`

**Interfaces:**
- Consumes: `FirebaseTokenVerifier`, `UserProvisioningService`, `ProblemDetailWriter`, `AppCorsProperties`.
- Produces:
  - `FirebaseAuthFilter extends OncePerRequestFilter` — not a Spring bean (constructed in `SecurityConfig`). No `Authorization: Bearer` → continue. Otherwise verify → resolve → `SecurityContextHolder` with `UsernamePasswordAuthenticationToken(authenticatedUser, null, authorities)`. `InvalidTokenException` → 401 `UNAUTHENTICATED`; `AuthServiceUnavailableException` → 503 `AUTH_SERVICE_UNAVAILABLE`; `AuthVerificationException` → 500 `INTERNAL_ERROR`.
  - `SecurityConfig`: stateless, CSRF disabled, CORS from `AppCorsProperties` (GET/POST/PUT/DELETE; headers `Authorization`, `Content-Type`); rules: `POST /api/stock/in|out` → authenticated; `POST|PUT|DELETE /api/products/**, /api/categories/**, /api/suppliers/**` → `hasRole("ADMIN")`; `GET /api/**` → authenticated; `/error` → permitAll; else `denyAll`.
  - `GET /api/auth/me` → `200 MeResponse(Long id, String email, String displayName, String role)`.
  - `@WebSlice` (test): `@WebMvcTest` + `@Import({SecurityConfig.class, FakeFirebaseTokenVerifier.class, ProblemDetailWriter.class})`; tests add `@MockitoBean UserProvisioningService` stubbed `u-user` → USER, `u-admin` → ADMIN.

- [ ] **Step 1: Write failing tests**
  ```java
  // SecurityRulesTest
  @Test void noTokenIs401() @Test void revokedTokenIs401() @Test void disabledTokenIs401() @Test void expiredTokenIs401()
  @Test void firebaseOutageIs503() @Test void unexpectedVerifierFailureIs500()
  @Test void userCannotWriteCatalog() @Test void adminCanWriteCatalog() @Test void userCanPostStock()
  @Test void corsPreflightAllowsConfiguredOriginOnly()
  // AuthControllerTest
  @Test void meReturnsResolvedRole()
  ```
- [ ] **Step 2:** `mvn test -Dtest='SecurityRulesTest,AuthControllerTest'` → FAIL; implement; re-run → PASS.
- [ ] **Checkpoint.**

---

### Task 7: Categories and suppliers

**Spec:** §3.4–3.5, §6.2 Categories/Suppliers, §6.4, `[D-06][D-23][T-05][T-17]`.

**Files:**
- Create: `dto/CategoryRequest.java`, `dto/CategoryResponse.java`, `dto/SupplierRequest.java`, `dto/SupplierResponse.java`, `service/CategoryService.java`, `service/SupplierService.java`, `controller/CategoryController.java`, `controller/SupplierController.java`
- Test: `service/CategoryServiceTest.java`, `service/SupplierServiceTest.java`, `controller/CategoryControllerTest.java`, `controller/SupplierControllerTest.java`, `service/CatalogDeletionIT.java` (data-writing)

**Interfaces:**
- Produces:
  - `record CategoryRequest(@NotBlank @Size(max=100) String name, @Size(max=255) String description)`; `record CategoryResponse(Long id, String name, String description, long productCount, Instant createdAt, Instant updatedAt)`.
  - `record SupplierRequest(@NotBlank @Size(max=150) String name, @Size(max=100) String contactPerson, @Email @Size(max=255) String email, @Size(max=30) String phone, @Size(max=255) String address)`; `SupplierResponse` = same fields + `id, productCount, createdAt, updatedAt`.
  - `CategoryService`: `list()`, `create(CategoryRequest)`, `update(Long, CategoryRequest)`, `void delete(Long)`; names trimmed; duplicate → `DuplicateResourceException`; `existsByCategoryId` → `ResourceInUseException`. `SupplierService` same shape.
  - Controllers: `GET` 200, `POST` 201 + `Location`, `PUT` 200, `DELETE` 204.

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void createRejectsCaseInsensitiveDuplicate() @Test void updateAllowsCaseChangeOfOwnName()   // Review Focus 3
  @Test void deleteBlockedWhenOnlyArchivedProductsReferToIt() @Test void listIncludesProductCount()
  @Test void postReturns201WithLocation() @Test void blankNameIs400WithFieldError() @Test void deleteInUseIs409ResourceInUse()
  @Test void invalidSupplierEmailIs400()  @Test void phoneOver30CharsIs400()
  // CatalogDeletionIT extends DataWritingIntegrationSupport
  @Test void categoryReferencedOnlyByArchivedProductCannotBeDeleted()
  ```
- [ ] **Step 2:** `mvn test -Dtest='Category*Test,Supplier*Test'` → FAIL; implement; re-run → PASS.
- [ ] **Step 3 — ⛔ APPROVAL GATE G4** (first run of `CatalogDeletionIT`).
- [ ] **Step 4 (after G4):** `mvn verify -DskipUTs -Dit.test=CatalogDeletionIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 8: Products (CRUD, search, archive)

**Spec:** §3.3, §6.2 Products, §6.4, `[D-05][D-07][D-08][D-09][D-10][D-11][D-16][D-24][T-08][T-10]`.

**Files:**
- Create: `util/LikePatterns.java`, `dto/ProductRequest.java`, `dto/ProductResponse.java`, `service/ProductService.java`, `controller/ProductController.java`
- Test: `util/LikePatternsTest.java`, `service/ProductServiceTest.java`, `controller/ProductControllerTest.java`, extend `repository/ProductRepositoryIT.java` (data-writing)

**Interfaces:**
- Produces:
  - `static String LikePatterns.contains(String raw)` → `null` for null/blank; else trim, escape `!`, `%`, `_` with `!`, wrap in `%…%`.
  - `record ProductRequest(@NotBlank @Pattern(regexp="^\\s*[A-Za-z0-9-]{3,50}\\s*$") String sku, @NotBlank @Size(max=150) String name, @Size(max=500) String description, @NotNull Long categoryId, Long supplierId, @NotNull @DecimalMin("0.00") @Digits(integer=10, fraction=2) BigDecimal price, @NotNull @Min(0) Integer reorderLevel)` — no quantity field.
  - `record ProductResponse(Long id, String sku, String name, String description, IdName category, IdName supplier, BigDecimal price, @JsonFormat(shape=STRING) long quantity, int reorderLevel, boolean lowStock, Instant createdAt, Instant updatedAt)`.
  - `ProductService`: `search(String search, Long categoryId, boolean lowStock, int page, int size)`, `get(Long)`, `create(ProductRequest)`, `update(Long, ProductRequest)`, `void archive(Long)`. SKU `trim().toUpperCase(Locale.ROOT)`; new products `quantity 0`, `active true`; missing/archived → `NotFoundException`; unknown category/supplier → `NotFoundException`; archive with `quantity > 0` → `ProductHasStockException`.
  - `ProductController` `@Validated`: `page` `@Min(0)`, `size` `@Min(1) @Max(100)`; `GET /api/products`, `GET /{id}`, `POST` 201 + Location, `PUT /{id}` 200, `DELETE /{id}` 204.

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void escapesWildcards() { assertThat(LikePatterns.contains("50%_a!")).isEqualTo("%50!%!_a!!%"); }
  @Test void blankIsNull()      { assertThat(LikePatterns.contains("  ")).isNull(); }
  @Test void createNormalisesSkuAndStartsAtZero() @Test void createRejectsNormalisedDuplicateSku()   // Review Focus 2
  @Test void updateIgnoresQuantity() @Test void getArchivedIs404() @Test void updateArchivedIs404()
  @Test void archiveWithStockIsBlocked() @Test void archiveWithZeroStockSetsInactive() @Test void unknownCategoryIs404()
  @Test void quantityIsSerialisedAsString() @Test void sentQuantityIsIgnoredOnCreate()
  @Test void invalidSkuIs400() @Test void negativePriceIs400() @Test void threeDecimalPriceIs400()
  @Test void rejectsOutOfRangePaging()   // Review Focus 4
  @Test void archiveWithStockIs409ProductHasStock()
  // ProductRepositoryIT (add)
  @Test void searchTreatsWildcardsLiterally()   // Review Focus 1
  ```
- [ ] **Step 2:** `mvn test -Dtest='LikePatternsTest,Product*Test'` → FAIL; implement; re-run → PASS.
- [ ] **Step 3 — ⛔ APPROVAL GATE G5** (first run of the new data-writing test added to `ProductRepositoryIT`; G1 covered only the Task 2 version of the class).
- [ ] **Step 4 (after G5):** `mvn verify -DskipUTs -Dit.test=ProductRepositoryIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 9: Stock IN/OUT and transaction history

**Spec:** §3.6–3.7, §4.5 item 3, §6.2 Stock, `[D-12][D-13][D-15][D-17][D-26][T-04][T-06][T-10][T-12]`.

**Files:**
- Create: `dto/StockMovementRequest.java`, `dto/StockTransactionResponse.java`, `service/StockService.java`, `controller/StockController.java`
- Test: `service/StockServiceTest.java`, `controller/StockControllerTest.java`, `service/StockServiceIT.java` (data-writing)

**Interfaces:**
- Consumes: `ProductRepository.findActiveByIdForUpdate`, `StockTransactionRepository`, `AppUserRepository.getReferenceById`, `AuthenticatedUser`.
- Produces:
  - `record StockMovementRequest(@NotNull Long productId, @NotNull @Min(1) @Max(1_000_000) Integer quantity, @Size(max=255) String note)`.
  - `record StockTransactionResponse(Long id, TransactionType type, int quantity, @JsonFormat(shape=STRING) long quantityAfter, String note, ProductRef product, UserRef user, Instant createdAt)`; `record ProductRef(Long id, String sku, String name)` (current values `[D-26]`); `record UserRef(Long id, String displayName, String email)`.
  - `StockService` (`@Transactional`): `stockIn(StockMovementRequest, AuthenticatedUser)`, `stockOut(…)` — lock via `findActiveByIdForUpdate`; IN `Math.addExact`; OUT `quantity > available` → `InsufficientStockException(requested, available)`; `saveAndFlush` transaction with `quantityAfter`; blank note → `null`.
  - `history(Long productId, TransactionType type, String search, Instant from, Instant to, int page, int size)` — `from.isAfter(to)` → `RequestValidationException("from", "must not be after 'to'")`; sort `createdAt DESC, id DESC`.
  - `StockController`: `POST /api/stock/in|out` → 201; `GET /api/stock/history` (`@DateTimeFormat(iso = DATE_TIME) Instant from/to`, paging bounds as Task 8).

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void stockInAddsAndRecordsQuantityAfter() @Test void stockOutSubtracts() @Test void stockOutAboveAvailableIs409()
  @Test void archivedOrMissingProductIs404() @Test void blankNoteStoredAsNull() @Test void fromAfterToIsValidationError()
  @Test void quantityZeroAndAboveMillionAre400() @Test void noteOver255Is400() @Test void quantityAfterIsString()
  @Test void historyFromAfterToIs400() @Test void historyRejectsOutOfRangePaging() @Test void invalidTypeParamIs400Malformed()
  // StockServiceIT extends DataWritingIntegrationSupport
  @Test void concurrentStockOutOfLastUnitsAllowsExactlyOne()  // qty 5; two threads OUT 5 → 1 success, 1 InsufficientStockException, final 0, 1 tx row
  @Test void failedTransactionInsertRollsBackQuantity()
  @Test void databaseCheckRejectsNegativeQuantity()           // JDBC UPDATE quantity = -1 → DataIntegrityViolationException
  @Test void historyShowsCurrentProductNameAfterRename()      // [D-26]
  ```
- [ ] **Step 2:** `mvn test -Dtest='Stock*Test'` → FAIL; implement; re-run → PASS.
- [ ] **Step 3 — ⛔ APPROVAL GATE G6** (first run of `StockServiceIT`; includes committed concurrent transactions, removed by the cleaner).
- [ ] **Step 4 (after G6):** `mvn verify -DskipUTs -Dit.test=StockServiceIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 10: Dashboard

**Spec:** §3.2, §6.2 Dashboard, `[D-05][D-08][T-08][T-16]`.

**Files:**
- Create: `dto/DashboardResponse.java`, `dto/LowStockProduct.java`, `service/DashboardService.java`, `controller/DashboardController.java`
- Consumes: `CategoryStock` and the dashboard queries of `ProductRepository` (Task 2), `StockTransactionResponse` (Task 9).
- Test: `service/DashboardServiceIT.java` (data-writing), `controller/DashboardControllerTest.java`

**Interfaces:**
- Produces:
  - `record DashboardResponse(long totalProducts, @JsonFormat(shape=STRING) long totalStockQuantity, long lowStockCount, List<LowStockProduct> lowStockProducts, List<StockTransactionResponse> recentTransactions, List<CategoryStock> stockByCategory)`; `record LowStockProduct(Long id, String sku, String name, @JsonFormat(shape=STRING) long quantity, int reorderLevel)`.
  - `DashboardResponse DashboardService.get()` (`@Transactional(readOnly = true)`); `GET /api/dashboard` → 200.

- [ ] **Step 1: Write failing tests**
  ```java
  // DashboardServiceIT extends DataWritingIntegrationSupport
  @Test void emptyInventoryReturnsZeros()          // no rows at all → totalProducts 0, totalStockQuantity 0 (not null), lowStockCount 0,
                                                   //   lowStockProducts [], recentTransactions [], stockByCategory []
  @Test void categoriesWithoutProductsReportZero() // 2 categories, no products → stockByCategory both totalQuantity 0
  @Test void figuresIgnoreArchivedProducts() @Test void lowStockListIsTop5OrderedByQuantity()
  @Test void recentTransactionsAreLatest10()
  // DashboardControllerTest
  @Test void bigintFieldsAreStrings()              // $.totalStockQuantity == "0" for an empty dashboard; $.stockByCategory[0].totalQuantity is a string
  ```
- [ ] **Step 2:** `mvn test -Dtest=DashboardControllerTest` → FAIL; implement; re-run → PASS.
- [ ] **Step 3 — ⛔ APPROVAL GATE G7** (first run of `DashboardServiceIT`).
- [ ] **Step 4 (after G7):** `mvn verify -DskipUTs -Dit.test=DashboardServiceIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 11: Full verification and backend documentation

**Spec:** §8.5, §9, §12; plan section *Test Execution Strategy*.

**Files:**
- Create: `api/README.md` (prerequisites, environment variables, the full command table incl. which commands touch the database, the approval rule for data-writing tests, profile overview, and an **IntelliJ section**: JUnit configuration template with working directory `api/` or VM option `-Dinventory.schemaFile=…`, the Maven tool-window alternative, and the meaning of the `Cannot locate database/schema.sql` and unresolved `TEST_DB_URL` failures)
- Modify: `api/.env.example` only if a variable was added.

- [ ] **Step 1 — ⛔ APPROVAL GATE G8** (complete suite; every data-writing `*IT` runs and cleans `inventory_test`).
- [ ] **Step 2 (after G8):** `cd api && mvn verify` — **no skip property and no test filter** → `BUILD SUCCESS`; record Surefire and Failsafe `Tests run / Failures / Errors / Skipped` separately. If any skip property or filter was used, the result is reported as a partial run and Step 2 is repeated without it.
- [ ] **Step 3: No skipped integration tests.** `find src/test/java -name '*IT.java' | wc -l` equals `ls target/failsafe-reports/TEST-*IT.xml | wc -l`; every report has `tests > 0`, `skipped="0"`, `failures="0"`, `errors="0"`.
- [ ] **Step 4: Secrets.** `git status --short --untracked-files=all` lists no `test-db.properties`, `.env` or credential `*.json`; `grep -rniE "password\s*=|BEGIN PRIVATE KEY" api/src` → only placeholders.
- [ ] **Step 5: Traceability.** Every §6.2 endpoint has a controller method and ≥ 1 test; every `D-xx`/`T-xx` the backend implements is cited by a task.
- [ ] **Step 6:** `git diff --stat -- database/` → empty; `inventory_db` row counts unchanged (5/4/12/0/0, read-only query); `inventory_test` row counts 0 (read-only query).
- [ ] **Checkpoint (final report):** features, structure, endpoints, auth, DB integration, exact test results (stating that they come from the unfiltered `mvn verify` and that Step 3 found no skipped `*IT`), environment variables, unresolved issues (incl. P2 manual run), files created, `git status`, branch. **No commit** until the student approves.
