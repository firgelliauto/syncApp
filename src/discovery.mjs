import { buildBootstrapPlan } from './bootstrap-plan.mjs';

export function buildDiscoveryPlan(main, child, {
  baselineAt, observedMainSkus, newMainSkus, excludedSkus, isInitialized
}) {
  const mainSkus = new Set(main.map(row => row.sku).filter(sku => typeof sku === 'string' && sku));
  const newSkus = new Set(newMainSkus);
  if (baselineAt) {
    for (const sku of mainSkus) if (!observedMainSkus.has(sku)) newSkus.add(sku);
  }
  if (!newSkus.size) return { mainSkus, candidates: [], skipped: [] };
  const { report, candidates } = buildBootstrapPlan(main, child, {
    selectedSkus: newSkus, excludedSkus, isInitialized
  });
  return { mainSkus, candidates, skipped: report.skipped };
}
