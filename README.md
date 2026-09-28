# Firgelli inventory sync

Sync Shopify **available inventory only** for exact, unique SKUs shared by:

- Main: `firgelliautomation.myshopify.com`, location **1350 Slater Road**
- Child: `firgelli1.myshopify.com`, location **Warehouse**

The staged baseline takes each eligible main quantity as the starting shared quantity. When the operator enables sync, initial differences and later stock changes are reconciled across both stores. Orders, products, prices, and descriptions are never copied. Missing child SKUs, blank or duplicate SKUs, untracked or nonphysical variants, negative available quantities, and variants set to continue selling out of stock are skipped. `Handling Fee` is excluded in `config/excluded-skus.mjs`.

## Current safety state

The initial matching catalog has been staged in the Cloudflare Durable Object without changing Shopify inventory. **All rollout switches and the persisted dashboard control are Off.** One main-store order reduced each of two SKUs by 3, and the child store also decreased by 3 while this app was Off. The earlier assumption that there were separate child-store orders was wrong and has been reversed. Both SKUs have been rebaselined to their verified current quantities, 430 and 43, without changing Shopify inventory; their erroneous approvals and queued jobs were removed. Do not re-enable this app until the process that already mirrors main-store inventory to the child is identified and its overlap with this app is resolved. The Worker blocks simultaneous two-store changes instead of double counting them. The earlier live-store review is in the ignored `reports/read-only-review.md`.

## Cloudflare design

- A Worker receives Shopify `inventory_levels/update` HTTPS webhooks, validates their HMAC, and accepts operator requests protected by `ADMIN_TOKEN`.
- One SQLite-backed Durable Object persists initialized SKUs, deduplicated webhook jobs, pending writes, and a prepared read-only bootstrap plan. Its alarm retries pending work; a 15-minute Cron trigger checks for missed changes.
- A second Cron trigger at 03:07 UTC scans both catalogs once a day for new main-store SKUs. The first scan records the existing main catalog as a baseline, so it cannot enroll the initial backlog. A new SKU becomes a candidate only when the exact SKU is unique, tracked, physical, stocked at the selected locations, present in both stores, and passes the original eligibility rules. Main SKUs whose child match appears later stay eligible for future scans.
- Daily discovery can be inspected through authenticated `GET /admin/discovery`, or refreshed with `POST /admin/discovery/scan`. Automatic enrollment requires the rollout flags and dashboard control to be On. Once enabled, it initializes up to five newly observed eligible SKUs per day, copying the main quantity to the child with Shopify's quantity check, then queues a follow-up reconciliation. Existing main SKUs in the discovery baseline are not automatically enrolled.
- Every inventory write uses Shopify compare-and-set and an idempotency key. The source store supplies the initial value; after initialization, both stores' quantity changes are combined.
- If both stores change a SKU before reconciliation, the app treats it as ambiguous and blocks that SKU instead of guessing. The preflight gate checks the entire tracked catalog before an operator can enable syncing. Confirmed independent orders can be approved for their exact observed quantities through the authenticated `/admin/resolve` endpoint while paused. Mirrored changes are instead rebaselined once through `/admin/rebaseline-mirror` with both deployment switches Off and exact current quantities. The engine records its own writes in the baseline so subsequent Shopify webhook echoes do not deduct them again.
- One Durable Object instance owns the entire queue. No separate database or server is required.
- App Home at the Worker's root path shows sync status, new SKU candidates, active retries, recent failures, and a searchable SKU activity history. The approved main-store account can pause or resume after rollout approval; other viewers have read-only access. Shopify App Bridge supplies a short-lived ID token for each browser request; the Worker verifies its signature and allows only the two configured shops. The operator `ADMIN_TOKEN` is never sent to the browser. Activity begins when this feature is deployed and is retained for up to 90 days or 5,000 events, whichever limit is reached first.

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
5. The approved pilot SKU was initialized earlier. For the full rollout, generate a fresh read-only `/admin/plan`, review it, then stage the exact plan with authenticated `POST /admin/stage` and JSON `{ "planId": "..." }`. Staging records each SKU's main quantity as the shared baseline and its actual child quantity separately. It queues initial differences without calling Shopify's inventory mutation. It requires both deployment write and sync switches Off and the dashboard control Off.
6. Deploy the rollout switches only after staging. The saved dashboard control remains Off; inspect `/admin/status`, the initial plan, and the pending work preview. The rollout gate also requires a staged catalog, so changing the flags alone cannot start sync. When the operator clicks Enable, the Worker scans both stores before processing queued work. Changes to either store since staging contribute to the resulting shared quantity.
7. Monitor `/admin/status` and Worker logs after enabling. The dashboard Pause button stops new sync work; setting `SYNC_ENABLED=false` remains a deployment-level hard stop. An already-started Shopify request can finish during a pause.

Before staging, the operator CLI without `--apply` creates a read-only plan. Once the catalog is staged, the plan is available from `/admin/prepared` and the dashboard; `/admin/plan` is intentionally locked to preserve the staged snapshot.

```powershell
node --env-file=.env src/cloud-bootstrap.mjs
```

## Shopify App Home

The Worker serves its dashboard at `https://firgelli-inventory-sync.firgelli-inventory-sync.workers.dev/`. To open it by clicking the installed app in Shopify admin, set the app's **App URL** to that root URL, enable **Embed app in Shopify admin**, and release a new app version in the Dev Dashboard. The Worker must be deployed first. These App Home settings do not change inventory permissions or enable syncing. The current `/health` URL remains a machine health endpoint.

The public HTML shell contains no inventory data. `GET /viewer/overview` requires a signed, unexpired Shopify App Bridge ID token for either configured store and returns status and history. `/admin/*` remains protected by the separate operator token. Recent failures are historical events; the active retry list shows updates that are still pending. Cloudflare logs remain available for deeper debugging.

The dashboard includes a persistent On/Off sync control. `SYNC_CONTROL_USER_ID` is the approved main-store Shopify staff ID; all other staff and child-store users can view status but cannot change it. The control is currently **Off**, and Enable requires `SYNC_ENABLED`, `ALLOW_INVENTORY_WRITES`, and `FULL_ROLLOUT_COMPLETE` to be `true` plus a staged initial catalog. Pausing stops new work, keeps webhook events queued, and leaves any already-started Shopify request to finish. Enabling schedules a fresh stock reconciliation before pending jobs are processed. This control does not change Shopify app scopes.

During Shopify client-secret rotation, set `WEBHOOK_OLD_CLIENT_SECRET` to the oldest unrevoked secret while `MAIN_CLIENT_SECRET` and `CHILD_CLIENT_SECRET` use the new one. Shopify keeps signing webhooks with the oldest secret until it is revoked and may take up to an hour to switch. The Worker accepts both during that window; remove the old secret after the transition. Keep all values in ignored env files and Cloudflare secrets.

Do not run multiple competing initializations. `ADMIN_TOKEN` grants operator access; keep it secret and rotate it if exposed. Never put a Shopify client secret in `wrangler.jsonc` or the repository.

## Shopify requirements

The app must be installed on both stores with `read_products`, `read_inventory`, `read_locations`, and `write_inventory`. The currently granted scopes were verified on both stores. Shopify's client credentials grant works because both stores and the app belong to the same organization. Direct HTTPS webhooks use the app client secret for HMAC verification; the Google Pub/Sub service account is not used.

## References

- [Cloudflare Durable Objects with SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Shopify webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe)
- [Shopify compare-and-set inventory writes](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities)
