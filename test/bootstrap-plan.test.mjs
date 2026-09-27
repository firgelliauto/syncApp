import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBootstrapPlan } from '../src/bootstrap-plan.mjs';
import { loadExcludedSkus } from '../src/exclusions.mjs';

const variant = (sku, quantity, item) => ({ sku, quantity, inventoryItemId: item,
  tracked: true, requiresShipping: true, inventoryPolicy: 'DENY' });

test('initial plan includes only unique shared physical SKUs and excludes Handling Fee', () => {
  const main = [variant('RC-170', 22, 'main-rc'), variant('ONLY-MAIN', 8, 'main-only'),
    variant('Handling Fee', 10, 'main-fee'), variant('DUP', 2, 'main-dup-a'),
    variant('DUP', 2, 'main-dup-b')];
  const child = [variant('RC-170', 24, 'child-rc'), variant('Handling Fee', 20, 'child-fee'),
    variant('ONLY-CHILD', 7, 'child-only'), variant('DUP', 2, 'child-dup')];
  const { report, candidates } = buildBootstrapPlan(main, child,
    { excludedSkus: loadExcludedSkus() });
  assert.deepEqual(candidates, [{ sku: 'RC-170', mainItem: 'main-rc', childItem: 'child-rc',
    mainQuantity: 22, childQuantity: 24 }]);
  assert.deepEqual(report.changes, [{ sku: 'RC-170', mainQuantity: 22, childQuantity: 24 }]);
  assert.equal(report.eligible, 1);
  assert.ok(report.skipped.some(row => row.sku === 'ONLY-MAIN'));
  assert.ok(report.skipped.some(row => row.sku === 'Handling Fee' && row.reason === 'excluded_sku'));
  assert.ok(report.skipped.some(row => row.sku === 'DUP' && row.reason === 'duplicate_main_sku'));
});
