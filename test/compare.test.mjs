import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCatalogs } from '../src/compare.mjs';

const variant = (sku, quantity, extra = {}) => ({ id: `id-${sku}-${quantity}`, sku,
  quantity, tracked: true, ...extra });

test('matches SKUs exactly and reports missing and unequal quantities', () => {
  const result = compareCatalogs([variant('A', 5), variant('B', 1)],
    [variant('A', 4), variant('b', 1)]);
  assert.deepEqual(result.rows.map(row => [row.sku, row.status]), [
    ['A', 'different_quantity'], ['B', 'only_main'], ['b', 'only_child']
  ]);
});

test('blocks duplicate, blank, untracked and missing location variants', () => {
  const result = compareCatalogs([
    variant('D', 2), variant('D', 3), variant('', 1),
    variant('U', 1, { tracked: false }), variant('L', null)
  ], [variant('D', 2), variant('U', 1), variant('L', 3)]);
  assert.equal(result.summary.mainBlankSkus, 1);
  assert.equal(result.summary.counts.duplicate_sku, 1);
  assert.equal(result.summary.counts.not_tracked, 1);
  assert.equal(result.summary.counts.not_stocked_at_location, 1);
});

test('does not silently normalize SKUs with whitespace', () => {
  const result = compareCatalogs([variant(' A', 2)], [variant('A', 2)]);
  assert.deepEqual(result.rows.map(row => row.status), ['only_main', 'only_child']);
});

test('flags variants allowed to keep selling after stock reaches zero', () => {
  const result = compareCatalogs([variant('A', 1, { inventoryPolicy: 'CONTINUE' })],
    [variant('A', 1)]);
  assert.equal(result.rows[0].status, 'continues_selling');
});

test('flags nonphysical service items even when they carry a SKU and quantity', () => {
  const result = compareCatalogs([variant('Handling Fee', 9035, { requiresShipping: false })],
    [variant('Handling Fee', 9038)]);
  assert.equal(result.rows[0].status, 'nonphysical_item');
});

test('excludes named service SKUs and negative available quantities', () => {
  const result = compareCatalogs([variant('Handling Fee', 9), variant('A', -1)],
    [variant('Handling Fee', 10), variant('A', -1)], new Set(['Handling Fee']));
  assert.deepEqual(result.rows.map(row => [row.sku, row.status]), [
    ['A', 'negative_available'], ['Handling Fee', 'excluded_sku']
  ]);
});
