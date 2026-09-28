import { DurableObject } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { createShop, getQuantity, listVariants, setQuantity } from './shopify.mjs';
import { buildBootstrapPlan } from './bootstrap-plan.mjs';
import { buildDiscoveryPlan } from './discovery.mjs';
import { loadExcludedSkus } from './exclusions.mjs';
import { openCloudState } from './cloud-state.mjs';
import { createEngine } from './engine.mjs';
import { webhookSku } from './webhook.mjs';
import { verifyViewerToken } from './viewer-auth.mjs';
import { viewerPage } from './viewer-page.mjs';
import { validWebhook } from './webhook-auth.mjs';
import { canManageSync, rolloutReady, syncActive } from './sync-control.mjs';

const INSTANCE = 'firgelli-inventory-sync';
const json = (value, status = 200) => Response.json(value, { status });
let usageCache = null;

async function cloudflareUsage(env) {
  if (usageCache && Date.now() - usageCache.cachedAt < 5 * 60_000) return usageCache.value;
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('Cloudflare analytics is not connected');
  }
  const now = new Date();
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const reset = new Date(start); reset.setUTCDate(reset.getUTCDate() + 1);
  const query = `query GetWorkersAnalytics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 10000, filter: {scriptName: $scriptName,
        datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}) {
        sum { requests errors subrequests }
      }
    } }
  }`;
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID,
      datetimeStart: start.toISOString(), datetimeEnd: now.toISOString(),
      scriptName: env.CLOUDFLARE_WORKER_NAME ?? INSTANCE } })
  });
  if (!response.ok) throw new Error(`Cloudflare analytics returned ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message ?? 'Cloudflare analytics query failed');
  const rows = payload.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
  const totals = rows.reduce((sum, row) => ({ requests: sum.requests + (row.sum?.requests ?? 0),
    errors: sum.errors + (row.sum?.errors ?? 0),
    subrequests: sum.subrequests + (row.sum?.subrequests ?? 0) }),
  { requests: 0, errors: 0, subrequests: 0 });
  const limit = Number(env.CLOUDFLARE_DAILY_REQUEST_LIMIT) || 100_000;
  const value = { ...totals, limit, remaining: Math.max(0, limit - totals.requests),
    percentUsed: Math.min(100, totals.requests / limit * 100), resetAt: reset.toISOString(),
    checkedAt: now.toISOString(), source: 'Cloudflare Workers Analytics' };
  usageCache = { cachedAt: Date.now(), value };
  return value;
}

function binding(env) {
  return env.SYNC_STATE.get(env.SYNC_STATE.idFromName(INSTANCE));
}

function shops(env) {
  const allowInventoryWrites = env.ALLOW_INVENTORY_WRITES === 'true';
  return {
    main: createShop({ shop: env.MAIN_SHOP, clientId: env.MAIN_CLIENT_ID,
      clientSecret: env.MAIN_CLIENT_SECRET, allowInventoryWrites }),
    child: createShop({ shop: env.CHILD_SHOP, clientId: env.CHILD_CLIENT_ID,
      clientSecret: env.CHILD_CLIENT_SECRET, allowInventoryWrites })
  };
}

function locations(env) {
  return { main: env.MAIN_LOCATION_ID, child: env.CHILD_LOCATION_ID };
}

function viewerStores(env) {
  return [
    { side: 'main', shop: env.MAIN_SHOP, clientId: env.MAIN_CLIENT_ID,
      clientSecret: env.MAIN_CLIENT_SECRET },
    { side: 'child', shop: env.CHILD_SHOP, clientId: env.CHILD_CLIENT_ID,
      clientSecret: env.CHILD_CLIENT_SECRET }
  ];
}

function invalidSession() {
  return Response.json({ error: 'Invalid Shopify session' }, { status: 401,
    headers: { 'X-Shopify-Retry-Invalid-Session-Request': '1',
      'Cache-Control': 'no-store' } });
}

function sameToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/app')) {
      const clientId = url.searchParams.get('shop') === env.CHILD_SHOP ?
        env.CHILD_CLIENT_ID : env.MAIN_CLIENT_ID;
      const nonce = randomUUID().replaceAll('-', '');
      return new Response(viewerPage(clientId, nonce), { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': `frame-ancestors https://admin.shopify.com https://*.myshopify.com; base-uri 'none'; object-src 'none'`,
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'
      } });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const state = await binding(env).fetch('https://internal/status').then(response => response.json());
      return json({ status: 'ok', syncEnabled: env.SYNC_ENABLED === 'true',
        inventoryWritesEnabled: env.ALLOW_INVENTORY_WRITES === 'true',
        rolloutReady: state.rolloutReady, operatorPaused: state.operatorPaused,
        active: state.active, autoEnrollmentEnabled: state.autoEnrollmentEnabled });
    }
    const stub = binding(env);
    if ((request.method === 'GET' && ['/viewer/overview', '/viewer/plan', '/viewer/preview', '/viewer/usage'].includes(url.pathname)) ||
        (request.method === 'POST' && url.pathname === '/viewer/plan') ||
        (request.method === 'POST' && ['/viewer/control', '/viewer/attention'].includes(url.pathname))) {
      const authorization = request.headers.get('authorization') ?? '';
      const user = authorization.startsWith('Bearer ') ?
        await verifyViewerToken(authorization.slice(7), viewerStores(env), undefined,
          reason => console.warn('Viewer authorization rejected:', reason)) : null;
      if (!user) return invalidSession();
      const canManage = canManageSync(user, env);
      if (['/viewer/control', '/viewer/attention'].includes(url.pathname) && !canManage) {
        return json({ error: 'Not allowed' }, 403);
      }
      if (url.pathname === '/viewer/plan' && request.method === 'POST' && !canManage) return json({ error: 'Not allowed' }, 403);
      let result;
      if (url.pathname === '/viewer/usage') {
        try { return json(await cloudflareUsage(env)); }
        catch (error) { return json({ error: error.message }, 503); }
      } else if (url.pathname === '/viewer/attention') {
        if (Number(request.headers.get('content-length') ?? 0) > 1000) return json({ error: 'Request too large' }, 413);
        let input;
        try {
          const body = await request.text();
          if (body.length > 1000) return json({ error: 'Request too large' }, 413);
          input = JSON.parse(body);
        } catch { return json({ error: 'Invalid JSON' }, 400); }
        if (!Number.isInteger(input?.id)) return json({ error: 'Invalid alert ID' }, 400);
        result = await stub.fetch(new Request('https://internal/attention', { method: 'POST',
          body: JSON.stringify({ id: input.id }) }));
      } else if (url.pathname === '/viewer/control') {
        if (Number(request.headers.get('content-length') ?? 0) > 1000) return json({ error: 'Request too large' }, 413);
        let input;
        try {
          const body = await request.text();
          if (body.length > 1000) return json({ error: 'Request too large' }, 413);
          input = JSON.parse(body);
        } catch { return json({ error: 'Invalid JSON' }, 400); }
        if (!['pause', 'resume'].includes(input?.action)) return json({ error: 'Invalid action' }, 400);
        result = await stub.fetch(new Request('https://internal/control', { method: 'POST',
          body: JSON.stringify({ action: input.action }) }));
      } else if (url.pathname === '/viewer/plan' || url.pathname === '/viewer/preview') {
        result = await stub.fetch(new Request(`https://internal${url.pathname.slice('/viewer'.length)}`, { method: request.method }));
      } else {
        result = await stub.fetch(`https://internal/overview?canManage=${canManage ? '1' : '0'}`);
      }
      const response = new Response(result.body, result);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/inventory') {
      const domain = request.headers.get('x-shopify-shop-domain');
      const side = domain === env.MAIN_SHOP ? 'main' : domain === env.CHILD_SHOP ? 'child' : null;
      const body = await request.arrayBuffer();
      if (body.byteLength > 1_000_000) return json({ error: 'Webhook body too large' }, 413);
      const currentSecret = side === 'main' ? env.MAIN_CLIENT_SECRET : env.CHILD_CLIENT_SECRET;
      if (!side || !await validWebhook(body, request.headers.get('x-shopify-hmac-sha256'),
        [currentSecret, env.WEBHOOK_OLD_CLIENT_SECRET])) {
        return json({ error: 'Invalid webhook' }, 401);
      }
      if (request.headers.get('x-shopify-topic') !== 'inventory_levels/update') return json({ ignored: true });
      const deliveryId = request.headers.get('x-shopify-webhook-id');
      if (!deliveryId) return json({ error: 'Missing webhook ID' }, 400);
      let payload;
      try { payload = JSON.parse(new TextDecoder().decode(body)); }
      catch { return json({ error: 'Invalid JSON' }, 400); }
      return stub.fetch(new Request('https://internal/webhook', { method: 'POST',
        body: JSON.stringify({ side, deliveryId, payload }) }));
    }
    if (!url.pathname.startsWith('/admin/')) return json({ error: 'Not found' }, 404);
    if (!sameToken(request.headers.get('authorization'), `Bearer ${env.ADMIN_TOKEN}`) ||
        !env.ADMIN_TOKEN) return json({ error: 'Unauthorized' }, 401);
    const route = url.pathname.slice('/admin'.length);
    const allowed = (route === '/status' || route === '/sku' || route === '/plan' || route === '/prepared' ||
      route === '/preflight' ||
      route === '/discovery') ? request.method === 'GET'
      : (route === '/bootstrap' || route === '/stage' || route === '/resolve' ||
        route === '/rebaseline-all' ||
        route === '/rebaseline-mirror' ||
        route === '/discovery/scan') ? request.method === 'POST' : false;
    if (!allowed) return json({ error: 'Not found' }, 404);
    return stub.fetch(new Request(`https://internal${route}${url.search}`, {
      method: request.method, body: request.method === 'POST' ? await request.text() : undefined
    }));
  },
  async scheduled(event, env) {
    if (event.cron === '7 3 * * *') {
      const response = await binding(env).fetch('https://internal/discovery/scan', { method: 'POST' });
      if (!response.ok) throw new Error(`Daily SKU discovery failed: ${await response.text()}`);
      return;
    }
    if (env.SYNC_ENABLED === 'true' && env.ALLOW_INVENTORY_WRITES === 'true') {
      await binding(env).fetch('https://internal/reconcile');
    }
  }
};

