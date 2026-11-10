# Inventory Tracking System — Audit Report

- **Date:** 2026-11-01
- **Branch audited:** `feature/inventory-tracking-setup` (HEAD `c0cc56a`, identical to `origin`)
- **Audit type:** Read-only. No source, configuration or documentation files were changed during the audit. Running Maven rebuilt the git-ignored `api/target/` folder. Nothing was committed, pushed, or switched branch. No subagents or Ruflo tools were used.
- **Reference specification:** `docs/superpowers/specs/2026-11-01-inventory-tracking-system-design-revision-7.md`

---

## 1. Overall Assessment

The engineering work is strong. Database, backend and security are built to a written spec and the tests that were run all pass. The weak parts are delivery and process:

- **No pull request exists, and none can be opened yet.** GitHub has no `main` branch; the only branch is `feature/inventory-tracking-setup`, which is also the default branch.
- **There is no evidence of any mentor review** for either project.
- **There is no root README** for a new developer.
- **The Playwright end-to-end tests the spec requires do not exist.**
- **The Firebase service-account private key sits inside the repo folder.** It is git-ignored and was never pushed, but it is also captured in local checkpoint commits.
- **There is no evidence of the Employee Directory bug fix.**

All 26 business decisions (D-01 to D-26) and the Spring Boot 4 / JUnit 6 choice (T-21) are still marked "pending mentor confirmation" in the spec.

**Verdict:** the code is demo-capable. The submission is not ready: the PR, mentor review and README are the gate.

---

## 2. Requirement Verification Table

| Requirement | Status | Evidence | Missing Work |
|---|---|---|---|
| Product CRUD (delete = archive) | PASS | `ProductController`, `ProductService.archive` (409 when stock > 0) | — |
| Categories / suppliers CRUD, in-use → 409 | PASS | `CategoryService.delete`, `SupplierService.delete` | — |
| Stock IN/OUT, never negative | PASS | `StockService` (row lock + `@Transactional`), `CHECK (quantity >= 0)` | — |
| Stock quantity after each movement (`quantity_after`) | PASS | `StockTransaction`, history UI "After" column | — |
| Search and filtering | PASS | `ProductRepository.search`, `StockTransactionRepository.history`, `LikePatterns` (escapes wildcards) | — |
| Dashboard (totals, low stock, recent movements, by category) | PASS | `DashboardService`, `Dashboard.jsx` | — |
| Input validation (backend) | PASS | Bean Validation on DTOs, `GlobalExceptionHandler` | — |
| 400 / 404 / 409 with JSON error bodies | PASS | `ErrorCode`, `ProblemDetailWriter`, `GlobalExceptionHandlerTest` | — |
| Business logic kept out of controllers | PASS | Controllers only delegate to services | — |
| MySQL schema: PKs, FKs, NOT NULL, UNIQUE, CHECK | PASS | `database/schema.sql`; `SchemaConformanceIT` passed | — |
| Indexes justified by real queries | PASS | Comments in `schema.sql` match the repository queries | — |
| Seed data | PASS | `database/seed.sql` (safe to re-run) | — |
| Database built from scripts on a fresh database | PARTIAL | Steps in `database/README.md`; the local test DB matches the schema | Creating the `inventory_dev` MySQL user is never explained |
| No DB credentials committed | PASS | `application.yml` uses `${DB_*}`; `test-db.properties` is ignored | — |
| Firebase login / logout / register | PASS (code) / NOT VERIFIED (live) | `AuthContext.jsx` | Demonstrate it live |
| Frontend protected routes | PASS | `ProtectedRoute.jsx` and its tests | — |
| ID token sent to the backend | PASS | `apiClient.js` (Bearer header) and its test | — |
| Backend verifies tokens with the Admin SDK, including revocation | PASS | `FirebaseAdminTokenVerifier` (`verifyIdToken(token, true)`), 14 unit tests | — |
| Backend ignores client-supplied user ID or role | PASS | `StockMovementRequest` has no user field; role comes from `UserProvisioningService` | — |
| Unauthorized → 401, wrong role → 403 | PASS | `SecurityConfig`, `SecurityRulesTest` | — |
| CORS limited to one frontend origin | PASS | `SecurityConfig.corsConfigurationSource` (`APP_CORS_ALLOWED_ORIGIN`) | — |
| Firebase UID linked to an app user record | PASS | `users.firebase_uid` UNIQUE; `UserProvisioningService.resolve` | — |
| Service-account key not committed | PARTIAL | Not on GitHub, but the file is in the repo root and in local `refs/agents/*` commits | Move it out; clean up refs; consider rotating the key |
| React organisation, loading / empty / error states | PASS | `ui.jsx`, every page uses them | — |
| Responsive layout | PASS (code) / NOT VERIFIED (visual) | `base.css` breakpoints at 1023px and 767px | Check in a mobile viewport |
| Backend unit and slice tests | PASS | `mvn test`: 156 run, 0 failed | — |
| Backend integration tests (full) | NOT VERIFIED | Only the read-only ITs were run (8 passed) | Run `mvn clean verify` |
| Frontend tests | PASS | `vitest run`: 37 passed (6 files) | Page and form tests are missing |
| Playwright E2E | FAIL | Not in `package.json`, no test files | Spec §8.4 lists 7 scenarios |
| Root README / fresh-clone guide | FAIL | No `README.md` at the repo root | Write one |
| Architecture / API docs (spec §11) | FAIL | `docs/architecture.md`, `database-design.md`, `api-documentation.md` do not exist | Write them, or ask the mentor to drop them |
| Work committed and pushed to the feature branch | PASS | Clean working tree; `c0cc56a` equals `origin` | — |
| PR exists | FAIL | Public GitHub API shows 0 PRs; there is no `main` branch | Ask the mentor which base branch to use |
| Mentor review and approval | NOT VERIFIED | No evidence | — |
| Done within 4 days | NOT VERIFIED | All commits are dated 2026-11-01; start date unknown | — |
| No Ruflo / swarms / automated loops | NOT VERIFIED (risk) | The global `~/.claude/CLAUDE.md` contains a Ruflo block telling Claude to use `swarm_init` / `agent_spawn` | Remove it; be ready to explain the tooling used |
| Employee Directory bug fix | FAIL / NOT VERIFIED | Nothing in this repo | Separate deliverable |

