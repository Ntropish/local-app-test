import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { uuidv7 as uuid } from 'uuidv7'
import * as schema from './schema'
import { error, log } from './utils'
import { seed } from './seed'

const worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url), {
  type: 'module',
})

const awaiting: Record<
  string,
  { resolve: (value: any) => void; reject: (reason: any) => void }
> = {}

let isInitialized = false
let initPromise: Promise<void> | null = null
let initResolve: (() => void) | null = null
let initReject: ((error: any) => void) | null = null

worker.onmessage = (e) => {
  const { type, payload } = e.data
  switch (type) {
    case 'init-finished': {
      log(
        `SQLite3 version ${payload.version} has been initialized in a worker thread.`,
      )
      log(
        payload.opfs
          ? `OPFS is available, created persisted database at ${payload.filename}`
          : `OPFS is not available, created transient database ${payload.filename}`,
      )
      log('[worker] Worker initialization completed, starting migrations...')
      // Now that the worker is ready, we can run migrations
      if (initResolve) {
        runMigrations().then(initResolve).catch(initReject)
      }
      break
    }
    case 'exec-finished': {
      const { id, rows } = payload
      const promise = awaiting[id]
      if (promise) {
        promise.resolve({ rows })
        delete awaiting[id]
      }
      break
    }
    case 'exec-error': {
      const { id, error } = payload
      log(`[worker] Database error for query ${id}: ${error}`)
      const promise = awaiting[id]
      if (promise) {
        promise.reject(new Error(error))
        delete awaiting[id]
      }
      break
    }
    default: {
      // Do nothing
    }
  }
}

const customProxy = async (
  sql: string,
  params: any[],
): Promise<{ rows: any[] }> => {
  const id = uuid()
  return new Promise((resolve, reject) => {
    awaiting[id] = { resolve, reject }
    worker.postMessage({
      type: 'exec',
      payload: { id, sql, params },
    })
  })
}

export const db = drizzle(customProxy, { schema })

const runMigrations = async () => {
  // First, ensure the migrations table exists
  await ensureMigrationsTable()

  // Get applied migrations
  const appliedMigrations = await getAppliedMigrations()

  // Check if this is a fresh database (no migrations applied yet)
  const isFreshDatabase = appliedMigrations.length === 0

  // Get all migration files
  const migrations = import.meta.glob('/drizzle/*.sql', { as: 'raw' })

  for (const path in migrations) {
    // Extract migration name from path (e.g., "0000_adorable_lord_tyger" from "/drizzle/0000_adorable_lord_tyger.sql")
    const migrationName = path.split('/').pop()?.replace('.sql', '')

    if (!migrationName) continue

    // Skip if already applied
    if (appliedMigrations.includes(migrationName)) {
      log(
        `[runMigrations] Migration ${migrationName} already applied, skipping`,
      )
      continue
    }

    log(`[runMigrations] Applying migration: ${migrationName}`)

    const sql = await migrations[path]()
    const queries = sql.split('--> statement-breakpoint').map((it) => it.trim())

    for (const query of queries) {
      if (query.length === 0) {
        continue
      }

      log(`[runMigrations] Executing migration query: ${query}`)
      try {
        const response = await db.run(query as any)
        log(`[runMigrations] Migration query: ${query} response: ${response}`)
      } catch (err: any) {
        log(`[runMigrations] Migration query: ${query} failed`)
        error('[runMigrations] Migration error:', err.message, err.stack)
        throw err
      }
    }

    // Mark migration as applied
    await markMigrationAsApplied(migrationName)
    log(`[runMigrations] Migration ${migrationName} applied successfully`)
  }

  log(`[runMigrations] All migrations completed`)

  // Run seeds only if this is a fresh database (first time setup)
  if (isFreshDatabase) {
    await runSeeds()
  }
}

const runSeeds = async () => {
  log('[runSeeds] Running database seeds for fresh database...')
  try {
    await seed(db, schema)
    log('[runSeeds] Seeding completed successfully')
  } catch (err: any) {
    log('[runSeeds] Seeding failed:', err.message)
    // Don't throw here - seeding failure shouldn't break the app
  }
}

