import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { validWebhook } from '../src/webhook-auth.mjs';

test('webhook validation accepts both active secrets during rotation', async () => {
  const body = new TextEncoder().encode('{"inventory_item_id":123}');
  const sign = secret => createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(await validWebhook(body, sign('old'), ['new', 'old']), true);
  assert.equal(await validWebhook(body, sign('new'), ['new', 'old']), true);
  assert.equal(await validWebhook(body, sign('other'), ['new', 'old']), false);
  assert.equal(await validWebhook(new TextEncoder().encode('{}'), sign('old'), ['new', 'old']), false);
});