---

## 3. Backend Verification

**Implemented**

- Packages are cleanly separated: `config`, `security`, `controller`, `service`, `repository`, `entity`, `dto`, `exception`.
- Hibernate only checks the schema (`ddl-auto: validate`); it never changes tables.
- Errors use the RFC 9457 format with `code` and `fieldErrors`.
- Duplicate checks run in the service, with the database constraint as a backstop. `ConstraintViolationClassifier` maps errors by SQL state and code, not by parsing message text.
- Paged search with deterministic ordering.

**Stock OUT request flow**

1. `StockController.stockOut` receives the request.
2. `StockService.stockOut` runs inside `@Transactional`.
3. It locks the row with `ProductRepository.findActiveByIdForUpdate`.
4. If the requested quantity exceeds stock, it throws `InsufficientStockException` (409).
5. Otherwise it saves the new quantity together with the transaction row.

**Minor issues**

- `StockService.stockIn` uses `Math.addExact`. An overflow would return a 500 instead of a 4xx. It is practically unreachable.
- The `application-e2e.yml` profile contains only comments.

---

## 4. Frontend Verification

**Implemented**

- All spec pages exist.
- `AuthContext` gets the role only from `/api/auth/me`.
- `apiClient` turns error bodies into `ApiError` and signs the user out on 401.
- Search boxes wait 300 ms before calling the API.
- Large quantities are formatted with BigInt so they stay exact.
- Date filters convert local dates to UTC, with an exclusive end date.
- Modals trap keyboard focus and close with Esc; the mobile drawer works the same way.

**Gaps compared with the spec**

- No ESLint and no Playwright.
- Global CSS is used instead of CSS Modules.
- Shared components are merged into `ui.jsx`. This is simpler and fine, but should be explained if asked.
- The Stock page lists at most 100 products (search narrows the list).
- During registration `/api/auth/me` is called twice. The first call stores a blank display name and the second corrects it. This is harmless.

---

## 5. Database Verification

- **Tables:** five InnoDB tables (`users`, `categories`, `suppliers`, `products`, `stock_transactions`), all using `utf8mb4_0900_ai_ci`.
- **Foreign keys:** all use `ON DELETE RESTRICT`.
- **CHECK constraints:** non-negative price, quantity and reorder level; movement size 1–1,000,000; case-sensitive values for role and movement type.
- **Uniqueness:** SKU is unique even for archived products; category and supplier names are unique regardless of case or accents; `firebase_uid` is unique; email is indexed but deliberately not unique.
- **Timestamps:** UTC `DATETIME(6)`.
- **Safety:** `schema.sql` has no `DROP` statements. `TestDatabaseGuard` and `DatabaseCleaner` refuse to touch any database whose name does not end in `_test`.

**README problems in `database/README.md`**

