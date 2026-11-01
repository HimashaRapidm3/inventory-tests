# Backend Implementation Plan — Inventory Tracking System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (the student has ruled out multi-agent execution). Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project rule overriding the skill template:** there are **no commit steps**. Every task ends with a *checkpoint*: run the task's tests, report exact results to the student, and wait. Commits, pushes and PRs happen only with explicit student approval.

**Plan revision:** 2 — after technical review (Surefire/Failsafe split, least-privilege test database, structured constraint mapping, reliable `schema.sql` location).

**Goal:** Build the Spring Boot REST API (`api/`) described in the design spec: Firebase-authenticated, role-protected endpoints for products, categories, suppliers, stock IN/OUT, history and dashboard, on the existing MySQL schema.

**Architecture:** Layered Spring Boot 4.1.2 app (`controller → service → repository → entity`, DTO records at the edge). A `FirebaseAuthFilter` verifies Bearer ID tokens through a `FirebaseTokenVerifier` interface (Admin SDK in production, a fake in tests), provisions the MySQL user per request, and sets `ROLE_USER`/`ROLE_ADMIN`. Hibernate validates against the existing schema (never generates DDL); errors are RFC 9457 `ProblemDetail` with a `code`.

**Tech Stack:** Java 17, Spring Boot 4.1.2 (Spring Framework 7.0.10, Spring Security 7.1.2, Hibernate ORM 7.4.13, Jackson 3.1.7, MySQL Connector/J 9.7.0, JUnit Jupiter 6.0.3, Mockito 5.23.0), Firebase Admin SDK 9.11.0, Maven 3.9.6 (Surefire + Failsafe), MySQL 8.0.45.

