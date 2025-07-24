import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

let sqlite3: any = null
let db: any = null

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

const init = async (filename?: string) => {
  const debug_logs: string[] = []
  debug_logs.push('Loading and initializing SQLite3 module.')
  const sqlite3Module = await sqlite3InitModule({
    print: (msg: string) => debug_logs.push(msg),
    printErr: (msg: string) => debug_logs.push(`ERROR: ${msg}`),
  })
  sqlite3 = sqlite3Module
  debug_logs.push(
    `[opfs-worker] Immediate check: self.crossOriginIsolated = ${self.crossOriginIsolated}`,
  )
  debug_logs.push(
    `[opfs-worker] sqlite3.oo1.OpfsDb is available = ${!!sqlite3Module.oo1.OpfsDb}`,
  )
  debug_logs.push('Done initializing. Starting DB…')
  db = await start(sqlite3Module, filename, debug_logs)
  db.exec(['PRAGMA journal_mode = TRUNCATE;', 'PRAGMA synchronous = FULL;'])
  debug_logs.push('DB started.')
  self.postMessage({ type: 'debug', payload: debug_logs })
  return {
    version: sqlite3.version.libVersion,
    filename: db.filename,
    opfs: !!sqlite3.oo1.OpfsDb,
  }
}

self.onmessage = async (msg: MessageEvent) => {
  const { type, payload } = msg.data
  try {
    switch (type) {
      case 'init': {
        const initPayload = await init(payload.filename)
        self.postMessage({ type: 'init-finished', payload: initPayload })
        break
      }
      case 'exec-all':
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
          if (payload.params?.length) {
            stmt.bind(payload.params)
          }
          const rows = []
          let columns = []
          if (stmt.columnCount > 0) {
            columns = stmt.getColumnNames()
            while (stmt.step()) {
              rows.push(stmt.get([]))
            }
          } else {
            stmt.step()
          }
          stmt.finalize()

          let finalRows: any = rows
          if (type === 'exec-get') {
            finalRows = rows.length > 0 ? rows[0] : null
          }

          self.postMessage({
            type: 'exec-finished',
            payload: { id: payload.id, rows: finalRows, columns },
          })
        } catch (e: any) {
          self.postMessage({
            type: 'exec-error',
            payload: { id: payload.id, error: e.message },
          })
        }
        break
      }
    }
  } catch (e: any) {
    self.postMessage({
      type: 'error',
      payload: { error: e.message },
    })
  }
}
