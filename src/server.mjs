import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { listVariants } from './shopify.mjs';
import { openState } from './state.mjs';
import { createEngine } from './engine.mjs';
import { verifyWebhook, webhookSku } from './webhook.mjs';

try {
  const enabled = process.env.SYNC_ENABLED === 'true';
  const config = loadConfig({ requireLocations: enabled });
  const state = openState(config.dbPath);
  if (enabled && !state.allSkus().length) {
    throw new Error('No initialized SKUs. Run bootstrap --apply before enabling sync.');
  }
  const engine = createEngine({ state, shops: config.shops, locations: config.locations,
    onLog: event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event })) });
  let busy = false;
  async function work() {
    if (!enabled || busy) return;
    busy = true;
    try {
      for (let i = 0; i < 20 && await engine.tick(); i++);
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), type: 'worker_error',
        message: error.message }));
    } finally { busy = false; }
  }

  async function reconcile() {
    if (!enabled) return;
    try {
      const [main, child] = await Promise.all([
        listVariants(config.shops.main, config.locations.main),
        listVariants(config.shops.child, config.locations.child)
      ]);
      const byItem = {
        main: new Map(main.map(v => [v.inventoryItemId, v.quantity])),
        child: new Map(child.map(v => [v.inventoryItemId, v.quantity]))
      };
      for (const row of state.allSkus()) {
        const a = byItem.main.get(row.main_item);
        const b = byItem.child.get(row.child_item);
        if (a !== row.main_qty || b !== row.child_qty) state.enqueue(randomUUID(), row.sku);
      }
      state.pruneJobs();
      await work();
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), type: 'reconcile_error',
        message: error.message }));
    }
  }

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', syncEnabled: enabled,
        initializedSkus: state.allSkus().length }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/webhooks/inventory') {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 1_000_000) throw new Error('Webhook body too large');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const domain = request.headers['x-shopify-shop-domain'];
      const side = domain === config.shops.main.shop ? 'main'
        : domain === config.shops.child.shop ? 'child' : null;
      if (!side || !verifyWebhook(body, request.headers['x-shopify-hmac-sha256'], config.secrets[side])) {
        response.writeHead(401).end();
        return;
      }
      if (request.headers['x-shopify-topic'] !== 'inventory_levels/update') {
        response.writeHead(200).end();
        return;
      }
      if (!config.locations[side]) { response.writeHead(503).end(); return; }
      const payload = JSON.parse(body.toString('utf8'));
      const deliveryId = request.headers['x-shopify-webhook-id'];
      if (!deliveryId) { response.writeHead(400).end(); return; }
      const sku = webhookSku(state, side, payload, config.locations[side]);
      if (sku) {
        state.enqueue(`${side}:${deliveryId}`, sku);
      }
      response.writeHead(200).end();
      void work();
    } catch (error) {
      console.error(JSON.stringify({ type: 'webhook_error', message: error.message }));
      response.writeHead(500).end();
    }
  });
  const port = Number(process.env.PORT || 8080);
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ type: 'listening', port, enabled })));
  setInterval(() => void work(), 1000);
  setInterval(() => void reconcile(), 15 * 60_000);
  void reconcile();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