**Spec:** `docs/superpowers/specs/2026-11-01-inventory-tracking-system-design.md` (Revision 5). Section numbers below (§) refer to it. Files under `database/` are **read-only** for this phase.

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
- Config only from environment: `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `GOOGLE_APPLICATION_CREDENTIALS`, `APP_SECURITY_ADMIN_EMAILS`, `APP_CORS_ALLOWED_ORIGIN` (default `http://localhost:5173`) (§9.1). No secrets in Git.
- Automated tests touch **only** a database whose name ends with `_test`; a guard enforces it (§8.2, `[T-18]`). Tests never run DDL and need no privileges beyond the account's current `SELECT/INSERT/UPDATE/DELETE`.
- Test class naming: `*Test` = unit/slice tests (no database, Surefire); `*IT` = MySQL integration tests (Failsafe). Support classes must match **neither** pattern nor start with `Test` (Surefire's default includes `Test*`).
- Package root `com.inventory`; Maven `groupId com.inventory`, `artifactId inventory-api`, project folder `api/`.

## Test Execution Strategy (Maven)

`pom.xml` declares both plugins under `<build><plugins>`:

- **Surefire** (`mvn test`): default includes (`**/*Test.java`, …); explicit `<excludes><exclude>**/*IT.java</exclude></excludes>`; `<skipTests>${skipUTs}</skipTests>` with property `<skipUTs>false</skipUTs>`.
- **Failsafe** (`integration-test` + `verify` goals; executions and `classesDirectory` inherited from the Boot parent's `pluginManagement`, which does **not** activate the plugin by itself): includes `**/*IT.java`.
- Both pass `<systemPropertyVariables><inventory.schemaFile>${project.basedir}/../database/schema.sql</inventory.schemaFile></systemPropertyVariables>` (see *Schema File Location*).
- Neither plugin sets `failIfNoSpecifiedTests=false`, so a mistyped filter fails the build instead of passing with zero tests.

All commands run from `api/`:

| Purpose | Command |
|---|---|
| One unit/slice test class | `mvn test -Dtest=ProductServiceTest` |
| One unit test method | `mvn test -Dtest=ProductServiceTest#archiveWithStockIsBlocked` |
| One integration test class | `mvn verify -DskipUTs -Dit.test=StockServiceIT` |
| One integration test method | `mvn verify -DskipUTs -Dit.test=StockServiceIT#concurrentStockOutOfLastUnitsAllowsExactlyOne` |
| All unit/slice tests | `mvn test` |
| All integration tests | `mvn verify -DskipUTs` |
| **Complete suite** (final verification) | `mvn verify` |

Never use `-DskipTests`, `-DskipITs` or `-Dmaven.test.skip` for verification. The final check (Task 11) also proves no `*IT` was skipped: the number of `src/test/java/**/*IT.java` classes must equal the number of `target/failsafe-reports/TEST-*IT.xml` files, and each must report `tests > 0` with `skipped = 0`.

## Test Database Strategy (least privilege)

The schema already exists in `inventory_test` (created from `database/schema.sql` during the database phase; verified 2026-11-01: 5 tables, 20 constraints, 17 indexes, 0 rows). Integration tests **use it as-is**; nothing drops, truncates or re-creates tables.

1. **Guard** — `TestDatabaseGuard` (active in `test` and `e2e` profiles) refuses to start unless `SELECT DATABASE()` ends with `_test`. `DatabaseCleaner` repeats the check before every cleanup.
2. **Mapping check** — `ddl-auto=validate` fails startup if any entity does not match the tables.
3. **Drift check** — `SchemaConformanceIT` (read-only) parses the constraint and index names declared in `database/schema.sql` and compares them with `information_schema` for `inventory_test`, plus table collation `utf8mb4_0900_ai_ci`. This catches what Hibernate validation cannot (CHECK constraints, FK delete rules, index names). On mismatch it fails with: *"inventory_test does not match database/schema.sql — re-create it manually as described in database/README.md §3"*.
4. **Isolation** — `DatabaseCleaner.deleteAll()` runs before each integration test: guard, then `DELETE FROM stock_transactions; DELETE FROM products; DELETE FROM users; DELETE FROM suppliers; DELETE FROM categories;` (child → parent order, so foreign keys are never violated). `TRUNCATE` is not used (it needs `DROP`). AUTO_INCREMENT values keep growing; no test assumes specific IDs.
5. Integration tests and E2E tests both use `inventory_test` and must not run at the same time (§8.2).

**Deviation from spec §8.2 / `[T-18]`:** the spec says the test reset "drops the tables and re-applies `database/schema.sql`". This plan replaces that with steps 1–4, which need no `DROP` privilege. Schema re-creation is **not** necessary for correctness: validation plus the drift check detect a stale schema, and re-creating it stays a manual, student-approved step. → **Decision D-PLAN-1** below (amend §8.2/T-18 after approval).

## Schema File Location

`file:../database/schema.sql` depends on the working directory (Maven from `api/` works; IntelliJ or the repository root does not). Instead:

- Maven passes the absolute path as system property `inventory.schemaFile` (`${project.basedir}/../database/schema.sql`) to both Surefire and Failsafe. IntelliJ imports `systemPropertyVariables` from the Surefire/Failsafe configuration when it creates JUnit run configurations.
- `SchemaFile.locate()` (test support) returns that path if the property is set and the file exists; otherwise it walks up from `user.dir` (at most 3 levels) looking for `database/schema.sql`; otherwise it fails with a message naming both attempts.
- The file is only **read** (by `SchemaConformanceIT`); it is never executed, copied or modified.

## Database Constraint Mapping

`DataIntegrityViolationException` is classified from **structured** data, not by parsing the message text ourselves:

1. Walk the cause chain. Take the first `org.hibernate.exception.ConstraintViolationException` → `getConstraintName()` (Hibernate's MySQL dialect extracts it) and `getKind()` (`UNIQUE`, `FOREIGN_KEY`, …; confirm the method exists in Hibernate 7.4.13 with `javap` in Task 3 — if absent, skip it).
2. Take the first `java.sql.SQLException` → `getSQLState()` and `getErrorCode()` (MySQL vendor code).
3. Classify (only when SQLSTATE class is `23`):

| Condition | Category | HTTP / `code` |
|---|---|---|
| kind `UNIQUE` **or** vendor `1062` | `DUPLICATE` | 409 `DUPLICATE_RESOURCE` |
| vendor `1451` or `1217` (parent row still referenced) | `STILL_REFERENCED` | 409 `RESOURCE_IN_USE` |
| vendor `1452` or `1216` (referenced parent missing) | `PARENT_MISSING` | 404 `NOT_FOUND` |
| anything else (incl. NOT NULL `1048`; CHECK `3819` has SQLSTATE `HY000`) | `OTHER` | 500 `INTERNAL_ERROR` |

4. The constraint name only selects a **client-safe message** (`uk_products_sku` → "A product with this SKU already exists."; `uk_categories_name` → "A category with this name already exists."; `uk_suppliers_name` → "A supplier with this name already exists."; `fk_products_category` → "This category is used by one or more products."; `fk_products_supplier` → "This supplier is used by one or more products."; unknown/null → a generic message per category). The name, SQLSTATE and vendor code are logged server-side only.
5. Services still check business rules first (`existsBySku…`, `existsByCategoryId…`); the mapping is the safety net for races. `uk_users_firebase_uid` is handled inside provisioning (Task 5) and never reaches the handler.

`PARENT_MISSING → 404` follows §6.5 ("resource missing → 404"); → **Decision D-PLAN-2** below.

## Decisions Requiring Student Approval

- **D-PLAN-1** — Amend spec §8.2 and `[T-18]`: integration tests use the existing `inventory_test` schema with guard + `validate` + `SchemaConformanceIT` + DELETE-based cleanup; no automated DROP/re-create. (E2E reset in the frontend phase will be planned separately under the same least-privilege rule.)
- **D-PLAN-2** — A database foreign-key failure because a referenced row is missing (race between check and insert) maps to 404 `NOT_FOUND`.

## Prerequisites (student actions)

- **P1 — Test DB credentials file (never committed, never read by the assistant).** Create `api/test-db.properties`:
  ```properties
  TEST_DB_URL=jdbc:mysql://localhost:3306/inventory_test?connectionTimeZone=UTC
  TEST_DB_USERNAME=inventory_dev
  TEST_DB_PASSWORD=<your password>
  ```
  The `test` profile imports it with `spring.config.import=optional:file:./test-db.properties`; `.gitignore` excludes it. `./` is `api/` under Maven; IntelliJ run configurations must use `api/` as working directory (Task 1 Step 4, documented in `api/README.md`).
- **P2 — Not needed for automated tests:** a Firebase service-account key. Without it the app cannot *start* in the default profile, so a manual `mvn spring-boot:run` smoke test is reported **not verified** unless provided (§9.3).
- No additional MySQL privileges and no root-level operations are required.

## Compatibility Risks and Mitigations

| # | Risk | Mitigation (task) |
|---|---|---|
| R1 | Boot 4 modular starters / test-module artifact names | Task 1 resolves them with `mvn dependency:tree`; adjust from Boot 4.1 docs if one fails to resolve, and report |
| R2 | Hibernate 7 maps `@Enumerated(STRING)` to native MySQL `ENUM` → `validate` fails against `VARCHAR` | `@JdbcTypeCode(SqlTypes.VARCHAR)` on enum fields (Task 2); `ApplicationContextIT` proves it |
| R3 | `BOOLEAN`/`TINYINT(1)` vs Hibernate boolean under `validate` | Same test; fallback `@JdbcTypeCode(SqlTypes.TINYINT)` on `active`, reported |
| R4 | `Instant` ↔ `DATETIME(6)` | Hibernate 7 doc: `Instant` → `DATETIME` on MySQL; `TimestampRoundTripIT` (Task 2) |
| R5 | Firebase transitive deps overridden by Boot (Netty, httpclient5, slf4j patch bumps) | Task 1 records `dependency:tree`; `FirebaseConfig` only loads when `app.firebase.enabled=true` |
| R6 | Jackson 3 vs `@JsonFormat` | Slice tests assert BIGINT fields are JSON strings (Tasks 8–10) |
| R7 | Spring Security 7 DSL changes | Lambda DSL only; `SecurityRulesTest` (Task 6) |
| R8 | Real Firebase verification untestable without P2 | `FirebaseAdminTokenVerifierTest` mocks `FirebaseAuth`; end-to-end check deferred to integration/E2E phase |
| R9 | Hibernate may not extract a constraint name / kind for every MySQL error (e.g. generic `1216/1217` seen in the database phase) | Classification falls back to SQLSTATE + vendor code; `ConstraintMappingIT` records what Hibernate 7.4 + Connector/J 9.7 actually provide on MySQL 8.0.45 (Task 3) |
| R10 | Failsafe not activated → `*IT` silently skipped | Plugin declared explicitly; Task 1 proves `ApplicationContextIT` runs under `mvn verify`; Task 11 count check |
| R11 | `inventory_test` schema drifts from `schema.sql` (no automatic re-create) | `SchemaConformanceIT` fails with manual re-create instructions |

## Review Focus

1. **Search input containing `%` or `_`** (e.g. `?search=50%`) must match literally → `ProductRepositoryIT.searchTreatsWildcardsLiterally` (Task 8).
2. **SKU differing only by case/whitespace** (`" elec-001 "` vs `ELEC-001`) → 409 `DUPLICATE_RESOURCE`, not 500 → `ProductServiceTest.createRejectsNormalisedDuplicateSku` (Task 8).
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
  README.md                                  configuration, running, test commands
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
    support/ MySqlIntegrationSupport (abstract base), DatabaseCleaner, SchemaFile, Fixtures,
             FakeFirebaseTokenVerifier, WebSlice (meta-annotation)
    …one *Test / *IT class per production area, named in each task
```

Spec-to-task mapping: §4.2–4.3 → Tasks 4–6; §5 → Task 2; §6.1 → Task 6; §6.2 → Tasks 6–10; §6.3–6.5 → Task 3 + each API task; §8.1 → every task; §8.2 → Tasks 1–2 (as amended by D-PLAN-1); §9 → Tasks 1, 11.

---

### Task 1: Maven project, test split, configuration and test-database guard

**Spec:** §2, §4.5 items 4–8, §8.2, §9.1–9.2, `[T-05][T-06][T-18][T-21]`; plan sections *Test Execution Strategy*, *Test Database Strategy*, *Schema File Location*.

**Files:**
- Create: `.gitignore`, `api/pom.xml`, `api/.env.example`, `api/src/main/java/com/inventory/InventoryApiApplication.java`, `config/AppSecurityProperties.java`, `config/AppCorsProperties.java`, `config/AppFirebaseProperties.java`, `config/TestDatabaseGuard.java`, `src/main/resources/application.yml`, `src/main/resources/application-e2e.yml`
- Create (test): `src/test/resources/application-test.yml`, `support/SchemaFile.java`, `support/DatabaseCleaner.java`, `support/MySqlIntegrationSupport.java`, `config/TestDatabaseGuardTest.java`, `support/SchemaFileTest.java`, `ApplicationContextIT.java`

**Interfaces:**
- Produces:
  - `record AppSecurityProperties(List<String> adminEmails)` → `app.security` (env `APP_SECURITY_ADMIN_EMAILS`, comma-separated, default empty); `record AppCorsProperties(String allowedOrigin)` → `app.cors`; `record AppFirebaseProperties(boolean enabled)` → `app.firebase` (default `true`; `false` in `test`).
  - `TestDatabaseGuard` — `@Component @Profile({"test","e2e"})`; at startup runs `SELECT DATABASE()` and calls `static void requireTestDatabase(String name)`, which throws `IllegalStateException("Refusing to use database '<name>': name must end with _test")` unless `name != null && name.endsWith("_test")`.
  - `static Path SchemaFile.locate()` — property `inventory.schemaFile`, else walk up ≤ 3 levels from `user.dir` for `database/schema.sql`, else `IllegalStateException` naming both attempts.
  - `DatabaseCleaner.deleteAll(JdbcTemplate)` — `requireTestDatabase(SELECT DATABASE())`, then the five `DELETE` statements in child → parent order.
  - `abstract class MySqlIntegrationSupport` — `@SpringBootTest @ActiveProfiles("test")`; `@BeforeEach` → `DatabaseCleaner.deleteAll(jdbc)`; exposes `protected JdbcTemplate jdbc`.

- [ ] **Step 1:** Create `pom.xml` per Global Constraints and *Test Execution Strategy*. Run `mvn dependency:tree -DoutputFile=<session scratchpad>/dependency-tree.txt` (absolute scratchpad path; never inside the repository). Expected: resolves; record netty, httpclient5, gson, guava and Jackson 2/3 versions for the report (R1, R5).
- [ ] **Step 2: Write failing tests**
  ```java
  // TestDatabaseGuardTest
  @Test void acceptsTestSuffix()       { assertDoesNotThrow(() -> TestDatabaseGuard.requireTestDatabase("inventory_test")); }
  @Test void rejectsDevelopmentDb()    { assertThrows(IllegalStateException.class, () -> TestDatabaseGuard.requireTestDatabase("inventory_db")); }
  @Test void rejectsNullAndLookalike() { assertThrows(IllegalStateException.class, () -> TestDatabaseGuard.requireTestDatabase(null));
                                         assertThrows(IllegalStateException.class, () -> TestDatabaseGuard.requireTestDatabase("inventory_test_backup")); }
  // SchemaFileTest
  @Test void locatesSchemaFromMavenProperty() { assertThat(SchemaFile.locate()).exists().hasFileName("schema.sql"); }
  // ApplicationContextIT extends MySqlIntegrationSupport
  @Test void usesTestDatabase()          { assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("inventory_test"); }
  @Test void cleanerLeavesTablesEmpty()  { assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM categories", Long.class)).isZero(); }
  ```
- [ ] **Step 3:** Run `mvn test -Dtest='TestDatabaseGuardTest,SchemaFileTest'` → FAIL (classes missing).
- [ ] **Step 4:** Implement. `application.yml` per Global Constraints. `application-test.yml`: `spring.config.import: optional:file:./test-db.properties`, datasource from `TEST_DB_*`, `app.firebase.enabled: false`. `application-e2e.yml`: comment that `DB_URL` must point at `inventory_test`. For IntelliJ runs whose working directory is the repo root, the IntelliJ run configuration's working directory must be set to `api/` (documented in `api/README.md`, Task 11).
- [ ] **Step 5:** Run `mvn test -Dtest='TestDatabaseGuardTest,SchemaFileTest'` → PASS; then `mvn verify -DskipUTs -Dit.test=ApplicationContextIT` → PASS **and** the log shows `maven-failsafe-plugin` running `ApplicationContextIT` with `Tests run: 2` (proves R10).
- [ ] **Checkpoint:** report both outputs and dependency versions; confirm `git status` does not list `test-db.properties`.

---

### Task 2: Entities, repositories, schema validation and drift check

**Spec:** §5.2–5.3, `[T-05][T-06][T-08][T-11][T-12]`, R2–R4, R11.

**Files:**
- Create: `entity/Role.java`, `entity/TransactionType.java`, `entity/AppUser.java`, `entity/Category.java`, `entity/Supplier.java`, `entity/Product.java`, `entity/StockTransaction.java`, `repository/*.java`, `repository/NameCount.java`, `dto/CategoryStock.java` (returned by `ProductRepository.stockByCategory()`; reused by Task 10)
- Test: `support/Fixtures.java`, `SchemaConformanceIT.java`, `TimestampRoundTripIT.java`, `repository/ProductRepositoryIT.java`, `repository/StockTransactionRepositoryIT.java`, `repository/CategoryRepositoryIT.java`

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
    - Dashboard: `long countByActiveTrue()`, `long sumActiveQuantity()`, `long countActiveLowStock()`, `List<Product> findTop5ActiveLowStock()` (`quantity asc, name asc, id asc`), `List<CategoryStock> stockByCategory()` (all categories, active products only, by category name). `record CategoryStock(String categoryName, @JsonFormat(shape=STRING) long totalQuantity)`.
  - `StockTransactionRepository`: `Page<StockTransaction> history(Long productId, TransactionType type, String pattern, Instant from, Instant to, Pageable p)` — joins product + user, no `active` filter, `createdAt >= :from` / `< :to` when non-null; `List<StockTransaction> findTop10ByOrderByCreatedAtDescIdDesc()`.
  - `CategoryRepository`/`SupplierRepository`: `existsByName(String)`, `existsByNameAndIdNot(String, Long)`, `findAllByOrderByNameAsc()`. `AppUserRepository`: `Optional<AppUser> findByFirebaseUid(String)`.
  - `Fixtures` (test): `category(name)`, `supplier(name)`, `product(sku, category, supplier, qty, reorder, active)`, `user(uid, email)`, `transaction(product, user, type, qty, after, Instant createdAt)` — persist via repositories / `JdbcTemplate` (the latter for fixed `createdAt`).

- [ ] **Step 1: Write failing tests**
  ```java
  // SchemaConformanceIT (read-only)
  @Test void constraintNamesMatchSchemaSql()  // names from regex CONSTRAINT\s+(\w+) over SchemaFile.locate() == information_schema.TABLE_CONSTRAINTS names (excluding PRIMARY)
  @Test void indexNamesMatchSchemaSql()       // regex ^\s+INDEX\s+(\w+) ⊆ information_schema.STATISTICS index names
  @Test void foreignKeysAreRestrict()         // all REFERENTIAL_CONSTRAINTS.DELETE_RULE == "RESTRICT"
  @Test void tablesUseExpectedCollation()     // all TABLE_COLLATION == "utf8mb4_0900_ai_ci"
  // TimestampRoundTripIT
  @Test void instantRoundTripsAsUtc()         // insert created_at '2026-11-01 09:30:00.123456' via JDBC; entity.getCreatedAt() == Instant.parse("2026-11-01T09:30:00.123456Z")
  // ProductRepositoryIT
  @Test void searchExcludesArchivedAndOrdersByNameThenId()
  @Test void lowStockFilterUsesLessOrEqual()      // 5/5 included; 6/5 excluded
  @Test void countByCategoryIncludesArchived()    // 1 active + 1 archived → 2
  @Test void dashboardAggregatesIgnoreArchived()
  // StockTransactionRepositoryIT
  @Test void historyIncludesArchivedProducts()
  @Test void historyFromInclusiveToExclusive()    // rows at from, between, at to → 2
  @Test void historyOrdersByCreatedAtDescThenIdDesc()
  // CategoryRepositoryIT
  @Test void caseVariantNameViolatesUniqueIndex() // saveAndFlush "electronics" after "Electronics" → DataIntegrityViolationException
  ```
- [ ] **Step 2:** Run `mvn verify -DskipUTs -Dit.test='SchemaConformanceIT,TimestampRoundTripIT,*RepositoryIT'` → FAIL.
- [ ] **Step 3:** Implement entities and repositories. `ApplicationContextIT` now also exercises `validate` against the five entities; if it fails on `active` (R3), apply the fallback and report.
- [ ] **Step 4:** Run `mvn verify -DskipUTs` (all ITs so far) → PASS.
- [ ] **Checkpoint:** results, any R2/R3 mitigation applied.

---

### Task 3: Error model, constraint classification and shared DTOs

**Spec:** §6.3, §6.5, `[T-09][T-10]`, database README §11; plan section *Database Constraint Mapping*.

**Files:**
- Create: `exception/ErrorCode.java`, `exception/ApiFieldError.java`, `exception/ApiException.java`, `NotFoundException`, `DuplicateResourceException`, `ResourceInUseException`, `InsufficientStockException`, `ProductHasStockException`, `RequestValidationException`, `exception/ConstraintViolationClassifier.java`, `exception/GlobalExceptionHandler.java`, `security/ProblemDetailWriter.java`, `dto/PageResponse.java`, `dto/IdName.java`
- Test: `exception/ConstraintViolationClassifierTest.java`, `exception/GlobalExceptionHandlerTest.java` (standalone MockMvc + test-only `ThrowingController`), `exception/ConstraintMappingIT.java`

**Interfaces:**
- Produces:
  - `enum ErrorCode { VALIDATION_FAILED, MALFORMED_REQUEST, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, DUPLICATE_RESOURCE, RESOURCE_IN_USE, INSUFFICIENT_STOCK, PRODUCT_HAS_STOCK, AUTH_SERVICE_UNAVAILABLE, INTERNAL_ERROR }`, each with its `HttpStatus` (§6.5).
  - `record ApiFieldError(String field, String message)`.
  - `abstract class ApiException extends RuntimeException { ErrorCode code(); }`; `InsufficientStockException(int requested, long available)` → `"Insufficient stock: requested 8, available 5."`; `RequestValidationException(String field, String message)`.
  - `ConstraintViolationClassifier`:
    - `enum Category { DUPLICATE, STILL_REFERENCED, PARENT_MISSING, OTHER }`
    - `record Classification(Category category, String constraintName, String sqlState, Integer vendorCode)`
    - `Classification classify(Throwable t)` — algorithm in *Database Constraint Mapping* steps 1–3.
    - `String clientMessage(Classification c)` — step 4 table; never returns the constraint name.
  - `ProblemDetailWriter`: `ProblemDetail build(ErrorCode, String detail, String instance, List<ApiFieldError>)`; `void write(HttpServletResponse, ProblemDetail)` (used by Task 6).
  - `record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages)` + `static <E,T> PageResponse<T> of(Page<E>, Function<E,T>)`; `record IdName(Long id, String name)`.
  - `GlobalExceptionHandler`: `MethodArgumentNotValidException`, `HandlerMethodValidationException`, `RequestValidationException` → 400 `VALIDATION_FAILED` + `fieldErrors`; `HttpMessageNotReadableException`, `MethodArgumentTypeMismatchException`, `MissingServletRequestParameterException` → 400 `MALFORMED_REQUEST`; `ApiException` → its code; `DataIntegrityViolationException` → classifier (DUPLICATE → 409 `DUPLICATE_RESOURCE`, STILL_REFERENCED → 409 `RESOURCE_IN_USE`, PARENT_MISSING → 404 `NOT_FOUND`, OTHER → 500); `Exception` → 500 `INTERNAL_ERROR`, detail `"An unexpected error occurred."`, logged server-side.

- [ ] **Step 1:** Confirm Hibernate 7.4.13 API: `javap -cp <hibernate-core jar> org.hibernate.exception.ConstraintViolationException` — record whether `getKind()` exists; adapt `classify` accordingly.
- [ ] **Step 2: Write failing tests**
  ```java
  // ConstraintViolationClassifierTest — exceptions built as Spring → Hibernate → SQLException chains
  static DataIntegrityViolationException chain(String sqlState, int vendor, String constraint) {
      var sql = new SQLIntegrityConstraintViolationException("raw message", sqlState, vendor);
      return new DataIntegrityViolationException("x", new org.hibernate.exception.ConstraintViolationException("x", sql, constraint));
  }
  @Test void duplicateFromVendorCode()      // chain("23000",1062,"uk_products_sku") → DUPLICATE, constraintName "uk_products_sku"
  @Test void stillReferenced1217And1451()   // → STILL_REFERENCED
  @Test void parentMissing1216And1452()     // → PARENT_MISSING
  @Test void nullConstraintNameStillClassified() // chain("23000",1062,null) → DUPLICATE
  @Test void notNullViolationIsOther()      // 1048 → OTHER
  @Test void checkViolationIsOther()        // SQLSTATE "HY000", 3819 → OTHER
  @Test void clientMessageNeverContainsConstraintName()
  // GlobalExceptionHandlerTest
  @Test void validationErrorHasFieldErrors() @Test void malformedJsonIs400Malformed()
  @Test void apiExceptionUsesItsCode()       // $.detail "Insufficient stock: requested 8, available 5."
  @Test void duplicateMapsTo409()            // $.code DUPLICATE_RESOURCE; body lacks "uk_", "SQL", "23000"
  @Test void stillReferencedMapsTo409()      // $.code RESOURCE_IN_USE
  @Test void parentMissingMapsTo404()        // $.code NOT_FOUND
  @Test void unexpectedErrorHidesInternals() // RuntimeException("SELECT secret") → 500; body lacks "SELECT", "Exception", "at com."
  @Test void everyErrorHasStandardFields()   // type "about:blank", instance, fieldErrors == []
  // ConstraintMappingIT (MySQL; records what the real stack provides — R9)
  @Test void realDuplicateCategoryIsDuplicate()           // repository saveAndFlush → classify → DUPLICATE
  @Test void realDeleteOfReferencedCategoryIsStillReferenced() // categoryRepository.deleteById + flush, bypassing service → STILL_REFERENCED
  @Test void realInsertWithMissingCategoryIsParentMissing()    // JDBC/JPA insert product with unknown category_id → PARENT_MISSING
  ```
- [ ] **Step 3:** Run `mvn test -Dtest='ConstraintViolationClassifierTest,GlobalExceptionHandlerTest'` → FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the same command → PASS; then `mvn verify -DskipUTs -Dit.test=ConstraintMappingIT` → PASS. Report the constraint names / vendor codes actually observed.
- [ ] **Checkpoint.**

---

### Task 4: Firebase token verification

**Spec:** §4.3 step 2, §4.5 item 1, `[T-02][T-20]`.

**Files:**
- Create: `security/VerifiedToken.java`, `security/FirebaseTokenVerifier.java`, `security/InvalidTokenException.java`, `security/AuthServiceUnavailableException.java`, `security/AuthVerificationException.java`, `security/FirebaseAdminTokenVerifier.java`, `config/FirebaseConfig.java`
- Test: `security/FirebaseAdminTokenVerifierTest.java`, `support/FakeFirebaseTokenVerifier.java`

**Interfaces:**
- Produces:
  - `record VerifiedToken(String uid, String email, boolean emailVerified, String name)`.
  - `interface FirebaseTokenVerifier { VerifiedToken verify(String idToken); }` — throws only the three runtime exceptions.
  - `FirebaseAdminTokenVerifier(FirebaseAuth auth)` calls **`auth.verifyIdToken(idToken, true)`**. Classification (uses `getAuthErrorCode()` for auth-specific errors and `getErrorCode()` for platform errors):
    - `AuthErrorCode` ∈ {`INVALID_ID_TOKEN`, `EXPIRED_ID_TOKEN`, `REVOKED_ID_TOKEN`, `USER_DISABLED`, `USER_NOT_FOUND`} → `InvalidTokenException`
    - `AuthErrorCode.CERTIFICATE_FETCH_FAILED`, or `getAuthErrorCode() == null` with `ErrorCode` ∈ {`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`}, or cause `IOException` → `AuthServiceUnavailableException`
    - anything else → `AuthVerificationException`; log Firebase codes only, never the token.
    - Confirm the enum constant names against the 9.11.0 jar with `javap` (§4.3 requires it).
  - `FirebaseConfig` — `@Configuration @ConditionalOnProperty(name = "app.firebase.enabled", havingValue = "true", matchIfMissing = true)`; beans `FirebaseApp` (`GoogleCredentials.getApplicationDefault()`), `FirebaseAuth`, `FirebaseTokenVerifier`.
  - `FakeFirebaseTokenVerifier` (test): `"user-token"` → uid `u-user`, `user@example.com`, verified; `"admin-token"` → `u-admin`, `admin@example.com`, verified; `"unverified-admin-token"` → `admin@example.com`, unverified; `"no-email-token"` → email null; `"revoked-token"`/`"disabled-token"`/`"expired-token"` → `InvalidTokenException`; `"firebase-down-token"` → `AuthServiceUnavailableException`; `"boom-token"` → `AuthVerificationException`; anything else → `InvalidTokenException`.

- [ ] **Step 1: Write failing tests** (Mockito mocks `FirebaseAuth`; build `new FirebaseAuthException(ErrorCode, msg, cause, null, AuthErrorCode)`)
  ```java
  @Test void callsVerifyIdTokenWithRevocationCheck()   // verify(auth).verifyIdToken("t", true); verify(auth, never()).verifyIdToken("t")
  @Test void mapsDecodedTokenFields()
  @ParameterizedTest @EnumSource(value = AuthErrorCode.class, names = {"INVALID_ID_TOKEN","EXPIRED_ID_TOKEN","REVOKED_ID_TOKEN","USER_DISABLED","USER_NOT_FOUND"})
  void authFailuresAreInvalidToken(AuthErrorCode c)
  @Test void certificateFetchFailureIsUnavailable()
  @ParameterizedTest @EnumSource(value = ErrorCode.class, names = {"UNAVAILABLE","DEADLINE_EXCEEDED","RESOURCE_EXHAUSTED"})
  void platformOutagesAreUnavailable(ErrorCode c)      // authErrorCode null
  @Test void ioFailureIsUnavailable()
  @Test void otherErrorsAreVerificationFailures()      // ErrorCode.PERMISSION_DENIED, authErrorCode null
  ```
- [ ] **Step 2:** Run `mvn test -Dtest=FirebaseAdminTokenVerifierTest` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Checkpoint.**

---

### Task 5: User provisioning and role resolution

**Spec:** §3.1 FR-AUTH-4…9, §4.3 step 3, `[D-02][D-03][D-04][D-25][T-03][T-11]`.

**Files:**
- Create: `security/AuthenticatedUser.java`, `service/UserProvisioningService.java`
- Test: `service/UserProvisioningServiceTest.java`, `service/UserProvisioningServiceIT.java`

**Interfaces:**
- Consumes: `VerifiedToken` (Task 4), `AppUserRepository` (Task 2), `AppSecurityProperties` (Task 1).
- Produces:
  - `record AuthenticatedUser(Long userId, String firebaseUid, String email, String displayName, Role role)` + `Collection<GrantedAuthority> authorities()` (`ROLE_USER` / `ROLE_ADMIN`).
  - `AuthenticatedUser UserProvisioningService.resolve(VerifiedToken token)` — no method-level `@Transactional`; `saveAndFlush` on insert; on `DataIntegrityViolationException` re-read `findByFirebaseUid`. Role `ADMIN` iff `emailVerified` and email (trimmed, case-insensitive) is in the allowlist. Writes only when role/email/displayName changed. Display name: trim, blank → `null`, truncate to 100. Null/blank email → `InvalidTokenException`.

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void newUserGetsUserRole()
  @Test void verifiedAllowlistedEmailGetsAdmin()        // allowlist " Admin@Example.com " matches "admin@example.com"
  @Test void allowlistedButUnverifiedStaysUser()
  @Test void removedFromAllowlistIsDemoted()
  @Test void noWriteWhenNothingChanged()                // verify(repo, never()).saveAndFlush(any())
  @Test void duplicateKeyOnInsertRereadsExistingRow()
  @Test void displayNameIsSanitised()                   // "  " → null; 150 chars → 100
  @Test void tokenWithoutEmailIsRejected()              // Review Focus 5
  // UserProvisioningServiceIT
  @Test void firstResolveInsertsRowSecondReusesIt()     // users count 1 after two calls
  ```
- [ ] **Step 2:** Run `mvn test -Dtest=UserProvisioningServiceTest` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `mvn test -Dtest=UserProvisioningServiceTest` → PASS; `mvn verify -DskipUTs -Dit.test=UserProvisioningServiceIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 6: Security filter chain, CORS and `GET /api/auth/me`

**Spec:** §4.2–4.3, §6.1, §6.2 Auth, §6.5 (401/403/503/500), FR-AUTH-12/13, `[D-01][D-22][T-01][T-07][T-20]`.

**Files:**
- Create: `security/FirebaseAuthFilter.java`, `security/JsonAuthenticationEntryPoint.java`, `security/JsonAccessDeniedHandler.java`, `security/SecurityConfig.java`, `dto/MeResponse.java`, `controller/AuthController.java`
- Test: `support/WebSlice.java`, `security/SecurityRulesTest.java`, `controller/AuthControllerTest.java`

**Interfaces:**
- Consumes: `FirebaseTokenVerifier`, `UserProvisioningService`, `ProblemDetailWriter`, `AppCorsProperties`.
- Produces:
  - `FirebaseAuthFilter extends OncePerRequestFilter` — **not** a Spring bean (constructed in `SecurityConfig`, avoiding double registration). No `Authorization: Bearer` → continue. Otherwise verify → resolve → `SecurityContextHolder` with `UsernamePasswordAuthenticationToken(authenticatedUser, null, authorities)`. `InvalidTokenException` → 401 `UNAUTHENTICATED`; `AuthServiceUnavailableException` → 503 `AUTH_SERVICE_UNAVAILABLE`; `AuthVerificationException` → 500 `INTERNAL_ERROR` (via `ProblemDetailWriter`).
  - `SecurityConfig`: stateless, CSRF disabled, CORS from `AppCorsProperties` (GET/POST/PUT/DELETE; headers `Authorization`, `Content-Type`); rules: `POST /api/stock/in|out` → authenticated; `POST|PUT|DELETE /api/products/**, /api/categories/**, /api/suppliers/**` → `hasRole("ADMIN")`; `GET /api/**` → authenticated; `/error` → permitAll; else `denyAll`.
  - `GET /api/auth/me` → `200 MeResponse(Long id, String email, String displayName, String role)` from `@AuthenticationPrincipal AuthenticatedUser`.
  - `@WebSlice` (test meta-annotation): `@WebMvcTest` + `@Import({SecurityConfig.class, FakeFirebaseTokenVerifier.class, ProblemDetailWriter.class})`; tests add `@MockitoBean UserProvisioningService` stubbed `u-user` → USER, `u-admin` → ADMIN.

- [ ] **Step 1: Write failing tests**
  ```java
  // SecurityRulesTest
  @Test void noTokenIs401()                       // $.code UNAUTHENTICATED
  @Test void revokedTokenIs401() @Test void disabledTokenIs401() @Test void expiredTokenIs401()
  @Test void firebaseOutageIs503()                // $.code AUTH_SERVICE_UNAVAILABLE
  @Test void unexpectedVerifierFailureIs500()     // $.code INTERNAL_ERROR; body lacks "Exception"
  @Test void userCannotWriteCatalog()             // user-token POST/PUT/DELETE products|categories|suppliers → 403 FORBIDDEN
  @Test void adminCanWriteCatalog()               // admin-token → not 401/403
  @Test void userCanPostStock()                   // POST /api/stock/in → not 401/403
  @Test void corsPreflightAllowsConfiguredOriginOnly() // http://localhost:5173 allowed; http://evil.example rejected
  // AuthControllerTest
  @Test void meReturnsResolvedRole()              // admin-token → $.role "ADMIN"
  ```
- [ ] **Step 2:** Run `mvn test -Dtest='SecurityRulesTest,AuthControllerTest'` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Checkpoint.**

---

### Task 7: Categories and suppliers

**Spec:** §3.4–3.5, §6.2 Categories/Suppliers, §6.4, `[D-06][D-23][T-05][T-17]`.

**Files:**
- Create: `dto/CategoryRequest.java`, `dto/CategoryResponse.java`, `dto/SupplierRequest.java`, `dto/SupplierResponse.java`, `service/CategoryService.java`, `service/SupplierService.java`, `controller/CategoryController.java`, `controller/SupplierController.java`
- Test: `service/CategoryServiceTest.java`, `service/SupplierServiceTest.java`, `controller/CategoryControllerTest.java`, `controller/SupplierControllerTest.java`, `service/CatalogDeletionIT.java`

**Interfaces:**
- Produces:
  - `record CategoryRequest(@NotBlank @Size(max=100) String name, @Size(max=255) String description)`; `record CategoryResponse(Long id, String name, String description, long productCount, Instant createdAt, Instant updatedAt)`.
  - `record SupplierRequest(@NotBlank @Size(max=150) String name, @Size(max=100) String contactPerson, @Email @Size(max=255) String email, @Size(max=30) String phone, @Size(max=255) String address)`; `SupplierResponse` = same fields + `id, productCount, createdAt, updatedAt`.
  - `CategoryService`: `list()`, `create(CategoryRequest)`, `update(Long, CategoryRequest)`, `void delete(Long)`; names trimmed; duplicate → `DuplicateResourceException`; `existsByCategoryId` → `ResourceInUseException`. `SupplierService` same shape.
  - Controllers: `GET` 200, `POST` 201 + `Location`, `PUT` 200, `DELETE` 204.

- [ ] **Step 1: Write failing tests**
  ```java
  @Test void createRejectsCaseInsensitiveDuplicate()
  @Test void updateAllowsCaseChangeOfOwnName()            // Review Focus 3
  @Test void deleteBlockedWhenOnlyArchivedProductsReferToIt()
  @Test void listIncludesProductCount()
  // controller tests (admin-token)
  @Test void postReturns201WithLocation() @Test void blankNameIs400WithFieldError() @Test void deleteInUseIs409ResourceInUse()
  @Test void invalidSupplierEmailIs400()  @Test void phoneOver30CharsIs400()
  // CatalogDeletionIT
  @Test void categoryReferencedOnlyByArchivedProductCannotBeDeleted() // service → ResourceInUseException; row still present
  ```
- [ ] **Step 2:** Run `mvn test -Dtest='Category*Test,Supplier*Test'` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `mvn test -Dtest='Category*Test,Supplier*Test'` → PASS; `mvn verify -DskipUTs -Dit.test=CatalogDeletionIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 8: Products (CRUD, search, archive)

**Spec:** §3.3, §6.2 Products, §6.4, `[D-05][D-07][D-08][D-09][D-10][D-11][D-16][D-24][T-08][T-10]`.

**Files:**
- Create: `util/LikePatterns.java`, `dto/ProductRequest.java`, `dto/ProductResponse.java`, `service/ProductService.java`, `controller/ProductController.java`
- Test: `util/LikePatternsTest.java`, `service/ProductServiceTest.java`, `controller/ProductControllerTest.java`, extend `repository/ProductRepositoryIT.java`

**Interfaces:**
- Produces:
  - `static String LikePatterns.contains(String raw)` → `null` for null/blank; else trim, escape `!`, `%`, `_` with `!`, wrap in `%…%`.
  - `record ProductRequest(@NotBlank @Pattern(regexp="^\\s*[A-Za-z0-9-]{3,50}\\s*$") String sku, @NotBlank @Size(max=150) String name, @Size(max=500) String description, @NotNull Long categoryId, Long supplierId, @NotNull @DecimalMin("0.00") @Digits(integer=10, fraction=2) BigDecimal price, @NotNull @Min(0) Integer reorderLevel)` — no quantity field (a sent `quantity` is ignored).
  - `record ProductResponse(Long id, String sku, String name, String description, IdName category, IdName supplier, BigDecimal price, @JsonFormat(shape=STRING) long quantity, int reorderLevel, boolean lowStock, Instant createdAt, Instant updatedAt)`.
  - `ProductService`: `search(String search, Long categoryId, boolean lowStock, int page, int size)`, `get(Long)`, `create(ProductRequest)`, `update(Long, ProductRequest)`, `void archive(Long)`. SKU `trim().toUpperCase(Locale.ROOT)`; new products `quantity 0`, `active true`; missing/archived → `NotFoundException`; unknown category/supplier → `NotFoundException`; archive with `quantity > 0` → `ProductHasStockException`.
  - `ProductController` `@Validated`: `page` `@Min(0)`, `size` `@Min(1) @Max(100)`; `GET /api/products`, `GET /{id}`, `POST` 201 + Location, `PUT /{id}` 200, `DELETE /{id}` 204.

- [ ] **Step 1: Write failing tests**
  ```java
  // LikePatternsTest
  @Test void escapesWildcards() { assertThat(LikePatterns.contains("50%_a!")).isEqualTo("%50!%!_a!!%"); }
  @Test void blankIsNull()      { assertThat(LikePatterns.contains("  ")).isNull(); }
  // ProductServiceTest
  @Test void createNormalisesSkuAndStartsAtZero()      // " elec-009 " → "ELEC-009", quantity 0
  @Test void createRejectsNormalisedDuplicateSku()     // Review Focus 2
  @Test void updateIgnoresQuantity()
  @Test void getArchivedIs404() @Test void updateArchivedIs404()
  @Test void archiveWithStockIsBlocked() @Test void archiveWithZeroStockSetsInactive() @Test void unknownCategoryIs404()
  // ProductControllerTest
  @Test void quantityIsSerialisedAsString()            // $.quantity == "0"
  @Test void sentQuantityIsIgnoredOnCreate()
  @Test void invalidSkuIs400() @Test void negativePriceIs400() @Test void threeDecimalPriceIs400()
  @Test void rejectsOutOfRangePaging()                 // Review Focus 4
  @Test void archiveWithStockIs409ProductHasStock()
  // ProductRepositoryIT (add)
  @Test void searchTreatsWildcardsLiterally()          // Review Focus 1
  ```
- [ ] **Step 2:** Run `mvn test -Dtest='LikePatternsTest,Product*Test'` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `mvn test -Dtest='LikePatternsTest,Product*Test'` → PASS; `mvn verify -DskipUTs -Dit.test=ProductRepositoryIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 9: Stock IN/OUT and transaction history

**Spec:** §3.6–3.7, §4.5 item 3, §6.2 Stock, `[D-12][D-13][D-15][D-17][D-26][T-04][T-06][T-10][T-12]`.

**Files:**
- Create: `dto/StockMovementRequest.java`, `dto/StockTransactionResponse.java`, `service/StockService.java`, `controller/StockController.java`
- Test: `service/StockServiceTest.java`, `controller/StockControllerTest.java`, `service/StockServiceIT.java`

**Interfaces:**
- Consumes: `ProductRepository.findActiveByIdForUpdate`, `StockTransactionRepository`, `AppUserRepository.getReferenceById`, `AuthenticatedUser`.
- Produces:
  - `record StockMovementRequest(@NotNull Long productId, @NotNull @Min(1) @Max(1_000_000) Integer quantity, @Size(max=255) String note)`.
  - `record StockTransactionResponse(Long id, TransactionType type, int quantity, @JsonFormat(shape=STRING) long quantityAfter, String note, ProductRef product, UserRef user, Instant createdAt)`; `record ProductRef(Long id, String sku, String name)` (current values `[D-26]`); `record UserRef(Long id, String displayName, String email)`.
  - `StockService` (`@Transactional`): `stockIn(StockMovementRequest, AuthenticatedUser)`, `stockOut(…)` — lock via `findActiveByIdForUpdate` (missing/archived → `NotFoundException`); IN `Math.addExact`; OUT `quantity > available` → `InsufficientStockException(requested, available)`; update product; `saveAndFlush` the transaction with `quantityAfter`; blank note → `null`.
  - `history(Long productId, TransactionType type, String search, Instant from, Instant to, int page, int size)` — `from.isAfter(to)` → `RequestValidationException("from", "must not be after 'to'")`; search via `LikePatterns`; sort `createdAt DESC, id DESC`.
  - `StockController`: `POST /api/stock/in|out` → 201; `GET /api/stock/history` (`@DateTimeFormat(iso = DATE_TIME) Instant from/to`, paging bounds as Task 8).

- [ ] **Step 1: Write failing tests**
  ```java
  // StockServiceTest
  @Test void stockInAddsAndRecordsQuantityAfter()    // 5 + 10 → 15
  @Test void stockOutSubtracts()                     // 15 − 3 → 12
  @Test void stockOutAboveAvailableIs409()           // "requested 8, available 5"
  @Test void archivedOrMissingProductIs404() @Test void blankNoteStoredAsNull() @Test void fromAfterToIsValidationError()
  // StockControllerTest
  @Test void quantityZeroAndAboveMillionAre400() @Test void noteOver255Is400()
  @Test void quantityAfterIsString()                 // $.quantityAfter == "15"
  @Test void historyFromAfterToIs400()               // $.fieldErrors[0].field "from"
  @Test void historyRejectsOutOfRangePaging()        // Review Focus 4
  @Test void invalidTypeParamIs400Malformed()
  // StockServiceIT (real transactions; DatabaseCleaner removes committed rows before the next test)
  @Test void concurrentStockOutOfLastUnitsAllowsExactlyOne() // qty 5; two threads OUT 5 → 1 success, 1 InsufficientStockException, final 0, 1 tx row
  @Test void failedTransactionInsertRollsBackQuantity()      // non-existent userId → exception; quantity unchanged; 0 tx rows
  @Test void databaseCheckRejectsNegativeQuantity()          // JDBC UPDATE quantity = -1 → DataIntegrityViolationException
  @Test void historyShowsCurrentProductNameAfterRename()     // [D-26]
  ```
- [ ] **Step 2:** Run `mvn test -Dtest='Stock*Test'` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `mvn test -Dtest='Stock*Test'` → PASS; `mvn verify -DskipUTs -Dit.test=StockServiceIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 10: Dashboard

**Spec:** §3.2, §6.2 Dashboard, `[D-05][D-08][T-08][T-16]`.

**Files:**
- Create: `dto/DashboardResponse.java`, `dto/LowStockProduct.java`, `service/DashboardService.java`, `controller/DashboardController.java`
- Consumes: `CategoryStock` and the dashboard queries of `ProductRepository` (Task 2), `StockTransactionResponse` (Task 9).
- Test: `service/DashboardServiceIT.java`, `controller/DashboardControllerTest.java`

**Interfaces:**
- Produces:
  - `record DashboardResponse(long totalProducts, @JsonFormat(shape=STRING) long totalStockQuantity, long lowStockCount, List<LowStockProduct> lowStockProducts, List<StockTransactionResponse> recentTransactions, List<CategoryStock> stockByCategory)`; `record LowStockProduct(Long id, String sku, String name, @JsonFormat(shape=STRING) long quantity, int reorderLevel)`.
  - `DashboardResponse DashboardService.get()` (`@Transactional(readOnly = true)`); `GET /api/dashboard` → 200.

- [ ] **Step 1: Write failing tests**
  ```java
  // DashboardServiceIT
  @Test void figuresIgnoreArchivedProducts() @Test void lowStockListIsTop5OrderedByQuantity()
  @Test void recentTransactionsAreLatest10() @Test void stockByCategoryListsAllCategories()
  // DashboardControllerTest
  @Test void bigintFieldsAreStrings()        // $.totalStockQuantity and $.stockByCategory[0].totalQuantity are strings
  ```
- [ ] **Step 2:** Run `mvn test -Dtest=DashboardControllerTest` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `mvn test -Dtest=DashboardControllerTest` → PASS; `mvn verify -DskipUTs -Dit.test=DashboardServiceIT` → PASS.
- [ ] **Checkpoint.**

---

### Task 11: Full verification and backend documentation

**Spec:** §8.5, §9, §12; plan section *Test Execution Strategy*.

**Files:**
- Create: `api/README.md` (prerequisites, environment variables, IntelliJ working directory `api/`, all commands from the *Test Execution Strategy* table, profile overview)
- Modify: `api/.env.example` only if a variable was added.

- [ ] **Step 1:** Run `cd api && mvn verify`. Expected: `BUILD SUCCESS`; record Surefire and Failsafe `Tests run / Failures / Errors / Skipped` separately.
- [ ] **Step 2: No skipped integration tests.** Count `find src/test/java -name '*IT.java' | wc -l` and `ls target/failsafe-reports/TEST-*IT.xml | wc -l` → equal; every report has `tests > 0`, `skipped="0"`, `failures="0"`, `errors="0"`.
- [ ] **Step 3: Secrets.** `git status --short --untracked-files=all` lists no `test-db.properties`, `.env` or credential `*.json`; `grep -rniE "password\s*=|BEGIN PRIVATE KEY" api/src` → only placeholders.
- [ ] **Step 4: Traceability.** Every §6.2 endpoint has a controller method and ≥ 1 test; every `D-xx`/`T-xx` the backend implements is cited by a task.
- [ ] **Step 5:** `git diff --stat -- database/` → empty; `inventory_db` row counts unchanged (5/4/12/0/0, read-only query).
- [ ] **Checkpoint (final report):** features, structure, endpoints, auth, DB integration, exact test results, environment variables, unresolved issues (incl. P2 manual run), files created, `git status`, branch. **No commit** until the student approves.
