const API_VERSION = '2026-07';

export function createShop({ shop, clientId, clientSecret }) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop ?? '')) {
    throw new Error(`Invalid myshopify.com admin domain: ${shop || '(missing)'}`);
  }
  if (!clientId || !clientSecret) throw new Error(`Missing client credentials for ${shop}`);

  let token;
  let expiresAt = 0;
  async function getToken() {
    if (token && Date.now() < expiresAt - 60_000) return token;
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret })
    });
    if (!response.ok) throw new Error(`${shop}: token request failed (${response.status})`);
    const data = await response.json();
    if (!data.access_token) throw new Error(`${shop}: token response omitted access_token`);
    token = data.access_token;
    expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return token;
  }

  async function graphql(query, variables = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          'X-Shopify-Access-Token': await getToken() },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000)
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error(`${shop}: GraphQL HTTP ${response.status}`);
      const result = await response.json();
      if (result.errors?.length) {
        if (attempt < 3 && result.errors.some(e => e.extensions?.code === 'THROTTLED')) {
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(`${shop}: ${result.errors.map(e => e.message).join('; ')}`);
      }
      return result.data;
    }
  }

  return { shop, graphql };
}

export async function listLocations(client) {
  let data;
  try {
    data = await client.graphql(`query Locations { locations(first: 100) {
      nodes { id name isActive } pageInfo { hasNextPage } } }`);
  } catch (error) {
    if (!error.message.includes('read_locations')) throw error;
    data = await client.graphql(`query Locations { locations(first: 100) {
      nodes { id } pageInfo { hasNextPage } } }`);
  }
  if (data.locations.pageInfo.hasNextPage) throw new Error(`${client.shop}: more than 100 locations; pagination needed`);
  return data.locations.nodes;
}

export async function listVariants(client, locationId) {
  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(locationId ?? '')) {
    throw new Error(`${client.shop}: choose a Location GID first`);
  }
  const query = `query Variants($after: String, $location: ID!) {
    productVariants(first: 25, after: $after) {
      nodes { id sku inventoryPolicy inventoryItem { id tracked requiresShipping
        inventoryLevel(locationId: $location) { quantities(names: ["available"]) { name quantity } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const variants = [];
  let after = null;
  do {
    const data = await client.graphql(query, { after, location: locationId });
    const connection = data.productVariants;
    for (const node of connection.nodes) {
      const quantity = node.inventoryItem.inventoryLevel?.quantities
        ?.find(item => item.name === 'available')?.quantity ?? null;
      variants.push({ id: node.id, sku: node.sku, inventoryItemId: node.inventoryItem.id,
        tracked: node.inventoryItem.tracked, requiresShipping: node.inventoryItem.requiresShipping,
        inventoryPolicy: node.inventoryPolicy, quantity });
    }
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error(`${client.shop}: pagination cursor missing`);
  } while (true);
  return variants;
}

export async function getQuantity(client, inventoryItemId, locationId, expectedSku) {
  const data = await client.graphql(`query Quantity($item: ID!, $location: ID!) {
    inventoryItem(id: $item) { sku tracked inventoryLevel(locationId: $location) {
      quantities(names: ["available"]) { name quantity } } }
  }`, { item: inventoryItemId, location: locationId });
  const item = data.inventoryItem;
  if (expectedSku && item?.sku !== expectedSku) {
    throw new Error(`${client.shop}: inventory item SKU changed from ${expectedSku} to ${item?.sku ?? '(missing)'}`);
  }
  if (expectedSku && !item?.tracked) throw new Error(`${client.shop}: inventory tracking disabled for ${expectedSku}`);
  return item?.inventoryLevel?.quantities?.find(q => q.name === 'available')?.quantity ?? null;
}

export async function setQuantity(client, { inventoryItemId, locationId, from, to, key }) {
  if (process.env.ALLOW_INVENTORY_WRITES !== 'true') {
    throw new Error('Inventory writes are disabled; ALLOW_INVENTORY_WRITES must be true');
  }
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('Inventory quantities must be integers');
  const data = await client.graphql(`mutation SetQuantity($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) {
      userErrors { code field message }
      inventoryAdjustmentGroup { createdAt }
    }
  }`, { key, input: { name: 'available', reason: 'correction',
    referenceDocumentUri: `syncapp://inventory/${key}`,
    quantities: [{ inventoryItemId, locationId, quantity: to, changeFromQuantity: from }] } });
  const result = data.inventorySetQuantities;
  if (result.userErrors?.length) {
    const error = new Error(`${client.shop}: ${result.userErrors.map(e => `${e.code}: ${e.message}`).join('; ')}`);
    error.codes = result.userErrors.map(e => e.code);
    throw error;
  }
  if (!result.inventoryAdjustmentGroup) throw new Error(`${client.shop}: inventory write was not confirmed`);
}