- It says `mvn test` uses `inventory_test`. Wrong: only `mvn verify` does.
- It says "no reset script exists yet" and calls the backend a "future phase". Both are outdated.
- It links to the old spec instead of revision 7.

---

## 6. Authentication and Security Verification

**Request flow**

1. React signs in with Firebase (Email/Password).
2. `apiClient` sends `Authorization: Bearer <ID token>`.
3. `FirebaseAuthFilter` calls `FirebaseAdminTokenVerifier.verify`, which uses `verifyIdToken(token, true)` so revoked tokens are rejected.
4. Invalid tokens → 401; Firebase outages → 503; anything else → 500.
5. `UserProvisioningService.resolve` finds or creates the `users` row by Firebase UID. It grants ADMIN only if the email is on the `APP_SECURITY_ADMIN_EMAILS` allowlist **and** is verified.
6. An `AuthenticatedUser` is placed in the `SecurityContext`, and `SecurityConfig` enforces role rules on the URLs.

**Frontend-only protection vs backend authorization**

- Frontend: `ProtectedRoute` redirects signed-out users and shows Forbidden to USERs on admin routes. This is for usability only, and the code comments say so.
- Backend: every `/api/**` request is authenticated by the filter and authorized by `SecurityConfig`. All unknown routes are denied (`anyRequest().denyAll()`).

**Weaknesses**

- **Credential hygiene (most important):** a Firebase Admin SDK service-account JSON file is in the repo root. The spec and `api/.env.example` say it must live outside the repository. Local checkpoint commit `5f29c78`, reachable from a `refs/agents/.../turn/1` ref, contains the full private key. A plain `git push` would not send it, but `git push --mirror` would, and the repository is **public**.
- The JVM crash logs were checked for credential variable names: none were present.

---

## 7. Testing Results

| Command | Result |
|---|---|
| `mvn -B test` (in `api/`) | **156 tests, 0 failures, 0 errors, 0 skipped** across 21 classes. Exit code 0. |
| `mvn -B verify -DskipUTs "-Dit.test=ApplicationContextIT,SchemaConformanceIT"` | **8 tests, 0 failures.** BUILD SUCCESS against local `inventory_test`. |
| `npx vitest run` (in `web/`) | **6 files, 37 tests passed.** |
| Data-writing ITs (`StockServiceIT` with concurrency, rollback and CHECK tests; `DashboardServiceIT`; `ConstraintMappingIT`; others) | **Not run.** They delete rows, and the README requires the student's approval first. The full backend suite is therefore **not verified**. |
| Playwright | **Does not exist.** |

**Important missing tests**

- Login, Register and ProductForm error messages (spec §8.3).
- StockManagement and TransactionHistory pages.
- All 7 end-to-end scenarios (spec §8.4).

**Stability risk:** there are 7 `hs_err_pid*.log` files showing the JVM ran **out of native memory** while running tests and while running the jar. Close other applications before the live demo.

---

## 8. GitHub and PR Verification

- **Branch and status:** on `feature/inventory-tracking-setup`, working tree clean, identical to `origin`.
- **History:** 3 commits. Almost the whole application landed in one large commit (`c0cc56a`), which is hard for a reviewer to follow.
- **Remote:** the repository is public, there are no PRs, and no `main` branch exists, so there is nothing to merge into.
- **`.gitignore`:** covers `.env*`, service-account JSON files, `target/`, `node_modules/`, `dist/` and crash logs.
- **`.env.example` files:** contain placeholders only.
- **Not checked:** `gh` is not installed, so the public GitHub API was used; it shows no reviews.

---

## 9. Fresh Clone Verification

A new developer would have to find three separate READMEs in `api/`, `web/` and `database/`. They would still be missing:

- the order of steps;
- how to create the `inventory_dev` MySQL user and its permissions;
- how to generate the Firebase service-account key (only in spec §9.3);
- how to get admin access end to end.

The backend run and test instructions and the frontend `.env.local` instructions are good. The web README's note that "`dist/` is not in `.gitignore`" is outdated.

**Verdict: PARTIAL.**

---

## 10. Supervisor Demo Readiness

Topics to be able to explain in IntelliJ IDEA:

