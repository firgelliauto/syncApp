import test from 'node:test';
import assert from 'node:assert/strict';
import { listVariants } from '../src/shopify.mjs';

test('catalog scan paginates in 250-variant pages to stay below Worker subrequest limits', async () => {
  const calls = [];
  const client = { shop: 'example.myshopify.com', async graphql(query, variables) {
    calls.push({ query, variables });
    const first = variables.after === null;
    return { productVariants: { nodes: first ? Array.from({ length: 250 }, (_, index) => ({
      id: `variant-${index}`, sku: `SKU-${index}`, inventoryPolicy: 'DENY',
      inventoryItem: { id: `item-${index}`, tracked: true, requiresShipping: true,
        inventoryLevel: { quantities: [{ name: 'available', quantity: index }] } }
    })) : [{ id: 'variant-250', sku: 'SKU-250', inventoryPolicy: 'DENY',
      inventoryItem: { id: 'item-250', tracked: true, requiresShipping: true,
        inventoryLevel: { quantities: [{ name: 'available', quantity: 250 }] } } }],
    pageInfo: { hasNextPage: first, endCursor: first ? 'next' : null } } };
  } };
  const rows = await listVariants(client, 'gid://shopify/Location/1');
  assert.equal(rows.length, 251);
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /productVariants\(first: 250/);
  assert.equal(calls[1].variables.after, 'next');
});
