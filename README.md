# Firgelli inventory sync

Sync **available inventory only** for product variants with the same exact SKU in two Shopify stores:

- Primary storefront: `firgelliauto.com` (`admin.shopify.com/store/firgelliautomation`)
- Branch storefront: `firgelli.com` (`admin.shopify.com/store/firgelli1`)

The primary store supplies the initial quantity. After initialization, changes at either store change the shared quantity. Products, prices, descriptions, images, and orders are not copied.

## What is implemented

- A read-only SKU audit and location listing.
- A dry-run bootstrap plan. `--apply` copies eligible primary quantities into the branch using Shopify's compare-and-set mutation, then saves an initial shared state.
- A webhook endpoint that validates Shopify HMAC signatures, deduplicates deliveries, and saves jobs in SQLite.
- A single-worker sync engine that combines quantity changes from both stores, uses idempotent writes, handles stale quantities, and ignores echoes from its own writes.
- A 15-minute catalog reconciliation to detect missed webhook changes for already initialized SKUs.
- A webhook subscription command and unit tests for sales in both stores, echoes, and stale writes.

**Live store behavior is unverified.** Inventory writes require both an explicit write command or enabled sync service and `ALLOW_INVENTORY_WRITES=true`. Leave that variable false until the read-only report and a pilot have been reviewed and the owner explicitly approves inventory changes.

## Information and access needed

1. Permanent domains confirmed by the owner: `firgelliautomation.myshopify.com` and `firgelli1.myshopify.com`.
2. A Shopify app installed on each store, created in the **Dev Dashboard** with Admin API scopes `read_products`, `read_inventory`, `read_locations`, and `write_inventory`. `read_locations` is needed to show location names and confirm which warehouse to sync; without it the location command falls back to IDs. For this API-only service, leave **Embed app in Shopify admin** unchecked and use `https://shopify.dev/apps/default-app-home` as the App URL. If one app can be installed on both stores, use one credential pair twice. If Shopify does not permit that installation for your organization/plan, create one app per store. The app must have permission to update inventory.
3. The app **Client ID** and **Client secret** for each installation. The Client secret is a password-like credential used to request API tokens and verify webhooks. Keep it in a local `.env` file or your hosting provider's secret manager. Do not send it in chat or commit it. This service obtains short-lived access tokens automatically.
   A client secret shared outside the secret manager should be rotated in Dev Dashboard **Settings → Credentials** before use. Because this app has not been deployed, revoke the old secret after the new one is recorded securely.
4. The inventory location in each store used for online sales. Run the `locations` command after credentials are configured, then choose the relevant Location GID. If more than one location supplies the same product, an allocation rule must be designed before live sync.
5. A public HTTPS URL and an always-on host for the webhook server, with persistent disk for the SQLite file. Shopify must be able to POST to `/webhooks/inventory`. Only one server instance may use this SQLite database. A Render Blueprint is included in `render.yaml`.
6. A few matching SKUs for a pilot, ideally in test stores. The audit will show which existing variants are eligible and what needs cleanup.

Client credentials require the app and target store to be in the same Shopify organization. Being owned by the same person alone does not establish this; Shopify will confirm it when the token request runs. If this grant is unavailable, the integration must use OAuth instead.

## Local setup

Requires **Node.js 24 or newer**. No npm install is needed; SQLite is provided by Node.

```powershell
Copy-Item .env.example .env
```

Fill in `MAIN_SHOP`, `CHILD_SHOP`, and the client IDs/secrets in `.env`. Use the permanent `*.myshopify.com` domains. The fields may have the same values for both stores if the same app is installed on both.

```powershell
node --env-file=.env src/audit.mjs locations
```

Copy the selected `gid://shopify/Location/...` values into `MAIN_LOCATION_ID` and `CHILD_LOCATION_ID`. Then run:

```powershell
node --env-file=.env src/audit.mjs audit > audit.json
node --env-file=.env src/bootstrap.mjs > bootstrap-plan.json
node --env-file=.env src/bootstrap.mjs --sku=RC-170 > pilot-plan.json
```

Review `audit.json` and `bootstrap-plan.json`. Exact SKU matches with one tracked, physical variant per store and a selected stocked location are eligible. The exact SKUs in `config/excluded-skus.txt`, negative quantities, nonphysical items, and variants configured to continue selling out of stock are skipped. Review the exclusion list and fix duplicates, missing SKUs, and wrong locations before applying.

