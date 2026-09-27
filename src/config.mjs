import { createShop } from './shopify.mjs';

export function loadConfig({ requireLocations = true } = {}) {
  const main = createShop({ shop: process.env.MAIN_SHOP, clientId: process.env.MAIN_CLIENT_ID,
    clientSecret: process.env.MAIN_CLIENT_SECRET });
  const child = createShop({ shop: process.env.CHILD_SHOP, clientId: process.env.CHILD_CLIENT_ID,
    clientSecret: process.env.CHILD_CLIENT_SECRET });
  const locations = { main: process.env.MAIN_LOCATION_ID, child: process.env.CHILD_LOCATION_ID };
  if (requireLocations) {
    for (const [side, id] of Object.entries(locations)) {
      if (!/^gid:\/\/shopify\/Location\/\d+$/.test(id ?? '')) {
        throw new Error(`Set ${side.toUpperCase()}_LOCATION_ID to a Shopify Location GID`);
      }
    }
  }
  return { shops: { main, child }, locations,
    secrets: { main: process.env.MAIN_CLIENT_SECRET, child: process.env.CHILD_CLIENT_SECRET },
    dbPath: process.env.STATE_DB || './data/inventory-sync.sqlite' };
}
