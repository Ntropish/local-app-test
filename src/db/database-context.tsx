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
import SharedDbWorker from './shared-worker.ts?sharedworker'

interface DatabaseContextType {
  db: ReturnType<typeof drizzle> | null
  isInitialized: boolean
  resetDatabase: () => void
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
  log('[DatabaseProvider] Rendering')
  const [db, setDb] = useState<ReturnType<typeof drizzle> | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [awaiting, setAwaiting] = useState<
    Record<
      string,
      { resolve: (value: any) => void; reject: (reason: any) => void }
    >
  >({})
  const workerRef = useRef<SharedWorker | null>(null)

  const awaitingRef = useRef(awaiting)
  awaitingRef.current = awaiting

  const createCustomProxy = useCallback(() => {
    return async (
      sql: string,
      params: any[],
      method: 'get' | 'all' | 'run' | 'values',
    ): Promise<{ rows: any; columns?: string[] }> => {
      if (!workerRef.current) {
        throw new Error('Shared worker not available')
      }
      const id = uuid()
      const messageType = method === 'get' ? 'exec-get' : 'exec-all'

      return new Promise<{ rows: any; columns?: string[] }>(
        (resolve, reject) => {
          setAwaiting((prev) => ({
            ...prev,
            [id]: { resolve, reject },
          }))
          workerRef.current?.port.postMessage({
            type: messageType,
            payload: { id, sql, params },
          })
        },
      )
    }
  }, [])

  const runMigrations = useCallback(async () => {
    await ensureMigrationsTable()
    const appliedMigrations = await getAppliedMigrations()
    const isFreshDatabase = appliedMigrations.length === 0
    const migrations = import.meta.glob('/drizzle/*.sql', { as: 'raw' })

    for (const path in migrations) {
      const migrationName = path.split('/').pop()?.replace('.sql', '')
      if (!migrationName || appliedMigrations.includes(migrationName)) {
        continue
      }
      log(`[runMigrations] Applying migration: ${migrationName}`)
      const sql = await migrations[path]()
      const queries = sql
        .split('--> statement-breakpoint')
        .map((it) => it.trim())
      for (const query of queries) {
        if (query.length === 0) continue
        try {
          await executeQuery(query)
        } catch (err: any) {
          error('[runMigrations] Migration error:', err.message, err.stack)
          throw err
        }
      }
      await markMigrationAsApplied(migrationName)
    }
    if (isFreshDatabase) {
      await runSeeds()
    }
  }, [])

  const executeQuery = useCallback(async (sql: string, params: any[] = []) => {
    if (!workerRef.current) {
      throw new Error('Shared worker not available')
    }
    const id = uuid()
    return new Promise<{ rows: any[]; columns: string[] }>(
      (resolve, reject) => {
        setAwaiting((prev) => ({
          ...prev,
          [id]: { resolve, reject },
        }))
        workerRef.current?.port.postMessage({
          type: 'exec-all',
          payload: { id, sql, params },
        })
      },
    )
  }, [])

  const ensureMigrationsTable = useCallback(async () => {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    await executeQuery(createTableSQL)
  }, [executeQuery])

  const getAppliedMigrations = useCallback(async (): Promise<string[]> => {
    const result = await executeQuery(
      'SELECT name FROM __drizzle_migrations ORDER BY id',
    )
    return (result.rows || []).flat()
  }, [executeQuery])

  const markMigrationAsApplied = useCallback(
    async (migrationName: string) => {
      await executeQuery(
        `INSERT INTO __drizzle_migrations (name) VALUES ('${migrationName}')`,
      )
    },
    [executeQuery],
  )

  const runSeeds = useCallback(async () => {
    const tempDb = drizzle(
      async (
        sql: string,
        params: any[],
      ): Promise<{ rows: any[]; columns: string[] }> => {
        return executeQuery(sql, params)
      },
      { schema },
    )
    await seed(tempDb, schema)
  }, [executeQuery])

  const resetDatabase = useCallback(() => {
    if (!workerRef.current) return
    setIsInitialized(false)
    setDb(null)
    setAwaiting({})
    // Re-initialize will be triggered by the init-finished message
    workerRef.current.port.postMessage({
      type: 'init',
      payload: { filename: '/mydb.sqlite3?delete-before-open=1' },
    })
  }, [])

  useEffect(() => {
    const worker = new SharedDbWorker()
    workerRef.current = worker

    const handleMessage = (e: MessageEvent) => {
      const { type, payload } = e.data
      switch (type) {
        case 'debug': {
          log('[shared-worker] Debug logs:\n', payload.join('\n'))
          break
        }
        case 'init-finished': {
          log(
            `SQLite3 version ${payload.version} has been initialized in the shared worker.`,
          )
          log(
            payload.opfs
              ? `OPFS is available, created persisted database at ${payload.filename}`
              : `OPFS is not available, created transient database ${payload.filename}`,
          )

          runMigrations()
            .then(() => {
              const newDb = drizzle(createCustomProxy(), { schema })
              setDb(newDb)
              setIsInitialized(true)
            })
            .catch((err) => {
              error('Database initialization failed:', err.message)
              setIsInitialized(false)
            })
          break
        }
        case 'init-error': {
          error(`[shared-worker] initialization failed: ${payload}`)
          setIsInitialized(false)
          break
        }
        case 'exec-finished': {
          const promise = awaitingRef.current[payload.id]
          if (promise) {
            promise.resolve(payload)
            setAwaiting((prev) => {
              const newAwaiting = { ...prev }
              delete newAwaiting[payload.id]
              return newAwaiting
            })
          }
          break
        }
        case 'exec-error': {
          const promise = awaitingRef.current[payload.id]
          if (promise) {
            promise.reject(new Error(payload.error))
            setAwaiting((prev) => {
              const newAwaiting = { ...prev }
              delete newAwaiting[payload.id]
              return newAwaiting
            })
          }
          break
        }
      }
    }

    worker.port.onmessage = handleMessage
    worker.port.start()

    worker.port.postMessage({
      type: 'init',
      payload: { filename: '/mydb.sqlite3' },
    })

    return () => {
      worker.port.close()
    }
  }, [createCustomProxy, runMigrations])

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
  }

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  )
}
