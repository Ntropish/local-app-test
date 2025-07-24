import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

console.log(
  `[shared-worker] Top-level scope check: self.crossOriginIsolated = ${self.crossOriginIsolated}`,
)

const ports = new Set<MessagePort>()
let sqlite3: any = null
let db: any = null
let dbInitialized = false
let initInProgress = false
let initError: Error | null = null

// @ts-ignore
self.addEventListener('connect', (e: MessageEvent) => {
  const port = e.ports[0]
  ports.add(port)
  console.log(`[shared-worker] connection #${ports.size}.`)
  console.log(
    `[shared-worker] Connection-time scope check: self.crossOriginIsolated = ${self.crossOriginIsolated}`,
  )

  if (initError) {
    port.postMessage({ type: 'init-error', payload: initError.message })
    return
  }
  if (dbInitialized) {
    port.postMessage({
      type: 'init-finished',
      payload: {
        version: sqlite3.version.libVersion,
        filename: db.filename,
        opfs: 'opfs' in sqlite3,
      },
    })
  }

  port.onmessage = async (msg: MessageEvent) => {
    const { type, payload } = msg.data
    try {
      switch (type) {
        case 'init': {
          if (dbInitialized) {
            console.log('[shared-worker] Database already initialized.')
            const response = {
              type: 'init-finished',
              payload: {
                version: sqlite3.version.libVersion,
                filename: db.filename,
                opfs: 'opfs' in sqlite3,
              },
            }
            port.postMessage(response)
            return
          }
          if (initInProgress) {
            port.postMessage({
              type: 'init-error',
              payload: 'Database initialization is already in progress.',
            })
            return
          }

          initInProgress = true
          initError = null
          try {
            const filename = payload?.filename
            const result = await init(filename)
            sqlite3 = result.sqlite3
            db = result.db
            db.exec([
              'PRAGMA journal_mode = TRUNCATE;',
              'PRAGMA synchronous = FULL;',
            ])
            dbInitialized = true
            initInProgress = false

            const response = {
              type: 'init-finished',
              payload: {
                version: sqlite3.version.libVersion,
                filename: db.filename,
                opfs: !!sqlite3.oo1.OpfsDb,
              },
            }
            ports.forEach((p) => p.postMessage(response))
          } catch (e: any) {
            initError = e
            initInProgress = false
            ports.forEach((p) =>
              p.postMessage({ type: 'init-error', payload: e.message }),
            )
          }
          break
        }

        case 'exec-all': {
          if (!db) {
            port.postMessage({
              type: 'exec-error',
              payload: { id: payload.id, error: 'Database not initialized' },
            })
            return
          }

          try {
            const stmt = db.prepare(payload.sql)
            if (payload.params?.length) {
              stmt.bind(payload.params)
            }
            const rows: any[][] = []
            let columns: string[] = []
            if (stmt.columnCount > 0) {
              columns = stmt.getColumnNames()
              while (stmt.step()) {
                rows.push(stmt.get([]))
              }
            } else {
              stmt.step()
            }
            stmt.finalize()
            port.postMessage({
              type: 'exec-finished',
              payload: { id: payload.id, rows, columns },
            })
          } catch (e: any) {
            port.postMessage({
              type: 'exec-error',
              payload: { id: payload.id, error: e.message },
            })
          }
          break
        }

        case 'exec-get': {
          if (!db) {
            port.postMessage({
              type: 'exec-error',
              payload: { id: payload.id, error: 'Database not initialized' },
            })
            return
          }

          try {
            const stmt = db.prepare(payload.sql)
            if (payload.params?.length) {
              stmt.bind(payload.params)
            }
            let row: any[] | null = null
            const columns = stmt.columnCount > 0 ? stmt.getColumnNames() : []
            if (stmt.step()) {
              row = stmt.get([])
            }
            stmt.finalize()
            port.postMessage({
              type: 'exec-finished',
              payload: { id: payload.id, rows: row, columns },
            })
          } catch (e: any) {
            port.postMessage({
              type: 'exec-error',
              payload: { id: payload.id, error: e.message },
            })
          }
          break
        }
      }
    } catch (e) {
      console.error('Error in worker', e)
    }
  }
})

const init = async (filename?: string) => {
  const debug_logs: string[] = []
  debug_logs.push('Loading and initializing SQLite3 module.')
  const sqlite3Module = await sqlite3InitModule({
    print: (msg: string) => debug_logs.push(msg),
    printErr: (msg: string) => debug_logs.push(`ERROR: ${msg}`),
  })
  debug_logs.push(
    `[shared-worker] Immediate check: self.crossOriginIsolated = ${self.crossOriginIsolated}`,
  )
  debug_logs.push(
    `[shared-worker] sqlite3.oo1.OpfsDb is available = ${!!sqlite3Module.oo1.OpfsDb}`,
  )
  debug_logs.push('Done initializing. Starting DB…')
  const db = await start(sqlite3Module, filename, debug_logs)
  debug_logs.push('DB started.')
  ports.forEach((p) => p.postMessage({ type: 'debug', payload: debug_logs }))
  return { sqlite3: sqlite3Module, db }
}

const start = async (
  sqlite3: any,
  filename?: string,
  debug_logs: string[] = [],
) => {
  const file = filename || '/mydb.sqlite3'
  debug_logs.push(`Running SQLite3 ${sqlite3.version.libVersion}`)
  try {
    if (sqlite3.oo1.OpfsDb) {
      const db = new sqlite3.oo1.OpfsDb(file)
      debug_logs.push(
        `OPFS is available, created persisted database at ${db.filename}`,
      )
      return db
    } else {
      debug_logs.push('OPFS not available, falling back to in-memory database.')
      return new sqlite3.oo1.DB(file, 'ct')
    }
  } catch (e: any) {
    debug_logs.push(`Error opening OPFS database: ${(e as any).message}`)
  }
  debug_logs.push('FALLING BACK TO IN-MEMORY DATABASE')
  return new sqlite3.oo1.DB(file, 'ct')
}
