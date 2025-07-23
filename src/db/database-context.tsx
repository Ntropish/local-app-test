import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { uuidv7 as uuid } from 'uuidv7'
import * as schema from './schema'
import { error, log } from './utils'
import { seed } from './seed'

interface DatabaseContextType {
  db: ReturnType<typeof drizzle> | null
  isInitialized: boolean
  resetDatabase: () => Promise<void>
  initializeDatabase: () => Promise<void>
}

const DatabaseContext = createContext<DatabaseContextType | null>(null)

export const useDatabase = () => {
  const context = useContext(DatabaseContext)
  if (!context) {
    throw new Error('useDatabase must be used within a DatabaseProvider')
  }
  return context
}

interface DatabaseProviderProps {
  children: React.ReactNode
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({
  children,
}) => {
  const [db, setDb] = useState<ReturnType<typeof drizzle> | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [worker, setWorker] = useState<Worker | null>(null)
  const [awaiting, setAwaiting] = useState<
    Record<
      string,
      { resolve: (value: any) => void; reject: (reason: any) => void }
    >
  >({})

  const awaitingRef = useRef(awaiting)
  awaitingRef.current = awaiting

  const createWorker = useCallback(() => {
    const newWorker = new Worker(
      new URL('./sqlite-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    )

    newWorker.onmessage = (e) => {
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
          log(
            '[worker] Worker initialization completed, starting migrations...',
          )
          // Now that the worker is ready, we can run migrations
          runMigrations(newWorker)
            .then(async () => {
              // Create the database instance that will be used by components
              const newDb = drizzle(createCustomProxy(newWorker), { schema })
              setDb(newDb)

              // Test the database to ensure it's working
              try {
                const testResult = await newDb
                  .select()
                  .from(schema.ingredients)
                  .limit(1)
                log(
                  '[DatabaseContext] Database test query successful, database fully ready',
                )
                setIsInitialized(true)
              } catch (testErr) {
                error('[DatabaseContext] Database test query failed:', testErr)
                setIsInitialized(false)
              }
            })
            .catch((err) => {
              error('Database initialization failed:', err.message)
              setIsInitialized(false)
            })
          break
        }
        case 'exec-finished': {
          const { id, rows, columns } = payload
          log(
            `[DatabaseContext] Query ${id} finished - columns: ${JSON.stringify(
              columns,
            )}, rows: ${JSON.stringify(rows)}`,
          )
          const promise = awaitingRef.current[id]
          if (promise) {
            promise.resolve({ rows, columns })
            setAwaiting((prev) => {
              const newAwaiting = { ...prev }
              delete newAwaiting[id]
              return newAwaiting
            })
          }
          break
        }
        case 'exec-error': {
          const { id, error } = payload
          log(`[worker] Database error for query ${id}: ${error}`)
          const promise = awaitingRef.current[id]
          if (promise) {
            promise.reject(new Error(error))
            setAwaiting((prev) => {
              const newAwaiting = { ...prev }
              delete newAwaiting[id]
              return newAwaiting
            })
          }
          break
        }
        default: {
          // Do nothing
        }
      }
    }

    return newWorker
  }, [])

  const createCustomProxy = useCallback((currentWorker: Worker) => {
    return async (
      sql: string,
      params: any[],
      method: 'get' | 'all' | 'run' | 'values',
    ): Promise<{ rows: any; columns?: string[] }> => {
      const id = uuid()

      // Use the method provided by Drizzle to determine the worker message type
      const messageType = method === 'get' ? 'exec-get' : 'exec-all'

      const result = await new Promise<{ rows: any; columns?: string[] }>(
        (resolve, reject) => {
          setAwaiting((prev) => ({
            ...prev,
            [id]: { resolve, reject },
          }))
          currentWorker.postMessage({
            type: messageType,
            payload: { id, sql, params },
          })
        },
      )

      return result
    }
  }, [])

  const runMigrations = useCallback(async (currentWorker: Worker) => {
    // First, ensure the migrations table exists
    await ensureMigrationsTable(currentWorker)

    // Get applied migrations
    const appliedMigrations = await getAppliedMigrations(currentWorker)

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
      const queries = sql
        .split('--> statement-breakpoint')
        .map((it) => it.trim())

      for (const query of queries) {
        if (query.length === 0) {
          continue
        }

        log(`[runMigrations] Executing migration query: ${query}`)
        try {
          const response = await executeQuery(currentWorker, query)
          log(`[runMigrations] Migration query: ${query} response: ${response}`)
        } catch (err: any) {
          log(`[runMigrations] Migration query: ${query} failed`)
          error('[runMigrations] Migration error:', err.message, err.stack)
          throw err
        }
      }

      // Mark migration as applied
      await markMigrationAsApplied(currentWorker, migrationName)
      log(`[runMigrations] Migration ${migrationName} applied successfully`)
    }

    log(`[runMigrations] All migrations completed`)

    // Run seeds only if this is a fresh database (first time setup)
    if (isFreshDatabase) {
      await runSeeds(currentWorker)
    }
  }, [])

