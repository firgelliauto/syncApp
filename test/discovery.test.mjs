import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoveryPlan } from '../src/discovery.mjs';

const variant = (sku, quantity, item = sku) => ({ sku, quantity,
  inventoryItemId: item, tracked: true, requiresShipping: true,
  inventoryPolicy: 'DENY' });

test('first discovery scan records the existing main catalog as a baseline', () => {
  const result = buildDiscoveryPlan([variant('EXISTING', 4)], [variant('EXISTING', 2)], {
    baselineAt: null, observedMainSkus: new Set(), newMainSkus: new Set(),
    excludedSkus: new Set(), isInitialized: () => false
  });
  assert.deepEqual([...result.mainSkus], ['EXISTING']);
  assert.deepEqual(result.candidates, []);
});

test('later scans discover only new matching eligible main SKUs', () => {
  const options = { baselineAt: '2026-09-27T00:00:00Z',
    observedMainSkus: new Set(['EXISTING', 'WAITING']),
    newMainSkus: new Set(['WAITING']), excludedSkus: new Set(['Handling Fee']),
    isInitialized: () => false };
  const main = [variant('EXISTING', 4), variant('WAITING', 6),
    variant('NEW', 9), variant('Handling Fee', 1)];
  const child = [variant('EXISTING', 2), variant('WAITING', 1),
    variant('NEW', 3), variant('Handling Fee', 1)];
  const result = buildDiscoveryPlan(main, child, options);
  assert.deepEqual(result.candidates.map(row => row.sku), ['WAITING', 'NEW']);
});

test('new main SKU stays pending until it exists in the child catalog', () => {
  const options = { baselineAt: '2026-09-27T00:00:00Z',
    observedMainSkus: new Set(['NEW']), newMainSkus: new Set(['NEW']),
    excludedSkus: new Set(), isInitialized: () => false };
  assert.deepEqual(buildDiscoveryPlan([variant('NEW', 5)], [], options).candidates, []);
  assert.equal(buildDiscoveryPlan([variant('NEW', 5)], [variant('NEW', 0)], options)
    .candidates[0].mainQuantity, 5);
});
