import { indexVariants } from './compare.mjs';

export function buildBootstrapPlan(mainVariants, childVariants, {
  excludedSkus = new Set(), selectedSkus = new Set(), isInitialized = () => false
} = {}) {
  const main = indexVariants(mainVariants);
  const child = indexVariants(childVariants);
  const report = { mode: 'dry_run', selectedSkus: selectedSkus.size ? [...selectedSkus] : null,
    eligible: 0, seeded: 0, changed: 0, skipped: [], errors: [], changes: [] };
  const candidates = [];
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
    if (isInitialized(sku)) { report.skipped.push({ sku, reason: 'already_initialized' }); continue; }
    report.eligible++;
    if (a.quantity !== b.quantity) report.changes.push({ sku, mainQuantity: a.quantity,
      childQuantity: b.quantity });
    candidates.push({ sku, mainItem: a.inventoryItemId, childItem: b.inventoryItemId,
      mainQuantity: a.quantity, childQuantity: b.quantity });
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
  return { report, candidates };
}
