# Firgelli inventory sync

Sync Shopify **available inventory only** for exact, unique SKUs shared by:

- Main: `firgelliautomation.myshopify.com`, location **1350 Slater Road**
- Child: `firgelli1.myshopify.com`, location **Warehouse**

The first initialization copies each eligible main quantity to the child. Later inventory changes at either store contribute to a shared quantity and update the other store. Orders, products, prices, and descriptions are never copied. Missing child SKUs, blank or duplicate SKUs, untracked or nonphysical variants, negative available quantities, and variants set to continue selling out of stock are skipped. `Handling Fee` is excluded in `config/excluded-skus.mjs`.

## Current safety state

`wrangler.jsonc` sets `SYNC_ENABLED=false` and `ALLOW_INVENTORY_WRITES=false`. The Worker may be deployed and queried in this state, but it cannot initialize SKUs or change Shopify inventory. The code also requires both flags to process webhook jobs. Do not change either flag until the store owner approves the exact pilot and then the full rollout. The earlier live-store review is in the ignored `reports/read-only-review.md`.

## Cloudflare design

- A Worker receives Shopify `inventory_levels/update` HTTPS webhooks, validates their HMAC, and accepts operator requests protected by `ADMIN_TOKEN`.
- One SQLite-backed Durable Object persists initialized SKUs, deduplicated webhook jobs, pending writes, and a prepared read-only bootstrap plan. Its alarm retries pending work; a 15-minute Cron trigger checks for missed changes.
- A second Cron trigger at 03:07 UTC scans both catalogs once a day for new main-store SKUs. The first scan records the existing main catalog as a baseline, so it cannot enroll the initial backlog. A new SKU becomes a candidate only when the exact SKU is unique, tracked, physical, stocked at the selected locations, present in both stores, and passes the original eligibility rules. Main SKUs whose child match appears later stay eligible for future scans.
- Daily discovery is read-only while `AUTO_ENROLL_NEW_SKUS=false`. It can be inspected through authenticated `GET /admin/discovery`, or refreshed with `POST /admin/discovery/scan`. Automatic enrollment additionally requires `FULL_ROLLOUT_COMPLETE=true`, `SYNC_ENABLED=true`, and `ALLOW_INVENTORY_WRITES=true`. These switches all remain false. When explicitly enabled after the full rollout, it initializes up to five new eligible SKUs per day, copying the main quantity to the child with Shopify's quantity check, then queues a follow-up reconciliation.
- Every inventory write uses Shopify compare-and-set and an idempotency key. The source store supplies the initial value; after initialization, both stores' quantity changes are combined.
- One Durable Object instance owns the entire queue. No separate database or server is required.

Shopify webhooks are asynchronous. Two simultaneous purchases of the last unit can still oversell before the stores exchange updates. A stock buffer is needed if that risk is unacceptable.

## Local checks

Node.js 24 is required for the local audit and tests. Install Wrangler dependencies with `pnpm install` and run `node --test`. Credentials belong only in ignored `.env` and `.dev.vars` files, never in Git or chat. `.env.example` contains blank placeholders.

```powershell
node --env-file=.env src/audit.mjs locations
node --env-file=.env src/audit.mjs audit
node --env-file=.env src/bootstrap.mjs --sku=RC-170
node --test
pnpm exec wrangler deploy --dry-run
```

The Node bootstrap is retained for local dry runs. **Use the Cloudflare operator CLI for a hosted initialization** so that the Durable Object records every initialized SKU. Do not run the Node `--apply` command for the Cloudflare rollout.

## Cloudflare deployment

1. Authenticate Wrangler to the owner's Cloudflare account and confirm its account ID. The Worker name is `firgelli-inventory-sync`. The configuration creates a SQLite-backed Durable Object and a 15-minute Cron trigger.
2. Supply the five secrets `MAIN_CLIENT_ID`, `MAIN_CLIENT_SECRET`, `CHILD_CLIENT_ID`, `CHILD_CLIENT_SECRET`, and a newly generated long random `ADMIN_TOKEN` as Cloudflare Worker secrets. Cloudflare can accept an ignored JSON or dotenv file with `wrangler deploy --secrets-file <path>`. Keep a matching `ADMIN_TOKEN` in the local ignored `.env` for the operator CLI.
3. Deploy with `SYNC_ENABLED=false` and `ALLOW_INVENTORY_WRITES=false`. Record the Worker's HTTPS URL as `CLOUDFLARE_WORKER_URL` in local `.env`. Verify `/health`, authenticated `/admin/status`, and a read-only `/admin/plan`. The plan stores eligible candidates inside the Durable Object but makes **no Shopify inventory changes**.
4. Set Shopify inventory webhooks on both stores to `https://<worker-host>/webhooks/inventory` using `src/subscribe.mjs` with `PUBLIC_BASE_URL=https://<worker-host>`. Check authenticated delivery while sync remains disabled.
5. Review the fresh plan and record its `planId`. Obtain explicit approval for a pilot SKU. For that approved window only, set `ALLOW_INVENTORY_WRITES=true` while leaving `SYNC_ENABLED=false`, then run `node --env-file=.env src/cloud-bootstrap.mjs --apply --sku=APPROVED_SKU --plan-id=REVIEWED_PLAN_ID`. The CLI also requires local `ALLOW_INVENTORY_WRITES=true`. It refuses changed quantities since the reviewed plan.
6. After checking the pilot and obtaining separate approval for the full set, run a new read-only plan and review it. Then run `node --env-file=.env src/cloud-bootstrap.mjs --apply --all --plan-id=REVIEWED_PLAN_ID`. This initializes eligible SKUs one at a time. If any quantity changes during the run, it stops; run a new plan and review before resuming.
7. Enable `SYNC_ENABLED=true` only after successful initialization and webhook checks. Monitor `/admin/status` and Worker logs. To pause live processing, set `SYNC_ENABLED=false`.
8. New SKU enrollment requires its own approval. Set `FULL_ROLLOUT_COMPLETE=true` only after the initial catalog has been initialized, then separately approve `AUTO_ENROLL_NEW_SKUS=true`. Existing uninitialized main SKUs recorded in the daily baseline are never automatically added. Check `/admin/discovery` for candidates and skipped SKUs before enabling automatic enrollment.

The operator CLI without `--apply` is read-only:

```powershell
node --env-file=.env src/cloud-bootstrap.mjs
```

Do not run multiple competing initializations. `ADMIN_TOKEN` grants operator access; keep it secret and rotate it if exposed. Never put a Shopify client secret in `wrangler.jsonc` or the repository.

## Shopify requirements

The app must be installed on both stores with `read_products`, `read_inventory`, `read_locations`, and `write_inventory`. The currently granted scopes were verified on both stores. Shopify's client credentials grant works because both stores and the app belong to the same organization. Direct HTTPS webhooks use the app client secret for HMAC verification; the Google Pub/Sub service account is not used.

## References

- [Cloudflare Durable Objects with SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Shopify webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe)
- [Shopify compare-and-set inventory writes](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities)
