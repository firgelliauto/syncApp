export async function validWebhook(body, signature, secrets) {
  if (!signature) return false;
  let supplied;
  try { supplied = Uint8Array.from(atob(signature), char => char.charCodeAt(0)); }
  catch { return false; }
  let matched = false;
  for (const secret of new Set(secrets.filter(Boolean))) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
    let difference = supplied.length ^ expected.length;
    for (let i = 0; i < Math.max(supplied.length, expected.length); i++) {
      difference |= (supplied[i] ?? 0) ^ (expected[i] ?? 0);
    }
    matched ||= difference === 0;
  }
  return matched;
}
