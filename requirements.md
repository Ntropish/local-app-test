# Application Requirements

This document outlines the key architectural and functional requirements for the application's data layer.

## 1. Data Layer Architecture

- **SQLite in a Web Worker**: The application must use SQLite, running in a dedicated Web Worker to avoid blocking the main UI thread.
- **OPFS Persistence**: The database should be persisted in the browser's Origin Private File System (OPFS) when available to ensure data survives across sessions.
- **Drizzle ORM**: Drizzle ORM is the designated query builder and type-safe interface to the database.
- **React Context**: All database interactions from the React components must go through a dedicated React Context (`DatabaseProvider`) to manage state, initialization, and the worker lifecycle. Direct imports of the database instance in components should be avoided.

## 2. Worker Communication Protocol

- **Explicit Message Types**: The communication between the main thread and the SQLite worker must use explicit message types for different database operations. A generic `exec` command is insufficient.
- **`exec-all`**: This message type is for queries that return multiple rows (e.g., Drizzle's `.all()` method).
  - **Expected Response**: The worker must return a payload where the `rows` property is an array of arrays, representing the result set (e.g., `[[1, 'foo'], [2, 'bar']]`).
- **`exec-get`**: This message type is for queries that are expected to return a single row (e.g., Drizzle's `.get()` method).
  - **Expected Response**: The worker must return a payload where the `rows` property is a single array of values representing the row (e.g., `[1, 'foo']`), or `null` if no row is found.
- **Worker Isolation**: The worker must remain generic and contain no domain-specific knowledge (e.g., hardcoded table or column names). It should be a reusable utility for executing SQLite queries.

## 3. Database Schema and Naming

- **Snake Case**: All database table and column names must use `snake_case` for consistency (e.g., `ingredients`, `base_value`).
- **Schema as Source of Truth**: The Drizzle schema file (`src/db/schema.ts`) is the single source of truth for the database structure. All application code (including seeding scripts) must be consistent with the field names defined in the schema.

## 4. Database Lifecycle

- **Migrations**: The application must support a migration system to manage schema changes. Migrations should run automatically when the database is initialized.
- **Seeding**: The application must support a seeding mechanism to populate the database with initial data on first run.
- **Database Reset**: A global `window.resetDatabase()` function must be available in development for resetting the database to a clean, migrated, and seeded state without requiring a page reload. This involves terminating the old worker and creating a new one with a new database file.