  const executeQuery = useCallback(
    async (currentWorker: Worker, sql: string, params: any[] = []) => {
      const id = uuid()
      return new Promise<{ rows: any[]; columns: string[] }>(
        (resolve, reject) => {
          const tempAwaiting = { [id]: { resolve, reject } }

          const tempHandler = (e: MessageEvent) => {
            const { type, payload } = e.data
            if (type === 'exec-finished' && payload.id === id) {
              currentWorker.removeEventListener('message', tempHandler)
              resolve(payload)
            } else if (type === 'exec-error' && payload.id === id) {
              currentWorker.removeEventListener('message', tempHandler)
              reject(new Error(payload.error))
            }
          }

          currentWorker.addEventListener('message', tempHandler)
          currentWorker.postMessage({
            type: 'exec-all',
            payload: { id, sql, params },
          })
        },
      )
    },
    [],
  )

  const ensureMigrationsTable = useCallback(
    async (currentWorker: Worker) => {
      const createTableSQL = `
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `

      try {
        await executeQuery(currentWorker, createTableSQL)
        log('[ensureMigrationsTable] Migrations table ensured')
      } catch (err: any) {
        log(
          '[ensureMigrationsTable] Error ensuring migrations table:',
          err.message,
        )
        throw err
      }
    },
    [executeQuery],
  )

  const getAppliedMigrations = useCallback(
    async (currentWorker: Worker): Promise<string[]> => {
      try {
        const result = await executeQuery(
          currentWorker,
          'SELECT name FROM __drizzle_migrations ORDER BY id',
        )
        const migrations = result.rows || []
        log(
          `[getAppliedMigrations] Found ${migrations.length} applied migrations:`,
          migrations,
        )
        return migrations.map((row: any) => row[0])
      } catch (err: any) {
        log(
          '[getAppliedMigrations] Error getting applied migrations:',
          err.message,
        )
        return []
      }
    },
    [executeQuery],
  )

  const markMigrationAsApplied = useCallback(
    async (currentWorker: Worker, migrationName: string) => {
      try {
        await executeQuery(
          currentWorker,
          `INSERT INTO __drizzle_migrations (name) VALUES ('${migrationName}')`,
        )
        log(`[markMigrationAsApplied] Marked ${migrationName} as applied`)
      } catch (err: any) {
        log(
          `[markMigrationAsApplied] Error marking ${migrationName} as applied:`,
          err.message,
        )
        throw err
      }
    },
    [executeQuery],
  )

  const runSeeds = useCallback(
    async (currentWorker: Worker) => {
      log('[runSeeds] Running database seeds for fresh database...')
      try {
        // Create a temporary db instance for seeding
        const tempDb = drizzle(
          async (
            sql: string,
            params: any[],
          ): Promise<{ rows: any[]; columns: string[] }> => {
            const result = await executeQuery(currentWorker, sql, params)
            return result
          },
          { schema },
        )
        await seed(tempDb, schema)
        log('[runSeeds] Seeding completed successfully')
      } catch (err: any) {
        log('[runSeeds] Seeding failed:', err.message)
        // Don't throw here - seeding failure shouldn't break the app
      }
    },
    [executeQuery],
  )

  const initializeDatabase = useCallback(async () => {
    if (isInitialized) return

    try {
      const newWorker = createWorker()
      setWorker(newWorker)

      // Use a unique filename for each database instance
      const timestamp = Date.now()
      const dbFilename = `/mydb_${timestamp}.sqlite3`

      // Send init message
      newWorker.postMessage({
        type: 'init',
        payload: { filename: dbFilename },
      })

      // Database instance will be created after migrations complete
    } catch (err: any) {
      error('Database initialization failed:', err.message)
      setIsInitialized(false)
    }
  }, [isInitialized, createWorker, createCustomProxy])

  const resetDatabase = useCallback(async () => {
    try {
      console.log('resetting database')

      // Terminate the current worker
      if (worker) {
        worker.terminate()
      }

      // Clear state
      setIsInitialized(false)
      setDb(null)
      setWorker(null)
      setAwaiting({})

      // Create a fresh worker with a unique database filename
      const timestamp = Date.now()
      const dbFilename = `/mydb_${timestamp}.sqlite3`

      const newWorker = createWorker()
      setWorker(newWorker)

      // Send init message with custom filename
      newWorker.postMessage({
        type: 'init',
        payload: { filename: dbFilename },
      })

      // Create new database instance
      const newDb = drizzle(createCustomProxy(newWorker), { schema })
      setDb(newDb)

      console.log('Database reset completed successfully')
    } catch (error) {
      console.error('Failed to reset database:', error)
      // Try to reinitialize
      await initializeDatabase()
    }
  }, [worker, createWorker, createCustomProxy, initializeDatabase])

  // Initialize database on mount
  const isInitializedRef = useRef(false)
  useEffect(() => {
    if (!isInitializedRef.current) {
      initializeDatabase()
      isInitializedRef.current = true
    }
  }, [initializeDatabase])

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (worker) {
        worker.terminate()
      }
    }
  }, [worker])

  // Assign resetDatabase to window for development
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // @ts-ignore
      window.resetDatabase = resetDatabase
    }
  }, [resetDatabase])

  const value: DatabaseContextType = {
    db,
    isInitialized,
    resetDatabase,
    initializeDatabase,
  }

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  )
}
