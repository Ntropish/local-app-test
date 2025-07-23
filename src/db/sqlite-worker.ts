import { log, error } from './utils'

/* ---------- message router ---------- */
let sqlite3: any = null
let db: any = null

self.onmessage = async (msg) => {
  const { type, payload } = msg.data
  try {
    switch (type) {
      /* first call from main thread */
      case 'init': {
        const filename = payload?.filename
        const result = await init(filename)
        sqlite3 = result.sqlite3
        db = result.db
        self.postMessage({
          type: 'init-finished',
          payload: {
            version: sqlite3.version.libVersion,
            filename: db.filename,
            opfs: 'opfs' in sqlite3,
          },
        })
        break
      }

      /* multi-row query (for .all()) returns any[][] */
      case 'exec-all': {
        if (!db) {
          self.postMessage({
            type: 'exec-error',
            payload: { id: payload.id, error: 'Database not initialized' },
          })
          return
        }

        try {
          const stmt = db.prepare(payload.sql)
          log(`[worker] Prepared multi-row query: ${payload.sql}`)

          if (payload.params?.length) {
            stmt.bind(payload.params)
            log(`[worker] Bound ${payload.params.length} parameters`)
          }

          const rows: any[][] = []
          let columns: string[] = []

          if (stmt.columnCount > 0) {
            columns = stmt.getColumnNames()
            log(
              `[worker] Query has ${stmt.columnCount} columns: ${JSON.stringify(
                columns,
              )}`,
            )

            while (stmt.step()) {
              const row: any[] = []
              for (let i = 0; i < stmt.columnCount; i++) {
                row.push(stmt.get(i))
              }
              log(`[worker] Got row: ${JSON.stringify(row)}`)
              rows.push(row)
            }
          } else {
            log(`[worker] DDL/DML query, executing once`)
            stmt.step()
          }

          stmt.finalize()
          log(
            `[worker] Multi-row query completed successfully, returning ${rows.length} rows`,
          )

          self.postMessage({
            type: 'exec-finished',
            payload: { id: payload.id, rows, columns },
          })
        } catch (e: any) {
          log(`[worker] Multi-row query failed: ${e.message}`)
          self.postMessage({
            type: 'exec-error',
            payload: { id: payload.id, error: e.message },
          })
        }
        break
      }

      /* single-row query (for .get()) returns any[] | null */
      case 'exec-get': {
        if (!db) {
          self.postMessage({
            type: 'exec-error',
            payload: { id: payload.id, error: 'Database not initialized' },
          })
          return
        }

        try {
          const stmt = db.prepare(payload.sql)
          log(`[worker] Prepared single-row query: ${payload.sql}`)
          if (payload.params?.length) {
            stmt.bind(payload.params)
            log(`[worker] Bound ${payload.params.length} parameters`)
          }

          let row: any[] | null = null
          let columns: string[] = []

          if (stmt.columnCount > 0) {
            columns = stmt.getColumnNames()
            log(
              `[worker] Query has ${stmt.columnCount} columns: ${JSON.stringify(
                columns,
              )}`,
            )
            if (stmt.step()) {
              const resultRow: any[] = []
              for (let i = 0; i < stmt.columnCount; i++) {
                resultRow.push(stmt.get(i))
              }
              row = resultRow
              log(`[worker] Got single row: ${JSON.stringify(row)}`)
            }
          } else {
            log(`[worker] DDL/DML query, executing once`)
            stmt.step()
          }

          stmt.finalize()
          log(`[worker] Single-row query completed successfully`)

          self.postMessage({
            type: 'exec-finished',
            payload: { id: payload.id, rows: row, columns },
          })
        } catch (e: any) {
          log(`[worker] Single-row query failed: ${e.message}`)
          self.postMessage({
            type: 'exec-error',
            payload: { id: payload.id, error: e.message },
          })
        }
        break
      }

      /* legacy exec for backward compatibility */
      case 'exec': {
        // Route to exec-all for backward compatibility
        msg.data.type = 'exec-all'
        self.onmessage?.(msg)
        break
      }
    }
  } catch (e) {
    error('Error in worker', e)
  }
}

/* ---------- bootstrap ---------- */
const init = async (filename?: string) => {
  log('Loading and initializing SQLite3 module.')
  const sqlite3 = await import('@sqlite.org/sqlite-wasm').then((m) =>
    m.default({ print: log, printErr: error }),
  )
  log('Done initializing. Starting DB…')
  const db = await start(sqlite3, filename)
  log('DB started.')
  return { sqlite3, db }
}

/* ---------- open DB (sync → async fallback) ---------- */
const start = async (sqlite3: any, filename?: string) => {
  const file = filename || '/mydb.sqlite3'
  log('Running SQLite3', sqlite3.version.libVersion)
  try {
    if ('opfs' in sqlite3) {
      try {
        // fast, sync VFS
        return new sqlite3.oo1.OpfsDb(file, 'ct', 'opfs')
      } catch (e) {
        log('Sync OPFS failed, using opfs‑async:', (e as any).message)
        // avoids “database is locked” when AccessHandle already open
        return new sqlite3.oo1.OpfsDb(file, 'ct', 'opfs-async')
      }
    }
    // fallback: in‑memory / tmpfile
    return new sqlite3.oo1.DB(file, 'ct')
  } catch (e) {
    error('Error opening database:', (e as any).message, (e as any).stack)
    throw e
  }
}