## Pilot and live operation

Stop any running sync server before bootstrap. Use one or more exact `--sku=...` filters for a controlled pilot. Only after explicit approval, set `ALLOW_INVENTORY_WRITES=true` for the run and execute:

```powershell
node --env-file=.env src/bootstrap.mjs --apply --sku=RC-170 > pilot-result.json
```

Bootstrap skips any SKU already initialized. Review `errors` and `skipped` in the result. A SKU added after bootstrap needs another bootstrap run to enter the sync set.
After a successful pilot and separate approval for the full set, use `--apply --all` to initialize the remaining eligible SKUs. The command refuses an unfiltered apply without `--all`.

Deploy the server to an always-on HTTPS host. Set `PUBLIC_BASE_URL` to its public HTTPS origin, and `STATE_DB` to a path on persistent storage. Start with `SYNC_ENABLED=false`:

```powershell
node --env-file=.env src/server.mjs
node --env-file=.env src/subscribe.mjs
```

The subscribe command adds `inventory_levels/update` subscriptions on both stores for `PUBLIC_BASE_URL/webhooks/inventory`. It will not duplicate an existing subscription with the same URL. Restart the server with `SYNC_ENABLED=true` only after testing deliveries and approving writes. The `/health` endpoint reports whether sync is enabled.

### Simple hosted option: Render

The included `render.yaml` creates one paid Render web service with a 1 GB persistent disk. It starts with `SYNC_ENABLED=false`, so it can receive webhook jobs but cannot change stock. Render supplies an HTTPS `onrender.com` URL. The free web service is unsuitable because it sleeps and does not support a persistent disk.

1. Review the audit locally using a `.env` file. Review the Render Blueprint and connect this GitHub repository to a Render account. The Blueprint prompts for the app IDs and **rotated** client secrets. Never put secrets in GitHub.
2. Deploy paused and check `https://<service>.onrender.com/health`. It may show zero initialized SKUs at this stage. Set `MAIN_LOCATION_ID`, `CHILD_LOCATION_ID`, and `PUBLIC_BASE_URL` in the Render environment. `PUBLIC_BASE_URL` is the service's HTTPS origin, without `/webhooks/inventory`.
3. Use Render's paid service shell to run `node src/bootstrap.mjs` for the dry-run plan. Only after explicit approval, set `ALLOW_INVENTORY_WRITES=true` and run `node src/bootstrap.mjs --apply --sku=YOUR_PILOT_SKU` for a pilot. A later full initialization requires separate approval and `node src/bootstrap.mjs --apply --all`. These commands use Render environment variables and the mounted SQLite disk.
4. Run `node src/subscribe.mjs` in the same shell after `PUBLIC_BASE_URL` is correct. Confirm Shopify delivers test webhooks.
5. Only after explicit approval, set both `ALLOW_INVENTORY_WRITES=true` and `SYNC_ENABLED=true` in Render and redeploy when ready for live sync. Watch logs for errors and inventory differences.

Shopify's Pub/Sub service account address applies only to a Google Cloud Pub/Sub webhook destination. This project uses direct HTTPS webhooks to Render, so it does not need that address.

Run checks:

```powershell
node --test
```

## Operational behavior and limits

- Any `available` quantity change at either selected location contributes its delta to the shared quantity, including sales, restocks, refunds that restock, and manual stock edits. The primary store is authoritative only during initial bootstrap.
- Shopify webhooks are asynchronous. Two simultaneous purchases of the last unit can oversell before either store receives the other store's change. A safety buffer or central checkout reservation is required if that cannot be tolerated.
- The service monitors only initialized SKUs and one location per store. A new product, changed SKU, moved location, or duplicate SKU requires a new audit and possibly reinitialization.
- Keep the SQLite database on persistent storage and back it up. Do not run multiple workers against it. Stop the service by setting `SYNC_ENABLED=false` or stopping the process if unexpected changes occur.
- Failed writes remain in the SQLite outbox for retry. Monitor the server logs and investigate persistent `retry` or `worker_error` events.
- A computed shared quantity below zero is blocked and logged as `negative_blocked`; it needs manual review rather than an automatic negative inventory write.

## Shopify documentation

- [Client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
- [Admin API product variants](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/productVariants)
- [Inventory management](https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps)
- [Compare-and-set inventory writes](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/inventorySetQuantities)
- [Webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe)
- [Webhook headers](https://shopify.dev/docs/api/webhooks/latest)
