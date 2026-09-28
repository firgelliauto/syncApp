import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyViewerToken } from '../src/viewer-auth.mjs';

const stores = [
  { side: 'main', shop: 'main.myshopify.com', clientId: 'app', clientSecret: 'main-secret' },
  { side: 'child', shop: 'child.myshopify.com', clientId: 'app', clientSecret: 'child-secret' }
];

function token(shop, secret, overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: `https://${shop}/admin`,
    dest: `https://${shop}`, aud: 'app', sub: '123', nbf: 1000, exp: 1060,
    ...overrides })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('viewer accepts only a signed token for one of the configured stores', async () => {
  assert.deepEqual(await verifyViewerToken(token('child.myshopify.com', 'child-secret'), stores, 1030),
    { shop: 'child.myshopify.com', side: 'child', userId: '123' });
  assert.equal(await verifyViewerToken(token('child.myshopify.com', 'main-secret'), stores, 1030), null);
  assert.equal(await verifyViewerToken(token('other.myshopify.com', 'child-secret'), stores, 1030), null);
});

test('viewer rejects expired, premature, and wrong audience tokens', async () => {
  assert.equal(await verifyViewerToken(token('main.myshopify.com', 'main-secret'), stores, 1060), null);
  assert.equal(await verifyViewerToken(token('main.myshopify.com', 'main-secret'), stores, 999), null);
  assert.equal(await verifyViewerToken(token('main.myshopify.com', 'main-secret', { aud: 'other' }),
    stores, 1030), null);
});

test('viewer accepts either configured secret during credential rotation', async () => {
  const rotating = [{ ...stores[0], clientSecret: 'new-secret', previousSecrets: ['main-secret'] }];
  assert.ok(await verifyViewerToken(token('main.myshopify.com', 'new-secret'), rotating, 1030));
  assert.ok(await verifyViewerToken(token('main.myshopify.com', 'main-secret'), rotating, 1030));
  assert.equal(await verifyViewerToken(token('main.myshopify.com', 'unknown'), rotating, 1030), null);
});
