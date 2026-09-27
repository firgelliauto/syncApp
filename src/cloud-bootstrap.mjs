// Operator CLI for the deployed Worker. Never enables inventory writes itself.
try {
  const base = new URL(process.env.CLOUDFLARE_WORKER_URL);
  if (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) {
    throw new Error('CLOUDFLARE_WORKER_URL must be HTTPS outside localhost');
  }
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new Error('Set ADMIN_TOKEN in the local ignored .env');
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const selected = args.filter(arg => arg.startsWith('--sku=')).map(arg => arg.slice(6));
  const planIds = args.filter(arg => arg.startsWith('--plan-id=')).map(arg => arg.slice(10));
  if (selected.some(sku => !sku)) throw new Error('An empty --sku is not allowed');
  if (apply && process.env.ALLOW_INVENTORY_WRITES !== 'true') {
    throw new Error('Local inventory write guard is disabled');
  }
  if (apply && (all === Boolean(selected.length))) {
    throw new Error('Apply requires either --all or at least one exact --sku=..., but not both');
  }
  if (apply && (planIds.length !== 1 || !planIds[0])) {
    throw new Error('Apply requires exactly one --plan-id=... from the reviewed read-only plan');
  }
  const call = async (path, init = {}) => {
    const response = await fetch(new URL(path, base), { ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw new Error(`${path}: ${result.error ?? response.status}`);
    return result;
  };
  const plan = await call(apply ? '/admin/prepared' : '/admin/plan');
  if (apply && plan.planId !== planIds[0]) throw new Error('Plan ID changed; review a fresh read-only plan');
  if (!apply) console.log(JSON.stringify({ mode: 'dry_run', planId: plan.planId,
    eligible: plan.eligible, changes: plan.changes, skipped: plan.skipped,
    errors: plan.errors, candidateCount: plan.candidates.length }, null, 2));
  if (apply) {
    const skus = all ? plan.candidates : selected;
    for (const sku of skus) {
      if (!plan.candidates.includes(sku)) throw new Error(`${sku} is not eligible in the reviewed plan`);
    }
    for (const sku of skus) {
      const result = await call('/admin/bootstrap', { method: 'POST',
        body: JSON.stringify({ sku, planId: plan.planId }) });
      console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