1. **Architecture:** the diagram in spec §4.1.
2. **Controller → Service → Repository → MySQL:** `ProductController.create` → `ProductService.create` (SKU normalisation, duplicate check) → `ProductRepository.save` → `products` table.
3. **React → API request flow:** `Products.jsx` → `useApi` → `productService.search` → `apiClient.apiRequest` (Bearer header) → Vite proxy → `:8080`.
4. **Firebase login:** `AuthContext.login` and `onAuthStateChanged` → `/api/auth/me`.
5. **Firebase ID token verification:** `FirebaseAuthFilter`, `FirebaseAdminTokenVerifier`, what `checkRevoked = true` does; 401 vs 503 vs 500.
6. **User identity mapping:** `UserProvisioningService.resolve` (find or create by UID, recovery from a duplicate key, the ADMIN rule); `stock_transactions.user_id` comes from the server-side user.
7. **Important business logic:** the pessimistic lock in Stock OUT, archive-only-at-zero, in-use deletion blocking, `quantity_after`.
8. **Error handling:** `GlobalExceptionHandler`, `ConstraintViolationClassifier`, `ProblemDetailWriter`.
9. **Testing:** fake verifier vs real verifier, Surefire vs Failsafe, the `_test` database guard.
10. **Why quantities are sent as JSON strings:** BigInt / BigInteger, so large numbers stay exact.

---

## 11. Missing Requirements and Priority

### CRITICAL — must fix before the demo

1. No PR and no `main` branch. Ask the mentor which base branch to use.
2. Service-account key inside the repo folder and in local checkpoint refs.
3. Full `mvn clean verify` never confirmed.
4. No root README.
5. Employee Directory bug fix: no evidence.

### HIGH — important for internship evaluation

6. Playwright E2E is missing.
7. Mentor confirmation of D-01 to D-26 and T-21 (the brief says JUnit 5; the project uses JUnit 6).
8. The Ruflo block in the global `CLAUDE.md` conflicts with the supervisor's rules.
9. Docs listed in spec §11 are missing.
10. Stale statements in the database and web READMEs.

### MEDIUM — should improve

11. Frontend page and form tests.
12. ESLint.
13. MySQL user setup instructions.
14. Fix the JVM memory crashes, or document a workaround.

### LOW — optional improvements

15. Overflow in `Math.addExact` returns 500.
16. Double `/me` call at registration.
17. CSS Modules deviation from the spec.
18. 100-product limit on the Stock page.

---

## 12. Recommended Next Steps

1. **Secure the key.**
   - *Missing:* the key file is not stored outside the repo.
   - *Why:* the repository is public, and the spec forbids keys in the repo.
   - *Files:* the repo-root service-account JSON, `GOOGLE_APPLICATION_CREDENTIALS`, `refs/agents/*`.
   - *Do:* move the JSON outside the repo, update the environment variable, then (carefully) delete the `refs/agents/*` checkpoint refs and prune. Consider rotating the key in Firebase.
   - *Verify:* `git log --all -- '*adminsdk*'` returns nothing, and `git status --ignored` no longer lists the file.
2. **Run the full backend suite.**
   - *Missing:* the data-writing integration tests have never been confirmed.
   - *Why:* they cover concurrency, rollback and dashboard totals.
   - *Do:* run `mvn clean verify` in `api/`.
   - *Verify:* every `*IT` class has a Failsafe report with 0 failures and 0 skipped. Save the output for the PR.
3. **Write a root `README.md`.**
   - *Missing:* a fresh-clone setup guide.
   - *Why:* it is required for the fresh-clone check.
   - *It should cover:* prerequisites → MySQL databases and user → schema and seed → Firebase project, web app and service-account key → backend env vars and run → frontend `.env.local` and run → becoming ADMIN → backend and frontend tests. Also fix the stale lines in the database and web READMEs.
   - *Verify:* clone into a new folder and follow only the README.
4. **Ask the mentor three things:**
   - which base branch to use (there is no `main`);
   - whether to confirm D-01 to D-26 and T-21;
   - whether Playwright and the §11 docs are required.

   Then open the PR with the test output.
   - *Verify:* the PR is visible on GitHub and an approval is recorded.
5. **Add Playwright E2E**, if confirmed.
   - *Files:* `web/package.json`, a new `web/e2e/` folder.
   - *Verify:* the 7 scenarios pass against `inventory_test` and a non-production Firebase project.
6. **Remove the Ruflo block** from `~/.claude/CLAUDE.md` so the tooling matches the supervisor's rules.
7. **Add the missing frontend tests** (Login, Register, ProductForm, Stock, History) and ESLint.
   - *Verify:* `npm test` passes.
8. **Do the Employee Directory bug fix** as a separate PR: approved issue → reproduction → failing test → minimal fix → passing test → PR → mentor review.
9. **Rehearse the demo** on a fresh start with only the backend, frontend and MySQL running, to avoid the memory crashes. Walk through the Section 10 topics in IntelliJ.
