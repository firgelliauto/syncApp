import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { listVariants, getQuantity, setQuantity } from './shopify.mjs';
import { indexVariants } from './compare.mjs';
import { openState } from './state.mjs';
import { loadExcludedSkus } from './exclusions.mjs';

try {
  const apply = process.argv.includes('--apply');
  if (process.argv.includes('--sku=')) throw new Error('An empty --sku is not allowed');
  const selectedSkus = new Set(process.argv.filter(arg => arg.startsWith('--sku='))
    .map(arg => arg.slice('--sku='.length)).filter(Boolean));
  if (apply && process.env.ALLOW_INVENTORY_WRITES !== 'true') {
    throw new Error('Bootstrap apply is disabled; ALLOW_INVENTORY_WRITES must be true');
  }
  if (apply && !selectedSkus.size && !process.argv.includes('--all')) {
    throw new Error('Bootstrap apply requires an exact --sku=... pilot or explicit --all');
  }
  const config = loadConfig();
  const state = openState(config.dbPath);
  try {
    const [mainVariants, childVariants] = await Promise.all([
      listVariants(config.shops.main, config.locations.main),
      listVariants(config.shops.child, config.locations.child)
    ]);
    const main = indexVariants(mainVariants);
    const child = indexVariants(childVariants);
    const excludedSkus = loadExcludedSkus();
    const report = { mode: apply ? 'apply' : 'dry_run',
      selectedSkus: selectedSkus.size ? [...selectedSkus] : null, eligible: 0, seeded: 0,
      changed: 0, skipped: [], errors: [], changes: [] };
    for (const [sku, a] of main.bySku) {
      if (selectedSkus.size && !selectedSkus.has(sku)) continue;
      if (excludedSkus.has(sku)) { report.skipped.push({ sku, reason: 'excluded_sku' }); continue; }
      const b = child.bySku.get(sku);
      if (!b) { report.skipped.push({ sku, reason: 'missing_or_duplicate_child_sku' }); continue; }
      if (!a.tracked || !b.tracked || !Number.isInteger(a.quantity) || !Number.isInteger(b.quantity)) {
        report.skipped.push({ sku, reason: 'untracked_or_missing_location' }); continue;
      }
      if (a.quantity < 0 || b.quantity < 0) {
        report.skipped.push({ sku, reason: 'negative_available' }); continue;
      }
      if (a.requiresShipping === false || b.requiresShipping === false) {
        report.skipped.push({ sku, reason: 'nonphysical_item' }); continue;
      }
      if (a.inventoryPolicy === 'CONTINUE' || b.inventoryPolicy === 'CONTINUE') {
        report.skipped.push({ sku, reason: 'continues_selling_when_out_of_stock' }); continue;
      }
      if (state.getSku(sku)) { report.skipped.push({ sku, reason: 'already_initialized' }); continue; }
      report.eligible++;
      if (a.quantity !== b.quantity) report.changes.push({ sku, mainQuantity: a.quantity,
        childQuantity: b.quantity });
      if (!apply) continue;
      try {
        // Recheck the primary stock immediately before setting the branch.
        const freshMain = await getQuantity(config.shops.main, a.inventoryItemId, config.locations.main, sku);
        if (freshMain !== a.quantity) throw new Error('main quantity changed since audit; rerun bootstrap');
        if (a.quantity !== b.quantity) {
          await setQuantity(config.shops.child, { inventoryItemId: b.inventoryItemId,
            locationId: config.locations.child, from: b.quantity, to: a.quantity, key: randomUUID() });
          report.changed++;
        }
        if (state.seed(sku, a.inventoryItemId, b.inventoryItemId, a.quantity)) report.seeded++;
      } catch (error) {
        report.errors.push({ sku, message: error.message });
      }
    }
    for (const sku of main.duplicates.keys()) {
      if (!selectedSkus.size || selectedSkus.has(sku)) report.skipped.push({ sku, reason: 'duplicate_main_sku' });
    }
    for (const sku of child.duplicates.keys()) {
      if (!selectedSkus.size || selectedSkus.has(sku)) report.skipped.push({ sku, reason: 'duplicate_child_sku' });
    }
    for (const sku of selectedSkus) {
      if (!main.bySku.has(sku) && !main.duplicates.has(sku)) {
        report.errors.push({ sku, message: 'SKU not found in main store' });
      }
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
  } finally { state.close(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
