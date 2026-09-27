import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(body, signature, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64'); }
  catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function webhookSku(state, side, payload, locationId) {
  if (payload.inventory_item_id == null) return null;
  const location = payload.location_id;
  if (location != null && String(location) !== locationId.split('/').at(-1)) return null;
  return state.findSkuByItem(side, `gid://shopify/InventoryItem/${payload.inventory_item_id}`) ?? null;
}