const ensureMigrationsTable = async () => {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `

  try {
    await db.run(createTableSQL as any)
    log('[ensureMigrationsTable] Migrations table ensured')
  } catch (err: any) {
    log('[ensureMigrationsTable] Error ensuring migrations table:', err.message)
    throw err
  }
}

const getAppliedMigrations = async (): Promise<string[]> => {
  try {
    const result = await db.run(
      'SELECT name FROM __drizzle_migrations ORDER BY id' as any,
    )
    const migrations = result.rows || []
    log(
      `[getAppliedMigrations] Found ${migrations.length} applied migrations:`,
      migrations,
    )
    return migrations.map((row: any) => row[0])
  } catch (err: any) {
    log('[getAppliedMigrations] Error getting applied migrations:', err.message)
    return []
  }
}

const markMigrationAsApplied = async (migrationName: string) => {
  try {
    await db.run(
      `INSERT INTO __drizzle_migrations (name) VALUES ('${migrationName}')` as any,
    )
    log(`[markMigrationAsApplied] Marked ${migrationName} as applied`)
  } catch (err: any) {
    log(
      `[markMigrationAsApplied] Error marking ${migrationName} as applied:`,
      err.message,
    )
    throw err
  }
}

const initializeSQLite = async () => {
  return new Promise<void>((resolve, reject) => {
    try {
      log('[initializeSQLite] Call worker.postMessage')
      initResolve = resolve
      initReject = reject
      worker.postMessage({ type: 'init' })
      log(
        '[initializeSQLite] Init message sent, waiting for worker response...',
      )

      // Add a timeout to prevent infinite hanging
      setTimeout(() => {
        if (!isInitialized) {
          const timeoutError = new Error(
            'Database initialization timeout after 10 seconds',
          )
          log('[initializeSQLite] Timeout error:', timeoutError.message)
          reject(timeoutError)
        }
      }, 10000)
    } catch (err: any) {
      error('Initialization error:', err.message, err.stack)
      reject(err)
    }
  })
    .then(() => {
      isInitialized = true
      log('[initializeSQLite] Database initialization completed')
    })
    .catch((err) => {
      error('Database initialization failed:', err.message)
      throw err
    })
}

// Create the initialization promise
initPromise = initializeSQLite()

// Export a function to wait for initialization
export const waitForDB = async () => {
  if (isInitialized) return
  if (initPromise) {
    await initPromise
  }
}

// Export initialization status
export const isDBReady = () => isInitialized

// Development-only function to reset the database (call manually when needed)
export const resetDatabaseForDevelopment = async () => {
  log('[resetDatabaseForDevelopment] Resetting database to clean state...')

  try {
    // Drop all tables if they exist
    await db.run('DROP TABLE IF EXISTS __drizzle_migrations' as any)
    await db.run('DROP TABLE IF EXISTS ingredients' as any)

    // Recreate the migrations tracking table
    await ensureMigrationsTable()

    log('[resetDatabaseForDevelopment] Database reset completed')

    // Run migrations and seeds on the fresh database
    await runMigrations()

    log('[resetDatabaseForDevelopment] Database reset and seeding completed')
  } catch (err: any) {
    log('[resetDatabaseForDevelopment] Error resetting database:', err.message)
    throw err
  }
}

// Expose reset function globally for development
declare global {
  interface Window {
    resetDatabase: () => Promise<void>
  }
}

// Initialize global function after database is ready
const initializeGlobalFunctions = () => {
  if (typeof window !== 'undefined') {
    window.resetDatabase = async () => {
      try {
        await waitForDB() // Ensure database is ready
        await resetDatabaseForDevelopment()
        // Reload the page to reflect the reset
        window.location.reload()
      } catch (error) {
        console.error('Failed to reset database:', error)
      }
    }
    console.log('Database reset function available at window.resetDatabase()')
  }
}

// Call this after database initialization
initPromise?.then(() => {
  initializeGlobalFunctions()
})
