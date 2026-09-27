import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, webhookSku } from '../src/webhook.mjs';
import { openState } from '../src/state.mjs';

test('webhook signature verifies only the original signed body', () => {
  const raw = Buffer.from('{"inventory_item_id":123,"available":9}');
  const signature = createHmac('sha256', 'secret').update(raw).digest('base64');
  assert.equal(verifyWebhook(raw, signature, 'secret'), true);
  assert.equal(verifyWebhook(Buffer.from(raw.toString() + ' '), signature, 'secret'), false);
  assert.equal(verifyWebhook(raw, signature, 'wrong'), false);
});

test('webhook mapping respects inventory item and selected location', () => {
  const state = openState(':memory:');
  state.seed('SKU', 'gid://shopify/InventoryItem/123', 'gid://shopify/InventoryItem/456', 10);
  assert.equal(webhookSku(state, 'main', { inventory_item_id: 123, location_id: 99 },
    'gid://shopify/Location/99'), 'SKU');
  assert.equal(webhookSku(state, 'main', { inventory_item_id: 123, location_id: 88 },
    'gid://shopify/Location/99'), null);
  state.close();
});
