import { loadConfig } from './config.mjs';
import { listLocations, listVariants } from './shopify.mjs';
import { compareCatalogs } from './compare.mjs';
import { loadExcludedSkus } from './exclusions.mjs';

try {
  const config = loadConfig({ requireLocations: false });
  const [mainLocations, childLocations] = await Promise.all([
    listLocations(config.shops.main), listLocations(config.shops.child)
  ]);
  const childLocation = childLocations.length === 1 ? childLocations[0] : null;
  const childVariants = childLocation
    ? await listVariants(config.shops.child, childLocation.id) : null;
  const excludedSkus = loadExcludedSkus();
  const main = [];
  for (const location of mainLocations) {
    const variants = await listVariants(config.shops.main, location.id);
    const stocked = variants.filter(v => Number.isInteger(v.quantity));
    const comparison = childVariants ? compareCatalogs(variants, childVariants, excludedSkus) : null;
    main.push({ location, variants: variants.length, stockedVariants: stocked.length,
      positiveStockVariants: stocked.filter(v => v.quantity > 0).length,
      totalAvailableUnits: stocked.reduce((sum, v) => sum + v.quantity, 0),
      comparisonCounts: comparison?.summary.counts ?? null });
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), main,
    child: { locations: childLocations,
      variants: childVariants?.length ?? null,
      stockedVariants: childVariants?.filter(v => Number.isInteger(v.quantity)).length ?? null }
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
