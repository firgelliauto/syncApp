import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openCloudState } from '../src/cloud-state.mjs';

function cloudState(db = new DatabaseSync(':memory:')) {
  const storage = {
    sql: { exec(statement, ...args) {
      const rows = /^\s*(SELECT|PRAGMA)\b/i.test(statement) ? db.prepare(statement).all(...args) :
        (args.length ? db.prepare(statement).run(...args) : db.exec(statement), []);
      return { toArray: () => rows };
    } },
    transactionSync(fn) {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  return { state: openCloudState(storage), db };
}

test('staging records the main baseline and queues differences without inventory writes', () => {
  const { state, db } = cloudState();
  try {
    state.seed('PILOT', 'main-pilot', 'child-pilot', 9);
    const planId = state.replacePrepared([
      { sku: 'EQUAL', mainItem: 'main-equal', childItem: 'child-equal',
        mainQuantity: 4, childQuantity: 4 },
      { sku: 'DIFFERENT', mainItem: 'main-diff', childItem: 'child-diff',
        mainQuantity: 13, childQuantity: 15 }
    ]);
    assert.throws(() => state.stagePrepared('wrong-plan'), /Prepared plan changed/);
    assert.equal(state.skuCount(), 1);
    const result = state.stagePrepared(planId);
    assert.equal(result.stagedSkus, 2);
    assert.equal(result.initialChanges, 1);
    assert.equal(state.skuCount(), 3);
    assert.equal(state.pendingCount(), 1);
    assert.equal(state.writeCount(), 0);
    assert.equal(state.preparedCount(), 2);
    assert.deepEqual({ ...state.getSku('DIFFERENT') }, {
      sku: 'DIFFERENT', main_item: 'main-diff', child_item: 'child-diff',
      shared_qty: 13, main_qty: 13, child_qty: 15
    });
    assert.equal(state.initialStagedAt(), result.stagedAt);
    state.blockSku('DIFFERENT', 10, 12, 'Both stores changed');
    assert.equal(state.blockedCount(), 1);
    assert.equal(state.getBlock('DIFFERENT').reason, 'Both stores changed');
    state.approveConflict('DIFFERENT', 10, 12);
    assert.equal(state.blockedCount(), 0);
    assert.equal(state.isApprovedConflict('DIFFERENT', 10, 12), true);
    assert.equal(state.isApprovedConflict('DIFFERENT', 9, 12), false);
    state.plan('DIFFERENT', { main: 10, child: 12 }, 9, []);
    assert.equal(state.isApprovedConflict('DIFFERENT', 10, 12), false);
    state.enqueue('mirrored-webhook', 'DIFFERENT');
    state.blockSku('DIFFERENT', 8, 8, 'Both stores changed');
    state.approveConflict('DIFFERENT', 8, 8);
    state.rebaselineMirroredChange('DIFFERENT', 8);
    assert.deepEqual({ ...state.getSku('DIFFERENT') }, {
      sku: 'DIFFERENT', main_item: 'main-diff', child_item: 'child-diff',
      shared_qty: 8, main_qty: 8, child_qty: 8
    });
    assert.equal(state.pendingCount(), 0);
    assert.equal(state.isApprovedConflict('DIFFERENT', 8, 8), false);
    assert.throws(() => state.stagePrepared(planId), /already staged/);
  } finally { db.close(); }
});

test('fresh shadow baseline replaces stale jobs with current child differences', () => {
  const { state, db } = cloudState();
  try {
    state.seed('OLD', 'old-main', 'old-child', 433);
    state.enqueue('stale-event', 'OLD');
    const result = state.replaceBaseline([
      { sku: 'OLD', mainItem: 'old-main', childItem: 'old-child',
        mainQuantity: 430, childQuantity: 430 },
      { sku: 'DIFF', mainItem: 'diff-main', childItem: 'diff-child',
        mainQuantity: 12, childQuantity: 15 }
    ]);
    assert.equal(result.trackedSkus, 2);
    assert.equal(result.childDifferences, 1);
    assert.equal(state.pendingCount(), 1);
    assert.equal(state.pendingJobs()[0].sku, 'DIFF');
    assert.deepEqual({ ...state.getSku('OLD') }, {
      sku: 'OLD', main_item: 'old-main', child_item: 'old-child',
      shared_qty: 430, main_qty: 430, child_qty: 430
    });
    assert.equal(state.writeCount(), 0);
  } finally { db.close(); }
});

test('pending work is newest first and dismissed alerts stay in activity history', () => {
  const { state, db } = cloudState();
  try {
    state.seed('A', 'main-a', 'child-a', 5);
    state.seed('B', 'main-b', 'child-b', 5);
    state.enqueue('older', 'A');
    state.enqueue('newer', 'B');
    db.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', 'older');
    db.prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run('2026-01-02T00:00:00.000Z', 'newer');
    assert.deepEqual(state.pendingJobs().map(row => row.sku), ['B', 'A']);
    state.appendActivity({ level: 'error', type: 'scan_error', sku: 'A', message: 'Temporary failure' });
    const alert = state.recentProblems()[0];
    assert.equal(alert.sku, 'A');
    assert.equal(state.dismissProblem(alert.id), true);
    assert.deepEqual(state.recentProblems(), []);
    assert.equal(state.recentActivity()[0].id, alert.id);
    assert.throws(() => state.dismissProblem(9999), /Alert not found/);
  } finally { db.close(); }
});

test('existing pending writes gain a sortable timestamp without losing the queue', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE writes (id TEXT PRIMARY KEY, sku TEXT NOT NULL, side TEXT NOT NULL,
    from_qty INTEGER NOT NULL, to_qty INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT)`);
  db.prepare('INSERT INTO writes (id, sku, side, from_qty, to_qty) VALUES (?, ?, ?, ?, ?)')
    .run('old', 'A', 'child', 2, 1);
  const { state } = cloudState(db);
  try {
    assert.equal(state.pendingWrites()[0].sku, 'A');
    assert.equal(state.pendingWrites()[0].created_at, '');
  } finally { db.close(); }
});
