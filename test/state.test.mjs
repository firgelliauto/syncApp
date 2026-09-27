import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { openState } from '../src/state.mjs';

test('initialized stock and queued webhook survive a process restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'firgelli-sync-'));
  const path = join(dir, 'state.sqlite');
  try {
    let state = openState(path);
    state.seed('SKU', 'main-item', 'child-item', 7);
    assert.equal(state.enqueue('delivery-1', 'SKU'), true);
    assert.equal(state.enqueue('delivery-1', 'SKU'), false);
    state.close();
    state = openState(path);
    assert.equal(state.getSku('SKU').shared_qty, 7);
    assert.equal(state.nextJob().id, 'delivery-1');
    state.close();
  } finally {
    const actual = realpathSync(dir);
    const tempRoot = realpathSync(tmpdir());
    if (!actual.startsWith(tempRoot + sep) || !actual.split(sep).at(-1).startsWith('firgelli-sync-')) {
      throw new Error('Refusing to remove a path outside the test directory');
    }
    rmSync(actual, { recursive: true, force: true });
  }
});