export class InventorySyncState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = openCloudState(ctx.storage);
    this.shops = shops(env);
    this.locations = locations(env);
    this.engine = createEngine({ state: this.state, shops: this.shops,
      locations: this.locations, onLog: event => this.logActivity(event),
      canProcess: () => this.live() });
  }

  logActivity(event) {
    const level = event.level ?? (['retry', 'scan_error', 'auto_enroll_error', 'cloud_error',
      'worker_error'].includes(event.type) ? 'error' :
      ['stale', 'negative_blocked'].includes(event.type) ? 'warning' : 'info');
    this.state.appendActivity({ ...event, level });
    console.log(JSON.stringify(event));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/status') return json({ initializedSkus: this.state.skuCount(),
        preparedSkus: this.state.preparedCount(), pendingJobs: this.state.pendingCount(),
        pendingWrites: this.state.writeCount(), syncEnabled: this.env.SYNC_ENABLED === 'true',
        inventoryWritesEnabled: this.env.ALLOW_INVENTORY_WRITES === 'true',
        rolloutReady: this.ready(), operatorPaused: this.state.isPaused(),
        active: this.live(),
        initialStagedAt: this.state.initialStagedAt(),
        autoEnrollmentEnabled: this.autoEnrollmentEnabled(),
        discovery: this.state.discoveryStatus() });
      if (path === '/overview' && request.method === 'GET') {
        const discovery = this.state.discoveryStatus();
        const initialCopyCompletedAt = this.initialCopyCompletedAt();
        return json({ status: {
          initializedSkus: this.state.skuCount(), pendingJobs: this.state.pendingCount(),
          pendingWrites: this.state.writeCount(), syncEnabled: this.env.SYNC_ENABLED === 'true',
          inventoryWritesEnabled: this.env.ALLOW_INVENTORY_WRITES === 'true',
          active: this.live(), initialStagedAt: this.state.initialStagedAt(),
          initialCopyCompletedAt,
          discovery: { lastScanAt: discovery.lastScanAt,
            candidateCount: discovery.candidates.length }
        }, control: this.controlStatus(url.searchParams.get('canManage') === '1'),
        lastCompletedScan: this.state.lastCompletedScan(),
        pendingWrites: this.state.pendingWrites(),
        pendingJobs: this.state.pendingJobs(),
        blockedSkus: this.state.blockedSkus(),
        problems: this.state.recentProblems(20),
        activity: this.state.recentActivity(150) });
      }
      if (path === '/plan' && request.method === 'GET') return json(this.prepared());
      if (path === '/sku' && request.method === 'GET') {
        const sku = url.searchParams.get('sku');
        if (!sku) return json({ error: 'Provide SKU' }, 400);
        const row = this.state.getSku(sku);
        return row ? json({ sku, sharedQuantity: row.shared_qty,
          mainBaseline: row.main_qty, childBaseline: row.child_qty,
          blocked: this.state.getBlock(sku),
          approvedConflict: this.state.approvedConflict(sku) }) :
          json({ error: 'SKU is not tracked' }, 404);
      }
      if (path === '/preflight' && request.method === 'GET') {
        const conflicts = await this.preflightConflicts();
        return json({ conflicts, blockedSkus: this.state.blockedSkus(),
          active: this.live(), paused: this.state.isPaused() });
      }
      if (path === '/plan' && request.method === 'POST') return json(await this.prepare());
      if (path === '/preview' && request.method === 'GET') return json(await this.pendingPreview());
      if (path === '/control' && request.method === 'POST') {
        const { action } = await request.json();
        if (action === 'resume') {
          if (!this.ready()) return json({ error: 'Full rollout is not staged and enabled' }, 409);
          const conflicts = await this.preflightConflicts();
          if (conflicts.length) return json({ error: `${conflicts.length} SKU(s) changed in both stores. Resolve the blocked SKUs before enabling.` }, 409);
          if (this.state.blockedCount()) return json({ error: 'Blocked SKUs need review before enabling' }, 409);
          if (this.state.isPaused()) {
            this.state.setPaused(false);
            this.state.requestReconcile();
            this.logActivity({ type: 'sync_resumed', message: 'Sync enabled from Shopify admin' });
            await this.scheduleSoon();
          }
        } else if (action === 'pause') {
          if (!this.state.isPaused()) {
            this.state.setPaused(true);
            this.logActivity({ type: 'sync_paused', message: 'Sync paused from Shopify admin' });
          }
        } else return json({ error: 'Invalid action' }, 400);
        return json({ control: this.controlStatus(true) });
      }
      if (path === '/attention' && request.method === 'POST') {
        const { id } = await request.json();
        this.state.dismissProblem(id);
        this.logActivity({ type: 'alert_dismissed', message: `Historical alert ${id} dismissed in Shopify admin` });
        return json({ dismissed: true, id });
      }
      if (path === '/webhook' && request.method === 'POST') {
        const { side, deliveryId, payload } = await request.json();
        if (!['main', 'child'].includes(side) || typeof deliveryId !== 'string') return json({ error: 'Invalid event' }, 400);
        const sku = webhookSku(this.state, side, payload, this.locations[side]);
        if (sku) {
          if (this.state.enqueue(`${side}:${deliveryId}`, sku)) {
            this.logActivity({ type: 'webhook', side, sku,
              message: this.live() ? 'Shopify reported an inventory change' :
                'Shopify reported a change while syncing is paused' });
          }
          if (this.live()) await this.scheduleSoon();
        }
        return json({ accepted: true });
      }
      if (path === '/plan' && request.method === 'GET') return json(await this.prepare());
      if (path === '/prepared' && request.method === 'GET') return json(this.prepared());
      if (path === '/discovery' && request.method === 'GET') return json(this.state.discoveryStatus());
      if (path === '/discovery/scan' && request.method === 'POST') return json(await this.discover());
      if (path === '/bootstrap' && request.method === 'POST') {
        let input;
        try { input = await request.json(); }
        catch { return json({ error: 'Expected JSON' }, 400); }
        return json(await this.bootstrapSku(input?.sku, input?.planId));
      }
      if (path === '/stage' && request.method === 'POST') {
        const input = await request.json();
        if (this.env.SYNC_ENABLED === 'true' || this.env.ALLOW_INVENTORY_WRITES === 'true' ||
            !this.state.isPaused()) throw new Error('Staging requires syncing and inventory writes to be off');
        if (typeof input?.planId !== 'string') throw new Error('Provide the reviewed plan ID');
        const result = this.state.stagePrepared(input.planId);
        this.logActivity({ type: 'catalog_staged',
          message: `${result.stagedSkus} SKUs staged without Shopify inventory changes; ${result.initialChanges} initial differences queued` });
        return json(result);
      }
      if (path === '/resolve' && request.method === 'POST') {
        const input = await request.json();
        return json(await this.resolveBlockedSku(input));
      }
      if (path === '/rebaseline-mirror' && request.method === 'POST') {
        const input = await request.json();
        return json(await this.rebaselineMirror(input));
      }
      if (path === '/rebaseline-all' && request.method === 'POST') {
        return json(await this.rebaselineAll());
      }
      if (path === '/reconcile') {
        if (this.live()) await this.reconcile();
        return json({ accepted: true });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      this.logActivity({ type: 'cloud_error', message: `${path}: ${error.message}` });
      return json({ error: error.message }, 400);
    }
  }

  live() {
    return this.ready() && syncActive(this.env, this.state.isPaused());
  }

  ready() {
    return rolloutReady(this.env) && Boolean(this.state.initialStagedAt());
  }

  autoEnrollmentEnabled() {
    return this.live() && this.env.AUTO_ENROLL_NEW_SKUS === 'true';
  }

  initialCopyCompletedAt() {
    if (this.live() && this.state.initialStagedAt() && this.state.lastCompletedScan() &&
        !this.state.pendingCount() && !this.state.writeCount() &&
        !this.state.initialCopyCompletedAt()) this.state.markInitialCopyCompleted();
    return this.state.initialCopyCompletedAt();
  }

  controlStatus(canManage = false) {
    return { active: this.live(), paused: this.state.isPaused(),
      rolloutReady: this.ready(), blockedSkus: this.state.blockedCount(), canManage };
  }

  async preflightConflicts() {
    const [main, child] = await Promise.all([
      listVariants(this.shops.main, this.locations.main),
      listVariants(this.shops.child, this.locations.child)
    ]);
    const mainByItem = new Map(main.map(row => [row.inventoryItemId, row]));
    const childByItem = new Map(child.map(row => [row.inventoryItemId, row]));
    const conflicts = [];
    for (const row of this.state.allSkus()) {
      const a = mainByItem.get(row.main_item);
      const b = childByItem.get(row.child_item);
      if (!a || !b || a.sku !== row.sku || b.sku !== row.sku ||
          !Number.isInteger(a.quantity) || !Number.isInteger(b.quantity)) {
        conflicts.push(row.sku);
        this.state.blockSku(row.sku, a?.quantity ?? -1, b?.quantity ?? -1,
          'SKU, inventory item, or selected location changed; no quantity was written.');
        continue;
      }
      const mainDelta = a.quantity - row.main_qty;
      const childDelta = b.quantity - row.child_qty;
      if (mainDelta !== 0 && childDelta !== 0 &&
          !this.state.isApprovedConflict(row.sku, a.quantity, b.quantity)) {
        conflicts.push(row.sku);
        const reason = `Both stores changed: main ${row.main_qty} → ${a.quantity} (${mainDelta >= 0 ? '+' : ''}${mainDelta}), child ${row.child_qty} → ${b.quantity} (${childDelta >= 0 ? '+' : ''}${childDelta}); no quantity was written.`;
        if (!this.state.getBlock(row.sku)) {
          this.logActivity({ type: 'ambiguous_change', level: 'error', sku: row.sku, message: reason });
        }
        this.state.blockSku(row.sku, a.quantity, b.quantity, reason);
      }
    }
    return conflicts;
  }

  async scheduleSoon() {
    const current = await this.ctx.storage.getAlarm();
    const soon = Date.now() + 1000;
    if (current === null || current > soon) await this.ctx.storage.setAlarm(soon);
  }

  async alarm() {
    if (!this.live()) return;
    let failed = false;
    try {
      if (this.state.reconcileRequested() && await this.reconcile()) {
        this.state.clearReconcileRequest();
      }
      for (let i = 0; i < 20 && this.live() && await this.engine.tick(); i++);
      this.initialCopyCompletedAt();
      this.state.pruneJobs();
    } catch (error) {
      failed = true;
      this.logActivity({ type: 'worker_error', message: error.message });
    } finally {
      const nextWrite = this.state.nextWriteAt();
      const readyJob = this.state.nextJob();
      if (this.live() && (this.state.reconcileRequested() || readyJob || nextWrite !== null)) {
        await this.ctx.storage.setAlarm(this.state.reconcileRequested() || readyJob ?
          Date.now() + (failed ? 5 * 60_000 : 1000) : Math.max(Date.now() + 1000, nextWrite));
      }
    }
  }

  async prepare() {
    if (this.env.SYNC_ENABLED === 'true') throw new Error('Pause sync before preparing a bootstrap plan');
    if (this.state.initialStagedAt()) throw new Error('Initial catalog is already staged');
    const [main, child] = await Promise.all([
      listVariants(this.shops.main, this.locations.main),
      listVariants(this.shops.child, this.locations.child)
    ]);
    const { report, candidates } = buildBootstrapPlan(main, child,
      { excludedSkus: loadExcludedSkus(), isInitialized: sku => Boolean(this.state.getSku(sku)) });
    const planId = this.state.replacePrepared(candidates);
    return { planId, generatedAt: planId, ...report,
      candidates: candidates.map(({ sku }) => sku) };
  }

  prepared() {
    const rows = this.state.listPrepared();
    return { planId: rows[0]?.created_at ?? null, stagedAt: this.state.initialStagedAt(),
      eligible: rows.length,
      candidates: rows.map(({ sku }) => sku),
      changes: rows.filter(row => row.main_qty !== row.child_qty).map(row => ({
        sku: row.sku, mainQuantity: row.main_qty, childQuantity: row.child_qty
      })) };
  }

  async pendingPreview() {
    const jobs = this.state.pendingJobs();
    const rows = [];
    if (!jobs.length) return { checkedAt: new Date().toISOString(), totalEvents: 0,
      previewedSkus: 0, summary: { pendingSkus: 0, noChange: 0, childUpdates: 0,
        mainUpdates: 0, bothUpdates: 0, ambiguous: 0, errors: 0 }, rows };
    const [mainCatalog, childCatalog] = await Promise.all([
      listVariants(this.shops.main, this.locations.main),
      listVariants(this.shops.child, this.locations.child)
    ]);
    const mainByItem = new Map(mainCatalog.map(row => [row.inventoryItemId, row]));
    const childByItem = new Map(childCatalog.map(row => [row.inventoryItemId, row]));
    for (const job of jobs) {
      const sku = this.state.getSku(job.sku);
      if (!sku) { rows.push({ sku: job.sku, error: 'SKU is not tracked' }); continue; }
      const block = this.state.getBlock(job.sku);
      if (block) { rows.push({ sku: job.sku, main: block.main_qty, child: block.child_qty,
        target: null, error: block.reason }); continue; }
      if (this.state.hasWrite(job.sku)) { rows.push({ sku: job.sku,
        note: 'An earlier planned update is waiting; see pending writes.' }); continue; }
      try {
        const mainItem = mainByItem.get(sku.main_item);
        const childItem = childByItem.get(sku.child_item);
        if (mainItem?.sku !== sku.sku || childItem?.sku !== sku.sku) {
          throw new Error('SKU or inventory item changed; review before syncing');
        }
        const main = mainItem.quantity;
        const child = childItem.quantity;
        if (!Number.isInteger(main) || !Number.isInteger(child)) throw new Error('Inventory level unavailable');
        const target = sku.shared_qty + (main - sku.main_qty) + (child - sku.child_qty);
        const mainDelta = main - sku.main_qty;
        const childDelta = child - sku.child_qty;
        const approved = this.state.isApprovedConflict(job.sku, main, child);
        if (mainDelta !== 0 && childDelta !== 0 && !approved) {
          rows.push({ sku: job.sku, main, child, target: null, mainChange: null,
            childChange: null, error: `Both stores changed (main ${mainDelta >= 0 ? '+' : ''}${mainDelta}, child ${childDelta >= 0 ? '+' : ''}${childDelta}). Ambiguous; no update will be made.` });
          continue;
        }
        rows.push({ sku: job.sku, main, child, target, approved,
          mainChange: target - main,
          childChange: target - child, error: target < 0 ? 'Combined stock would be negative; update blocked' : null });
      } catch (error) { rows.push({ sku: job.sku, error: error.message }); }
    }
    const summary = { pendingSkus: rows.length, noChange: 0, childUpdates: 0,
      mainUpdates: 0, bothUpdates: 0, ambiguous: 0, errors: 0 };
    for (const row of rows) {
      if (row.error) {
        if (row.error.includes('Both stores changed')) summary.ambiguous++;
        else summary.errors++;
      } else if (Number.isInteger(row.target)) {
        if (row.mainChange && row.childChange) summary.bothUpdates++;
        else if (row.mainChange) summary.mainUpdates++;
        else if (row.childChange) summary.childUpdates++;
        else summary.noChange++;
      }
    }
    return { checkedAt: new Date().toISOString(), totalEvents: this.state.pendingCount(),
      previewedSkus: rows.length, summary, rows };
  }

  async resolveBlockedSku(input) {
    if (!this.state.isPaused() || this.live()) throw new Error('Pause syncing before resolving a blocked SKU');
    if (input?.decision !== 'independent_orders' || typeof input.sku !== 'string' ||
        !Number.isInteger(input.expectedMain) || !Number.isInteger(input.expectedChild)) {
      throw new Error('Provide SKU, independent_orders decision, and reviewed quantities');
    }
    const row = this.state.getSku(input.sku);
    const block = this.state.getBlock(input.sku);
    if (!row || !block) throw new Error('SKU is not blocked for review');
    const [main, child] = await Promise.all([
      getQuantity(this.shops.main, row.main_item, this.locations.main, row.sku),
      getQuantity(this.shops.child, row.child_item, this.locations.child, row.sku)
    ]);
    if (main !== input.expectedMain || child !== input.expectedChild ||
        main !== block.main_qty || child !== block.child_qty) {
      throw new Error('Stock changed since review; run preflight again');
    }
    if (main >= row.main_qty || child >= row.child_qty) {
      throw new Error('Independent-order resolution requires a decrease in both stores');
    }
    const target = row.shared_qty + (main - row.main_qty) + (child - row.child_qty);
    if (target < 0) throw new Error('Combined stock would be negative');
    this.state.approveConflict(row.sku, main, child);
    this.state.enqueue(randomUUID(), row.sku);
    this.logActivity({ type: 'conflict_approved', sku: row.sku,
      message: `Separate orders confirmed: main ${main}, child ${child}; shared target ${target}. No quantity was written.` });
    return { sku: row.sku, main, child, target, approved: true, active: this.live() };
  }

  async rebaselineMirror(input) {
    if (!this.state.isPaused() || this.env.SYNC_ENABLED === 'true' ||
        this.env.ALLOW_INVENTORY_WRITES === 'true') {
      throw new Error('Disable sync and inventory writes before rebaselining');
    }
    if (typeof input?.sku !== 'string' || !Number.isInteger(input?.expectedQuantity)) {
      throw new Error('Provide exact SKU and reviewed quantity');
    }
    const row = this.state.getSku(input.sku);
    if (!row) throw new Error('SKU is not tracked');
    const [main, child] = await Promise.all([
      getQuantity(this.shops.main, row.main_item, this.locations.main, row.sku),
      getQuantity(this.shops.child, row.child_item, this.locations.child, row.sku)
    ]);
    if (main !== input.expectedQuantity || child !== input.expectedQuantity) {
      throw new Error('Store quantities differ from reviewed value; stop and investigate');
    }
    const mainDelta = main - row.main_qty;
    const childDelta = child - row.child_qty;
    if (mainDelta >= 0 || mainDelta !== childDelta) {
      throw new Error('Changes do not match a single mirrored decrease');
    }
    this.state.rebaselineMirroredChange(row.sku, main);
    this.logActivity({ type: 'mirror_rebaselined', sku: row.sku,
      message: `One main-store order mirrored to both stores (${mainDelta}); saved baseline set to ${main}. No Shopify inventory was changed.` });
    return { sku: row.sku, quantity: main, mirroredChange: mainDelta,
      active: this.live(), inventoryChanged: false };
  }

  async rebaselineAll() {
    if (!this.state.isPaused() || this.env.SYNC_ENABLED === 'true' ||
        this.env.ALLOW_INVENTORY_WRITES === 'true') {
      throw new Error('Disable sync and inventory writes before taking a fresh baseline');
    }
    const [main, child] = await Promise.all([
      listVariants(this.shops.main, this.locations.main),
      listVariants(this.shops.child, this.locations.child)
    ]);
    const { report, candidates } = buildBootstrapPlan(main, child,
      { excludedSkus: loadExcludedSkus(), isInitialized: () => false });
    const candidateSkus = new Set(candidates.map(row => row.sku));
    const lost = this.state.allSkus().filter(row => !candidateSkus.has(row.sku));
    if (lost.length) throw new Error(`${lost.length} tracked SKU(s) are no longer eligible; review before replacing baseline`);
    const result = this.state.replaceBaseline(candidates);
    this.logActivity({ type: 'shadow_baseline',
      message: `Read-only baseline refreshed for ${result.trackedSkus} SKUs; ${result.childDifferences} child differences. No Shopify inventory changed.` });
    return { ...result, skippedCount: report.skipped.length, errors: report.errors,
      inventoryChanged: false, active: this.live() };
  }

  async bootstrapSku(sku, planId) {
    if (this.env.SYNC_ENABLED === 'true') throw new Error('Pause sync before bootstrap');
    if (this.env.ALLOW_INVENTORY_WRITES !== 'true') throw new Error('Inventory writes remain disabled');
    if (typeof sku !== 'string' || !sku.trim()) throw new Error('Provide one exact SKU');
    if (loadExcludedSkus().has(sku)) throw new Error('SKU is excluded');
    const row = this.state.getPrepared(sku);
    if (!row) throw new Error('SKU is not in the latest prepared plan; run /admin/plan again');
    if (!planId || row.created_at !== planId) throw new Error('Plan ID does not match the reviewed plan');
    if (this.state.getSku(sku)) throw new Error('SKU is already initialized');
    const [main, child] = await Promise.all([
      getQuantity(this.shops.main, row.main_item, this.locations.main, sku),
      getQuantity(this.shops.child, row.child_item, this.locations.child, sku)
    ]);
    if (main !== row.main_qty || child !== row.child_qty) {
      throw new Error('Quantity changed since the read-only plan; run /admin/plan again');
    }
    if (main !== child) await setQuantity(this.shops.child, { inventoryItemId: row.child_item,
      locationId: this.locations.child, from: child, to: main, key: randomUUID() });
    this.state.seed(sku, row.main_item, row.child_item, main);
    this.logActivity({ type: 'bootstrap', sku, side: 'child', from: child, to: main,
      message: 'Initialized from the main store' });
    return { sku, seeded: true, childChanged: main !== child, mainQuantity: main,
      previousChildQuantity: child };
  }

  async discover() {
    const [main, child] = await Promise.all([
      listVariants(this.shops.main, this.locations.main),
      listVariants(this.shops.child, this.locations.child)
    ]);
    const status = this.state.discoveryStatus();
    const { mainSkus, candidates, skipped } = buildDiscoveryPlan(main, child, {
      baselineAt: status.baselineAt,
      observedMainSkus: this.state.observedMainSkus(),
      newMainSkus: this.state.newMainSkus(),
      excludedSkus: loadExcludedSkus(),
      isInitialized: sku => Boolean(this.state.getSku(sku))
    });
    const baselineCreated = this.state.recordDiscovery(mainSkus, candidates);
    const enrolled = [];
    if (this.autoEnrollmentEnabled()) {
      for (const row of candidates.slice(0, 5)) {
        if (!this.autoEnrollmentEnabled()) break;
        try {
          const [mainQuantity, childQuantity] = await Promise.all([
            getQuantity(this.shops.main, row.mainItem, this.locations.main, row.sku),
            getQuantity(this.shops.child, row.childItem, this.locations.child, row.sku)
          ]);
          if (!Number.isInteger(mainQuantity) || !Number.isInteger(childQuantity) ||
              mainQuantity < 0 || childQuantity < 0) continue;
          if (!this.autoEnrollmentEnabled()) break;
          if (mainQuantity !== childQuantity) await setQuantity(this.shops.child, {
            inventoryItemId: row.childItem, locationId: this.locations.child,
            from: childQuantity, to: mainQuantity, key: randomUUID()
          });
          if (this.state.seed(row.sku, row.mainItem, row.childItem, mainQuantity)) {
            this.logActivity({ type: 'auto_enroll', sku: row.sku, side: 'child',
              from: childQuantity, to: mainQuantity,
              message: 'New SKU initialized from the main store' });
            this.state.enqueue(randomUUID(), row.sku);
            await this.scheduleSoon();
            enrolled.push(row.sku);
          }
        } catch (error) {
          this.logActivity({ type: 'auto_enroll_error', sku: row.sku,
            message: error.message });
        }
      }
    }
    this.logActivity({ type: 'discovery',
      message: `${candidates.length} new matching SKU${candidates.length === 1 ? '' : 's'} found; ${enrolled.length} enrolled` });
    return { baselineCreated, observedMainSkus: mainSkus.size,
      candidates: candidates.map(row => row.sku), skipped, enrolled,
      autoEnrollmentEnabled: this.autoEnrollmentEnabled() };
  }

  async reconcile() {
    if (!this.live()) return false;
    const [main, child] = await Promise.all([
      listVariants(this.shops.main, this.locations.main),
      listVariants(this.shops.child, this.locations.child)
    ]);
    if (!this.live()) return false;
    const byItem = {
      main: new Map(main.map(v => [v.inventoryItemId, v.quantity])),
      child: new Map(child.map(v => [v.inventoryItemId, v.quantity]))
    };
    for (const row of this.state.allSkus()) {
      if (this.state.getBlock(row.sku)) continue;
      if (byItem.main.get(row.main_item) !== row.main_qty ||
          byItem.child.get(row.child_item) !== row.child_qty) {
        this.state.enqueue(randomUUID(), row.sku);
      }
    }
    this.state.markCompletedScan();
    if (this.state.pendingCount()) await this.scheduleSoon();
    return true;
  }
}
