// SQLite-backed Durable Object state. All methods are synchronous so the sync
// engine can use the same queue interface as the local Node implementation.
export function openCloudState(storage) {
  const sql = storage.sql;
  for (const statement of [
    `CREATE TABLE IF NOT EXISTS skus (
      sku TEXT PRIMARY KEY, main_item TEXT NOT NULL, child_item TEXT NOT NULL,
      shared_qty INTEGER NOT NULL, main_qty INTEGER NOT NULL, child_qty INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL, created_at TEXT NOT NULL, done_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS writes (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL, side TEXT NOT NULL,
      from_qty INTEGER NOT NULL, to_qty INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT)`,
    `CREATE TABLE IF NOT EXISTS prepared (
      sku TEXT PRIMARY KEY, main_item TEXT NOT NULL, child_item TEXT NOT NULL,
      main_qty INTEGER NOT NULL, child_qty INTEGER NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS discovery_meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS observed_main_skus (
      sku TEXT PRIMARY KEY, is_new INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS discovered_skus (
      sku TEXT PRIMARY KEY, main_item TEXT NOT NULL, child_item TEXT NOT NULL,
      main_qty INTEGER NOT NULL, child_qty INTEGER NOT NULL, discovered_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL,
      type TEXT NOT NULL, sku TEXT, side TEXT, from_qty INTEGER, to_qty INTEGER,
      message TEXT)`,
    `CREATE TABLE IF NOT EXISTS operations (
      key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(done_at, created_at)',
    'CREATE INDEX IF NOT EXISTS writes_pending ON writes(next_at)',
    'CREATE INDEX IF NOT EXISTS activity_recent ON activity(id DESC)'
  ]) sql.exec(statement);

  const one = (query, ...args) => sql.exec(query, ...args).toArray()[0] ?? null;
  const all = (query, ...args) => sql.exec(query, ...args).toArray();
  const transact = fn => storage.transactionSync(fn);

  return {
    getSku: sku => one('SELECT * FROM skus WHERE sku = ?', sku),
    allSkus: () => all('SELECT * FROM skus ORDER BY sku'),
    skuCount: () => one('SELECT COUNT(*) AS count FROM skus').count,
    findSkuByItem: (side, id) => one(
      `SELECT sku FROM skus WHERE ${side === 'main' ? 'main_item' : 'child_item'} = ?`, id)?.sku,
    seed(sku, mainItem, childItem, qty) {
      if (one('SELECT 1 AS found FROM skus WHERE sku = ?', sku)) return false;
      sql.exec(`INSERT INTO skus (sku, main_item, child_item, shared_qty, main_qty, child_qty)
        VALUES (?, ?, ?, ?, ?, ?)`, sku, mainItem, childItem, qty, qty, qty);
      sql.exec('DELETE FROM prepared WHERE sku = ?', sku);
      sql.exec('DELETE FROM discovered_skus WHERE sku = ?', sku);
      return true;
    },
    enqueue(id, sku) {
      if (one('SELECT 1 AS found FROM jobs WHERE id = ?', id)) return false;
      sql.exec('INSERT INTO jobs (id, sku, created_at) VALUES (?, ?, ?)',
        id, sku, new Date().toISOString());
      return true;
    },
    nextWrite: () => one('SELECT * FROM writes WHERE next_at <= ? ORDER BY rowid LIMIT 1', Date.now()),
    nextWriteAt: () => one('SELECT MIN(next_at) AS next_at FROM writes')?.next_at ?? null,
    nextJob: () => one(`SELECT jobs.* FROM jobs WHERE done_at IS NULL AND NOT EXISTS
      (SELECT 1 FROM writes WHERE writes.sku = jobs.sku) ORDER BY created_at LIMIT 1`),
    hasWrite: sku => Boolean(one('SELECT 1 AS found FROM writes WHERE sku = ? LIMIT 1', sku)),
    markJobDone: id => sql.exec('UPDATE jobs SET done_at = ? WHERE id = ?', new Date().toISOString(), id),
    plan(sku, snapshot, target, writes) {
      transact(() => {
        sql.exec('UPDATE skus SET shared_qty = ?, main_qty = ?, child_qty = ? WHERE sku = ?',
          target, snapshot.main, snapshot.child, sku);
        for (const write of writes) sql.exec(
          'INSERT INTO writes (id, sku, side, from_qty, to_qty) VALUES (?, ?, ?, ?, ?)',
          write.id, sku, write.side, write.from, write.to);
      });
    },
    completeWrite(write) {
      transact(() => {
        sql.exec(`UPDATE skus SET ${write.side === 'main' ? 'main_qty' : 'child_qty'} = ? WHERE sku = ?`,
          write.to_qty, write.sku);
        sql.exec('DELETE FROM writes WHERE id = ?', write.id);
      });
    },
    cancelWrites: sku => sql.exec('DELETE FROM writes WHERE sku = ?', sku),
    retryWrite(id, error, attempts) {
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
      sql.exec('UPDATE writes SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?',
        attempts, Date.now() + delay, String(error).slice(0, 500), id);
    },
    pruneJobs() {
      sql.exec('DELETE FROM jobs WHERE done_at IS NOT NULL AND done_at < ?',
        new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString());
    },
    replacePrepared(rows) {
      const now = new Date().toISOString();
      transact(() => {
        sql.exec('DELETE FROM prepared');
        for (const row of rows) sql.exec(`INSERT INTO prepared
          (sku, main_item, child_item, main_qty, child_qty, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`, row.sku, row.mainItem, row.childItem,
          row.mainQuantity, row.childQuantity, now);
      });
      return now;
    },
    getPrepared: sku => one('SELECT * FROM prepared WHERE sku = ?', sku),
    listPrepared: () => all('SELECT * FROM prepared ORDER BY sku'),
    preparedCount: () => one('SELECT COUNT(*) AS count FROM prepared').count,
    discoveryStatus: () => ({
      baselineAt: one("SELECT value FROM discovery_meta WHERE key = 'baseline_at'")?.value ?? null,
      lastScanAt: one("SELECT value FROM discovery_meta WHERE key = 'last_scan_at'")?.value ?? null,
      newMainSkus: one('SELECT COUNT(*) AS count FROM observed_main_skus WHERE is_new = 1').count,
      candidates: all('SELECT * FROM discovered_skus ORDER BY sku')
    }),
    recordDiscovery(mainSkus, candidates) {
      const now = new Date().toISOString();
      let baselineCreated = false;
      transact(() => {
        const baseline = one("SELECT value FROM discovery_meta WHERE key = 'baseline_at'");
        baselineCreated = !baseline;
        if (baselineCreated) sql.exec(
          "INSERT INTO discovery_meta (key, value) VALUES ('baseline_at', ?)", now);
        for (const sku of mainSkus) sql.exec(
          'INSERT OR IGNORE INTO observed_main_skus (sku, is_new) VALUES (?, ?)',
          sku, baselineCreated ? 0 : 1);
        sql.exec('DELETE FROM discovered_skus');
        for (const row of candidates) sql.exec(`INSERT INTO discovered_skus
          (sku, main_item, child_item, main_qty, child_qty, discovered_at)
          VALUES (?, ?, ?, ?, ?, ?)`, row.sku, row.mainItem, row.childItem,
          row.mainQuantity, row.childQuantity, now);
        sql.exec("INSERT OR REPLACE INTO discovery_meta (key, value) VALUES ('last_scan_at', ?)", now);
      });
      return baselineCreated;
    },
    newMainSkus: () => new Set(all(
      'SELECT sku FROM observed_main_skus WHERE is_new = 1').map(row => row.sku)),
    observedMainSkus: () => new Set(all('SELECT sku FROM observed_main_skus').map(row => row.sku)),
    removeDiscovered: sku => sql.exec('DELETE FROM discovered_skus WHERE sku = ?', sku),
    pendingCount: () => one('SELECT COUNT(*) AS count FROM jobs WHERE done_at IS NULL').count,
    writeCount: () => one('SELECT COUNT(*) AS count FROM writes').count,
    pendingWrites: () => all(`SELECT sku, side, from_qty, to_qty, attempts, next_at, last_error
      FROM writes ORDER BY next_at LIMIT 100`),
    appendActivity(event) {
      const level = ['info', 'warning', 'error'].includes(event.level) ? event.level : 'info';
      sql.exec(`INSERT INTO activity (at, level, type, sku, side, from_qty, to_qty, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, new Date().toISOString(), level,
        String(event.type ?? 'event').slice(0, 60), event.sku ?? null, event.side ?? null,
        Number.isInteger(event.from) ? event.from : null,
        Number.isInteger(event.to) ? event.to : null,
        String(event.message ?? '').slice(0, 500));
      sql.exec('DELETE FROM activity WHERE id <= (SELECT MAX(id) - 5000 FROM activity)');
      sql.exec('DELETE FROM activity WHERE at < ?',
        new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString());
    },
    recentActivity: (limit = 100) => all('SELECT * FROM activity ORDER BY id DESC LIMIT ?', limit),
    recentProblems: (limit = 50) => all(`SELECT * FROM activity WHERE level IN ('warning', 'error')
      ORDER BY id DESC LIMIT ?`, limit),
    isPaused: () => one("SELECT value FROM operations WHERE key = 'operator_paused'")?.value !== 'false',
    setPaused: paused => sql.exec(`INSERT OR REPLACE INTO operations (key, value)
      VALUES ('operator_paused', ?)`, paused ? 'true' : 'false'),
    reconcileRequested: () => one("SELECT value FROM operations WHERE key = 'reconcile_requested'")?.value === 'true',
    requestReconcile: () => sql.exec(`INSERT OR REPLACE INTO operations (key, value)
      VALUES ('reconcile_requested', 'true')`),
    clearReconcileRequest: () => sql.exec("DELETE FROM operations WHERE key = 'reconcile_requested'"),
    markCompletedScan: () => sql.exec(`INSERT OR REPLACE INTO operations (key, value)
      VALUES ('last_completed_scan', ?)`, new Date().toISOString()),
    lastCompletedScan: () => one(`SELECT value FROM operations
      WHERE key = 'last_completed_scan'`)?.value ?? null
  };
}
