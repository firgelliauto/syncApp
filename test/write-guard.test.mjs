import test from 'node:test';
import assert from 'node:assert/strict';
import { setQuantity } from '../src/shopify.mjs';

test('inventory writes are blocked unless explicitly enabled', async () => {
  const previous = process.env.ALLOW_INVENTORY_WRITES;
  delete process.env.ALLOW_INVENTORY_WRITES;
  try {
    await assert.rejects(setQuantity({ shop: 'example.myshopify.com' }, {
      inventoryItemId: 'gid://shopify/InventoryItem/1',
      locationId: 'gid://shopify/Location/1', from: 1, to: 0, key: 'test'
    }), /Inventory writes are disabled/);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_INVENTORY_WRITES;
    else process.env.ALLOW_INVENTORY_WRITES = previous;
  }
});
