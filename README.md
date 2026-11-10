# Inventory Tracking System

A local warehouse inventory app with a React/Vite frontend, Spring Boot API, MySQL database, and Firebase email/password authentication.

## Prerequisites

- MySQL 8.0.16 or later, with the `mysql` client on `PATH`
- JDK 17 and Maven 3.9+
- Node.js and npm
- A non-production Firebase project with Email/Password sign-in enabled
- A Firebase Admin service-account JSON file stored **outside this repository**

## 1. Create the local databases and user

Start the local MySQL service. In PowerShell, connect as a MySQL administrator:

```powershell
mysql -u root -p
```

At the MySQL prompt, create the databases and a local application user. Replace the example password with a password chosen for this machine; do not commit it or paste it into project files.

```sql
CREATE DATABASE inventory_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE inventory_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'inventory_dev'@'localhost' IDENTIFIED BY 'choose-a-local-password';
GRANT ALL PRIVILEGES ON inventory_db.* TO 'inventory_dev'@'localhost';
GRANT ALL PRIVILEGES ON inventory_test.* TO 'inventory_dev'@'localhost';
exit
```

If these databases and user already exist, keep them and continue. To rebuild a local development database, first back up anything you need; `schema.sql` intentionally does not drop existing tables.

From the repository root, create the tables in both databases and seed the development database:

```powershell
mysql -u root -p --default-character-set=utf8mb4 inventory_db -e "source database/schema.sql"
mysql -u root -p --default-character-set=utf8mb4 inventory_test -e "source database/schema.sql"
mysql -u root -p --default-character-set=utf8mb4 inventory_db -e "source database/seed.sql"
```

The seed adds 15 products and demo IN/OUT history for each. The movements net to zero, so each product starts with quantity 0. Its demo actor is fictional and cannot sign in. See [database setup](database/README.md), [schema](database/schema.sql), and [queries](database/queries.sql).

## 2. Configure Firebase

In the Firebase console for your non-production project:

1. Enable **Authentication → Sign-in method → Email/Password**.
2. Add a Firebase web app and include `localhost` in the authorized domains.
3. Copy `web/.env.example` to `web/.env.local` and fill in the web app values.
4. Create/download a Firebase Admin service-account JSON file and store it outside this repository.

The account configured as an administrator must have a verified Firebase email matching `APP_SECURITY_ADMIN_EMAILS` below. Never commit the service-account JSON, `.env.local`, database passwords, or tokens.

## 3. Start the API

Open a PowerShell terminal in `api/`, set the local configuration, then run Spring Boot. Use the same Firebase project for the web app and Admin SDK.

```powershell
$env:DB_URL = "jdbc:mysql://localhost:3306/inventory_db?connectionTimeZone=UTC"
$env:DB_USERNAME = "inventory_dev"
$env:DB_PASSWORD = "<your-local-mysql-password>"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\outside\repo\firebase-service-account.json"
$env:APP_SECURITY_ADMIN_EMAILS = "admin@example.com"
$env:APP_CORS_ALLOWED_ORIGIN = "http://localhost:5173"
mvn spring-boot:run
```

The API listens on `http://localhost:8080`. It validates the existing schema and does not create or modify tables automatically. The API endpoints and test commands are in [api/README.md](api/README.md).

## 4. Start the frontend

In a second PowerShell terminal:

```powershell
Set-Location .\web
npm install
npm run dev
```

Open **http://localhost:5173**. Use `localhost` so the browser origin matches the API’s default CORS setting. The Vite server proxies `/api` requests to the backend.

## Main workflow

1. Register or sign in with Firebase.
2. Search products by name or SKU; combine search with category and low-stock filters.
3. Open a product’s history from its row, or review the overall movement history.
4. Record stock IN or OUT. Administrators can also record a signed ADJUST with a reason.
5. Review the dashboard and low-stock counts.

The current implementation stores `products.quantity` and updates it transactionally with each append-only movement. The onboarding plan asks the mentor to decide whether stock should instead be derived from the movement sum; confirm that design choice before changing the data model.

## Checks and supporting docs

- Backend unit and slice tests (no database): from `api/`, run `mvn clean test`.
- Frontend tests: from `web/`, run `npm test`.
- Frontend production build: from `web/`, run `npm run build`.
- [Manual test checklist](docs/manual-testing-checklist.md) — record actual results as you execute each scenario.
- [Entity-relationship diagram](docs/er-diagram.md).

Integration tests use `inventory_test`; several write and clean its rows. Read [api/README.md](api/README.md) before running them. Do not point tests at a shared or production database.

## Onboarding items that need a person

This repository cannot establish that a mentor approved the stock-calculation design, reviewed a pull request, or that the separate Employee Directory bug fix was completed. Record those outcomes with your mentor; do not treat unchecked manual-test items as passed.
