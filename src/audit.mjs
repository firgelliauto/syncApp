import { createShop, listLocations, listVariants } from './shopify.mjs';
import { compareCatalogs } from './compare.mjs';
import { loadExcludedSkus } from './exclusions.mjs';

try {
  const main = createShop({ shop: process.env.MAIN_SHOP, clientId: process.env.MAIN_CLIENT_ID,
    clientSecret: process.env.MAIN_CLIENT_SECRET });
  const child = createShop({ shop: process.env.CHILD_SHOP, clientId: process.env.CHILD_CLIENT_ID,
    clientSecret: process.env.CHILD_CLIENT_SECRET });
  const command = process.argv[2] ?? 'audit';
  if (command === 'locations') {
    const [a, b] = await Promise.all([listLocations(main), listLocations(child)]);
    console.log(JSON.stringify({ main: a, child: b }, null, 2));
  } else if (command === 'audit') {
    const [a, b] = await Promise.all([
      listVariants(main, process.env.MAIN_LOCATION_ID),
      listVariants(child, process.env.CHILD_LOCATION_ID)
    ]);
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(),
      mainShop: main.shop, childShop: child.shop,
      mainLocationId: process.env.MAIN_LOCATION_ID,
      childLocationId: process.env.CHILD_LOCATION_ID,
      ...compareCatalogs(a, b, loadExcludedSkus()) }, null, 2));
  } else {
    throw new Error('Use locations or audit');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
