import { log, error } from './utils'

self.onmessage = async (msg) => {
  try {
    const { type, payload } = msg.data
    switch (type) {
      case 'init': {
        const { sqlite3, db } = await init()
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
      default: {
        // Do nothing
      }
    }
  } catch (e) {
    error('Error in worker', e)
  }
}

const init = async () => {
  log('Loading and initializing SQLite3 module...')
  const sqlite3 = await import('@sqlite.org/sqlite-wasm').then((m) =>
    m.default({
      print: log,
      printErr: error,
    }),
  )
  log('Done initializing. Starting DB...')
  const db = await start(sqlite3)
  log('DB started.')
  self.onmessage = (msg) => {
    const { type, payload } = msg.data
    switch (type) {
      case 'exec': {
        try {
          const result = db.exec(payload.sql, {
            bind: payload.params,
            returnValue: 'resultRows',
            rowMode: 'array',
          })
          self.postMessage({
            type: 'exec-finished',
            payload: {
              id: payload.id,
              rows: result,
            },
          })
        } catch (e: any) {
          // Send error back to main thread
          self.postMessage({
            type: 'exec-error',
            payload: {
              id: payload.id,
              error: e.message,
            },
          })
        }
        break
      }
      default: {
        // Do nothing
      }
    }
  }
  return { sqlite3, db }
}

const start = async (sqlite3: any) => {
  log('Running SQLite3 version', sqlite3.version.libVersion)
  let db: any
  try {
    log('Opening database...')
    db =
      'opfs' in sqlite3
        ? new sqlite3.oo1.OpfsDb('/mydb.sqlite3')
        : new sqlite3.oo1.DB('/mydb.sqlite3', 'ct')
    log(
      'opfs' in sqlite3
        ? `OPFS is available, created persisted database at ${db.filename}`
        : `OPFS is not available, created transient database ${db.filename}`,
    )
    return db
  } catch (e: any) {
    error('Error opening database:', e.message, e.stack)
    if (db) {
      db.close()
    }
    throw e
  }
}
