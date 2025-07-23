import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { uuidv7 as uuid } from 'uuidv7'
import * as schema from './schema'
import { error, log } from './utils'
import { seed } from './seed'

let worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url), {
  type: 'module',
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (worker) {
      worker.terminate()
    }
  })
}

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
      const { id, rows, columns } = payload
      const promise = awaiting[id]
      if (promise) {
        promise.resolve({ rows, columns })
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
): Promise<{ rows: any[]; columns?: string[] }> => {
  const id = uuid()
  return new Promise((resolve, reject) => {
    awaiting[id] = { resolve, reject }
    worker.postMessage({
      type: 'exec',
      payload: { id, sql, params },
    })
  })
}

let db = drizzle(customProxy, { schema })

// Export a getter function to always get the current db instance
export const getDb = () => db
export { db }

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
      worker.postMessage({
        type: 'init',
        payload: { filename: '/mydb.sqlite3' },
      })
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
        console.log('resetting database')

        // Reset local state first
        isInitialized = false
        initPromise = null
        initResolve = null
        initReject = null

        // Clear any pending requests
        Object.keys(awaiting).forEach((id) => {
          const promise = awaiting[id]
          if (promise) {
            promise.reject(new Error('Database reset in progress'))
            delete awaiting[id]
          }
        })

        // Terminate the current worker and create a new one
        worker.terminate()

        // Create a fresh worker with a unique database filename
        const timestamp = Date.now()
        const dbFilename = `/mydb_${timestamp}.sqlite3`

        const newWorker = new Worker(
          new URL('./sqlite-worker.ts', import.meta.url),
          {
            type: 'module',
          },
        )

        // Set up the new worker's message handler
        newWorker.onmessage = worker.onmessage

        // Replace the old worker
        worker = newWorker

        // Send init message with custom filename
        worker.postMessage({
          type: 'init',
          payload: { filename: dbFilename },
        })

        // Wait for initialization
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(
              new Error('Database initialization timeout after 10 seconds'),
            )
          }, 10000)

          const originalHandler = worker.onmessage
          const tempHandler = (e: MessageEvent) => {
            if (e.data.type === 'init-finished') {
              clearTimeout(timeout)
              worker.onmessage = originalHandler
              resolve()
            } else if (
              e.data.type === 'exec-error' &&
              e.data.payload.error.includes('init')
            ) {
              clearTimeout(timeout)
              worker.onmessage = originalHandler
              reject(new Error(e.data.payload.error))
            } else if (originalHandler) {
              originalHandler.call(worker, e)
            }
          }
          worker.onmessage = tempHandler
        })

        // Now run migrations on the fresh database
        await runMigrations()

        // Update the global database instance to use the new worker
        // This is crucial because Drizzle caches the connection
        const newCustomProxy = async (
          sql: string,
          params: any[],
        ): Promise<{ rows: any[]; columns?: string[] }> => {
          const id = uuid()
          return new Promise((resolve, reject) => {
            awaiting[id] = { resolve, reject }
            worker.postMessage({
              type: 'exec',
              payload: { id, sql, params },
            })
          })
        }

        // Recreate the Drizzle instance with the new worker
        const newDb = drizzle(newCustomProxy, { schema })

        // Replace the global db instance
        db = newDb

        // Mark the database as initialized
        isInitialized = true

        console.log('Database reset completed successfully')
        // Note: No page reload needed since we properly reset the database state
      } catch (error) {
        console.error('Failed to reset database:', error)
        // Even if reset fails, try to reinitialize
        try {
          await initializeSQLite()
        } catch (reinitError) {
          console.error(
            'Failed to reinitialize database after reset:',
            reinitError,
          )
        }
      }
    }
    console.log('Database reset function available at window.resetDatabase()')
  }
}

initializeGlobalFunctions()
