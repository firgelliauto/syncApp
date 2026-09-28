function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token encoding');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

export async function verifyViewerToken(token, stores, now = Math.floor(Date.now() / 1000), onFailure = () => {}) {
  const fail = reason => { onFailure(reason); return null; };
  try {
    if (typeof token !== 'string' || token.length > 5000) return fail('format');
    const parts = token.split('.');
    if (parts.length !== 3) return fail('parts');
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (header.alg !== 'HS256' || (header.typ && header.typ !== 'JWT')) return fail('header');
    const destination = new URL(payload.dest);
    const issuer = new URL(payload.iss);
    const store = stores.find(item => item.clientId === payload.aud &&
      item.shop === destination.hostname);
    if (!store?.clientSecret || !store.shop) return fail('store');
    if (destination.protocol !== 'https:' || issuer.protocol !== 'https:' ||
        destination.hostname !== store.shop || issuer.hostname !== store.shop ||
        !['/admin', '/admin/'].includes(issuer.pathname) || destination.port || issuer.port) return fail('origin');
    if (!Number.isInteger(payload.exp) || !Number.isInteger(payload.nbf) ||
        payload.exp <= now || payload.nbf > now || payload.exp - payload.nbf > 300) return fail('time');
    let valid = false;
    for (const secret of new Set([store.clientSecret, ...(store.previousSecrets ?? [])].filter(Boolean))) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      valid = await crypto.subtle.verify('HMAC', key, decodeBase64Url(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)) || valid;
    }
    return valid ? { shop: store.shop, side: store.side, userId: payload.sub } : fail('signature');
  } catch {
    return fail('decode');
  }
}
