import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openState(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS skus (
      sku TEXT PRIMARY KEY, main_item TEXT NOT NULL, child_item TEXT NOT NULL,
      shared_qty INTEGER NOT NULL, main_qty INTEGER NOT NULL, child_qty INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL, created_at TEXT NOT NULL,
      done_at TEXT
    );
    CREATE TABLE IF NOT EXISTS writes (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL, side TEXT NOT NULL,
      from_qty INTEGER NOT NULL, to_qty INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(done_at, created_at);
    CREATE INDEX IF NOT EXISTS writes_pending ON writes(next_at);
  `);

  const getSku = db.prepare('SELECT * FROM skus WHERE sku = ?');
  const seed = db.prepare(`INSERT OR IGNORE INTO skus
    (sku, main_item, child_item, shared_qty, main_qty, child_qty) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertJob = db.prepare('INSERT OR IGNORE INTO jobs (id, sku, created_at) VALUES (?, ?, ?)');
  const pendingWrite = db.prepare('SELECT * FROM writes WHERE sku = ? LIMIT 1');
  const nextWrite = db.prepare('SELECT * FROM writes WHERE next_at <= ? ORDER BY rowid LIMIT 1');
  const nextJob = db.prepare(`SELECT jobs.* FROM jobs WHERE done_at IS NULL AND NOT EXISTS
    (SELECT 1 FROM writes WHERE writes.sku = jobs.sku) ORDER BY created_at LIMIT 1`);

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  return {
    db,
    close: () => db.close(),
    getSku: sku => getSku.get(sku),
    allSkus: () => db.prepare('SELECT * FROM skus ORDER BY sku').all(),
    findSkuByItem: (side, id) => db.prepare(`SELECT sku FROM skus WHERE ${side === 'main' ? 'main_item' : 'child_item'} = ?`).get(id)?.sku,
    seed: (sku, mainItem, childItem, qty) => seed.run(sku, mainItem, childItem, qty, qty, qty).changes > 0,
    enqueue: (id, sku) => insertJob.run(id, sku, new Date().toISOString()).changes > 0,
    nextWrite: () => nextWrite.get(Date.now()),
    nextJob: () => nextJob.get(),
    hasWrite: sku => Boolean(pendingWrite.get(sku)),
    markJobDone: id => db.prepare('UPDATE jobs SET done_at = ? WHERE id = ?').run(new Date().toISOString(), id),
    plan(sku, snapshot, target, writes) {
      transaction(() => {
        db.prepare('UPDATE skus SET shared_qty = ?, main_qty = ?, child_qty = ? WHERE sku = ?')
          .run(target, snapshot.main, snapshot.child, sku);
        for (const write of writes) {
          db.prepare('INSERT INTO writes (id, sku, side, from_qty, to_qty) VALUES (?, ?, ?, ?, ?)')
            .run(write.id, sku, write.side, write.from, write.to);
        }
      });
    },
    completeWrite(write) {
      transaction(() => {
        db.prepare(`UPDATE skus SET ${write.side === 'main' ? 'main_qty' : 'child_qty'} = ? WHERE sku = ?`)
          .run(write.to_qty, write.sku);
        db.prepare('DELETE FROM writes WHERE id = ?').run(write.id);
      });
    },
    cancelWrites(sku) { db.prepare('DELETE FROM writes WHERE sku = ?').run(sku); },
    retryWrite(id, error, attempts) {
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
      db.prepare('UPDATE writes SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?')
        .run(attempts, Date.now() + delay, String(error).slice(0, 500), id);
    },
    pruneJobs() {
      db.prepare('DELETE FROM jobs WHERE done_at IS NOT NULL AND done_at < ?')
        .run(new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString());
    }
  };
}
