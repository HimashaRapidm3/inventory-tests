# Automated Test Results

Record of the automated checks run from the README "Checks" section. Manual checklist results are kept separately in [manual-testing-checklist.md](manual-testing-checklist.md).

Run date: 2026-11-12 (local time, UTC+05:30)

| Check | Command (from project folder) | Result |
|---|---|---|
| Backend unit and slice tests | `inventory-api`: `mvn -B test` | **PASS**: 193 tests, 0 failures, 0 errors, 0 skipped |
| Frontend tests | `inventory-ui`: `npx vitest run --no-file-parallelism` | **PASS**: 14 files, 79 tests |
| Frontend production build | `inventory-ui`: `npm run build` | **PASS** |

## Notes

- **Frontend parallel-run crashes.** `npx vitest run` with default parallelism crashed worker processes (exit codes 134 and 3221226505) and gave different pass counts on each run (42, then 36). Each test file passes alone, and the full suite passes with `--no-file-parallelism`. The cause is the parallel worker setup on this machine, not a failing test. Use `--no-file-parallelism` until it is investigated.
- **Not run:** the integration tests (`*IT.java`, for example `StockServiceIT`). They need the MySQL `inventory_test` database, so they were not run in this pass. They are the tests that would cover `ADJUST` against the real schema.
- **Stock adjustment defect (resolved on the development database):** the live `inventory_db` still had the pre-ADJUST schema (`type VARCHAR(3)` and the original three CHECK constraints). After confirming there were no incompatible rows and backing up the database, migration `database/migrations/002_stock_adjustments.sql` was applied. Post-checks confirmed four CHECK constraints, `type VARCHAR(6)`, and all 10 transaction rows preserved. Integration tests against `inventory_test` were not run, so this records the live development database migration, not an integration-test pass.
