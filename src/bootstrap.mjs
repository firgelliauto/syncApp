import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { listVariants, getQuantity, setQuantity } from './shopify.mjs';
import { buildBootstrapPlan } from './bootstrap-plan.mjs';
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
    const { report, candidates } = buildBootstrapPlan(mainVariants, childVariants,
      { excludedSkus: loadExcludedSkus(), selectedSkus, isInitialized: sku => Boolean(state.getSku(sku)) });
    report.mode = apply ? 'apply' : 'dry_run';
    for (const candidate of candidates) {
      const { sku, mainItem, childItem, mainQuantity, childQuantity } = candidate;
      if (!apply) continue;
      try {
        // Recheck the primary stock immediately before setting the branch.
        const freshMain = await getQuantity(config.shops.main, mainItem, config.locations.main, sku);
        if (freshMain !== mainQuantity) throw new Error('main quantity changed since audit; rerun bootstrap');
        if (mainQuantity !== childQuantity) {
          await setQuantity(config.shops.child, { inventoryItemId: childItem,
            locationId: config.locations.child, from: childQuantity, to: mainQuantity, key: randomUUID() });
          report.changed++;
        }
        if (state.seed(sku, mainItem, childItem, mainQuantity)) report.seeded++;
      } catch (error) {
        report.errors.push({ sku, message: error.message });
      }
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
  } finally { state.close(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
