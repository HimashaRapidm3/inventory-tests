# Manual Testing Checklist

Run this checklist on the **development** database (`inventory_db`) and a **non-production** Firebase project. Never run it against a production or shared database.

Record for each item: ✅ pass, ❌ fail (with the exact message or screenshot), or ⏭ skipped (with the reason).

## 0. Setup

- [ ] `database/schema.sql` applied to an empty `inventory_db`.
- [ ] `database/seed.sql` applied. Products count is **15**, every `quantity` is **0**.
- [ ] Seed history contains one demo IN and one demo OUT for each product (30 movements total).
- [ ] Running `seed.sql` a second time leaves counts unchanged (15 products, 5 categories, 4 suppliers, 30 demo movements).
- [ ] Backend starts on `http://localhost:8080` without errors (`ddl-auto: validate` passes).
- [ ] Frontend starts with `npm run dev` and loads the login page.

## 1. Authentication

- [ ] Register a new account; the verification email is sent.
- [ ] Login with a wrong password shows a readable error message.
- [ ] Login with the right password reaches the dashboard.
- [ ] Logout returns to the login page; the dashboard is no longer reachable.
- [ ] Opening `/products` while signed out redirects to `/login`.

## 2. Roles

Test each item once as **USER** (an account whose email is not in `APP_SECURITY_ADMIN_EMAILS`) and once as **ADMIN** (listed and verified).

- [ ] USER: the "Add product" button is **not** shown on `/products`.
- [ ] USER: the edit and archive buttons are **not** shown on `/products`.
- [ ] USER: opening `/products/new` shows the "Access denied" page.
- [ ] USER: Categories and Suppliers pages do not offer add, edit or delete.
- [ ] ADMIN: all of the above actions are available.
- [ ] USER: Stock In and Stock Out still work (they are allowed for every signed-in user).
- [ ] USER: no ADJUST option is shown on the Stock page.

## 3. Products

- [ ] Create a product as ADMIN. Quantity starts at **0**.
- [ ] Creating a product with a duplicate SKU (different case or extra spaces) shows a field error.
- [ ] SKU rules: too short, too long, or containing spaces are rejected with a field error.
- [ ] Price with three decimals is rejected; negative price is rejected.
- [ ] Edit a product as ADMIN. Quantity is **not** changed by editing.
- [ ] Archive a product with zero stock: it disappears from the list.
- [ ] Try to archive a product with stock: the error explains that it cannot be archived.
- [ ] Archived product's SKU cannot be reused for a new product.

## 4. Search, filters and low stock

- [ ] Search by part of a product name returns matching products.
- [ ] Search by part of a SKU returns matching products.
- [ ] Search text containing `%` or `_` is treated literally (for example `100%` matches only names containing `100%`).
- [ ] Category filter shows only that category's products.
- [ ] Search and category filter together narrow the results.
- [ ] "Low stock only" shows products where quantity ≤ reorder level.
- [ ] Each product row shows "Low stock" or "In stock" correctly.
- [ ] Pagination moves between pages and keeps the filters.
- [ ] Dashboard "Low-stock products" count matches the low-stock filter.

## 5. Stock movements

- [ ] Stock In: add 10 units to a product. Quantity shows 10 and the history shows `IN`, quantity 10, after 10.
- [ ] Stock Out: remove 4 units. Quantity shows 6.
- [ ] Stock Out of more than the available quantity is rejected with a clear message; quantity unchanged.
- [ ] Quantity 0 and quantity 1,000,001 are rejected by the form.
- [ ] Note longer than 255 characters is rejected.
- [ ] Note is optional for Stock In and Stock Out.
- [ ] Stock Out of the exact remaining quantity brings stock to 0 (allowed).
- [ ] ADJUST as ADMIN: a positive delta increases stock; a negative delta decreases it.
- [ ] ADJUST that would make stock negative is rejected; quantity unchanged.
- [ ] ADJUST with a blank reason is rejected with a field error.
- [ ] ADJUST with delta 0 is rejected.

## 6. Transaction history

- [ ] Date range: "from" after "to" shows the error message and no results.
- [ ] Equal "from" and "to" dates return an empty list, not an error.
- [ ] A movement made today appears when the range covers today.
- [ ] Type filter shows only IN or only OUT movements.
- [ ] Search by product name or SKU filters the list.
- [ ] Each row shows the product name and SKU, quantity, "after" quantity, user and note.
- [ ] Filter by type `ADJUST` and check the badge colour is neutral (not red or green).
- [ ] Product history page `/products/:id/history` shows only that product's movements.
- [ ] The History link on a product row opens that product's history.
- [ ] The history page works for an archived product.

## 7. Dashboard

- [ ] Active products count excludes archived products.
- [ ] Total stock quantity equals the sum of active products' quantities.
- [ ] Low-stock list shows at most 5 products, lowest quantity first.
- [ ] Stock by category bars match the category totals on the Products page.
- [ ] Recent movements shows the latest 10 movements.

## 8. Reconciliation

- [ ] After a series of IN, OUT, and ADJUST movements, each product's quantity equals:
      `SUM(IN) − SUM(OUT) + SUM(ADJUST)` for that product.
- [ ] Each history row's "after" value equals the previous "after" plus the signed movement.
- [ ] The read-only reconciliation query in `database/queries.sql` returns no rows.

## 9. Responsive layout and accessibility

- [ ] At a phone width (about 375 px), no page scrolls horizontally.
- [ ] Tables stack into labelled rows on narrow screens.
- [ ] Modals (archive confirmation) close with Esc and trap keyboard focus.
- [ ] The mobile navigation drawer opens and closes with the keyboard.
- [ ] Form errors are announced to screen readers (they are attached to their fields).

## 10. Error handling

- [ ] Stop the backend and try to load the products page: a "Cannot reach the server" message appears, not a blank page.
- [ ] Expired or revoked Firebase session: the user is signed out and sent to the login page.
- [ ] A server error (500) shows a generic message and no stack trace or SQL text.
