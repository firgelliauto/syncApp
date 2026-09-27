import { loadConfig } from './config.mjs';

try {
  const config = loadConfig();
  const base = new URL(process.env.PUBLIC_BASE_URL);
  if (base.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS');
  const uri = new URL('/webhooks/inventory', base).toString();
  const result = {};
  for (const [side, shop] of Object.entries(config.shops)) {
    const existing = await shop.graphql(`query Webhooks {
      webhookSubscriptions(first: 100, topics: INVENTORY_LEVELS_UPDATE) {
        nodes { id topic uri } pageInfo { hasNextPage }
      }
    }`);
    if (existing.webhookSubscriptions.pageInfo.hasNextPage) {
      throw new Error(`${shop.shop}: more than 100 inventory webhooks; inspect manually`);
    }
    const match = existing.webhookSubscriptions.nodes.find(item => item.uri === uri);
    if (match) { result[side] = { status: 'already_subscribed', id: match.id, uri }; continue; }
    if (existing.webhookSubscriptions.nodes.length) {
      throw new Error(`${shop.shop}: an inventory webhook already points elsewhere; review it before adding ${uri}`);
    }
    const data = await shop.graphql(`mutation Subscribe($topic: WebhookSubscriptionTopic!,
      $input: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) {
        webhookSubscription { id uri topic }
        userErrors { field message }
      }
    }`, { topic: 'INVENTORY_LEVELS_UPDATE', input: { uri } });
    const created = data.webhookSubscriptionCreate;
    if (created.userErrors.length) throw new Error(`${shop.shop}: ${created.userErrors.map(e => e.message).join('; ')}`);
    result[side] = { status: 'created', ...created.webhookSubscription };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
