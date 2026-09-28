import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageSync, rolloutReady, syncActive } from '../src/sync-control.mjs';

const ready = { SYNC_ENABLED: 'true', ALLOW_INVENTORY_WRITES: 'true',
  FULL_ROLLOUT_COMPLETE: 'true', SYNC_CONTROL_USER_ID: 'approved' };

test('resuming never bypasses rollout, inventory-write, or pause gates', () => {
  assert.equal(rolloutReady(ready), true);
  assert.equal(syncActive(ready, true), false);
  assert.equal(syncActive(ready, false), true);
  for (const key of ['SYNC_ENABLED', 'ALLOW_INVENTORY_WRITES', 'FULL_ROLLOUT_COMPLETE']) {
    assert.equal(syncActive({ ...ready, [key]: 'false' }, false), false);
  }
});

test('only the approved main-store account can manage sync', () => {
  assert.equal(canManageSync({ side: 'main', userId: 'approved' }, ready), true);
  assert.equal(canManageSync({ side: 'child', userId: 'approved' }, ready), false);
  assert.equal(canManageSync({ side: 'main', userId: 'other' }, ready), false);
  assert.equal(canManageSync({ side: 'main', userId: 'approved' },
    { ...ready, SYNC_CONTROL_USER_ID: '' }), false);
});
