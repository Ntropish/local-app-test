# Application Requirements

This document outlines the key architectural and functional requirements for the application's data layer.

## 1. Data Layer Architecture

- **SQLite in a Shared Worker**: The application must use SQLite, running in a `SharedWorker`. This is a critical architectural decision. A `SharedWorker` provides a single, shared database instance that is accessible across all browser tabs for a given origin. This solves the "multi-tab problem" where a `DedicatedWorker` would create a separate, inconsistent database for each tab. This architecture ensures data consistency and synchronization across the entire user session.
- **OPFS Persistence**: The database should be persisted in the browser's Origin Private File System (OPFS).
  - **`crossOriginIsolated` Requirement**: OPFS is only available in a secure context where the `self.crossOriginIsolated` property is `true`. Enabling this requires the server to send two specific HTTP headers:
    - `Cross-Origin-Opener-Policy: same-origin`
    - `Cross-Origin-Embedder-Policy: require-corp`
  - Without these headers, the application will fall back to a transient, in-memory database, and data will be lost on page refresh.
- **Drizzle ORM**: Drizzle ORM is the designated query builder and type-safe interface to the database.
- **React Context**: All database interactions from the React components must go through a dedicated React Context (`DatabaseProvider`) to manage state, initialization, and the worker lifecycle. Direct imports of the database instance in components should be avoided.

## 2. Worker Communication Protocol

The communication between the main thread and the worker is asynchronous and message-based. All messages follow a standard format: `{ type: string, payload: any }`.

### Messages to Worker

- **`init`**: Initializes the database. This should be the first message sent on a new connection.
  - **Payload**: `{ filename: string }`
- **`exec-all`**: Executes a query expected to return multiple rows.
  - **Payload**: `{ id: string, sql: string, params: any[] }`
- **`exec-get`**: Executes a query expected to return a single row.
  - **Payload**: `{ id: string, sql: string, params: any[] }`

### Messages from Worker

- **`init-finished`**: Sent after the database has been successfully initialized, migrated, and seeded.
  - **Payload**: `{ version: string, filename: string, opfs: boolean }`
- **`init-error`**: Sent if an error occurs during the initialization process.
  - **Payload**: `string` (the error message)
- **`exec-finished`**: Sent after a query from `exec-all` or `exec-get` has completed successfully.
  - **Payload**: `{ id: string, rows: any[], columns: string[] }`. The `id` corresponds to the original request payload.
- **`exec-error`**: Sent if an error occurs during query execution.
  - **Payload**: `{ id: string, error: string }`. The `id` corresponds to the original request payload.
- **`debug`**: Used to send an array of diagnostic logs from the worker to the main thread for easier debugging.
  - **Payload**: `string[]`

### Worker Isolation

The worker must remain generic and contain no domain-specific knowledge (e.g., hardcoded table or column names). It should be a reusable utility for executing SQLite queries.

## 3. Database Schema and Naming

- **Snake Case**: All database table and column names must use `snake_case` for consistency (e.g., `ingredients`, `base_value`).
- **Schema as Source of Truth**: The Drizzle schema file (`src/db/schema.ts`) is the single source of truth for the database structure. All application code (including seeding scripts) must be consistent with the field names defined in the schema.

## 4. Database Lifecycle

- **Migrations**: The application must support a migration system to manage schema changes. Migrations should run automatically when the database is initialized.
- **Seeding**: The application must support a seeding mechanism to populate the database with initial data on first run.
- **Database Reset**: A global `window.resetDatabase()` function must be available in development for resetting the database to a clean, migrated, and seeded state without requiring a page reload. This involves instructing the worker to reopen the database with a special flag that causes it to be deleted first.
