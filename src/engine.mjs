import { randomUUID } from 'node:crypto';
import { getQuantity, setQuantity } from './shopify.mjs';

export function createEngine({ state, shops, locations, onLog = console.log,
  readQuantity = getQuantity, writeQuantity = setQuantity }) {
  async function scanSku(sku) {
    const row = state.getSku(sku);
    if (!row || state.hasWrite(sku)) return;
    const [main, child] = await Promise.all([
      readQuantity(shops.main, row.main_item, locations.main, sku),
      readQuantity(shops.child, row.child_item, locations.child, sku)
    ]);
    if (!Number.isInteger(main) || !Number.isInteger(child)) {
      throw new Error(`${sku}: inventory level unavailable; check selected locations`);
    }
    const target = row.shared_qty + (main - row.main_qty) + (child - row.child_qty);
    if (target < 0) {
      onLog({ type: 'negative_blocked', sku, main, child, target,
        message: `Combined stock would be ${target}; no quantity was written` });
      return;
    }
    const writes = [];
    if (main !== target) writes.push({ id: randomUUID(), side: 'main', from: main, to: target });
    if (child !== target) writes.push({ id: randomUUID(), side: 'child', from: child, to: target });
    state.plan(sku, { main, child }, target, writes);
    if (main !== row.main_qty || child !== row.child_qty) {
      onLog({ type: 'change', sku, mainDelta: main - row.main_qty,
        childDelta: child - row.child_qty, target,
        message: `Main ${main - row.main_qty >= 0 ? '+' : ''}${main - row.main_qty}, child ${child - row.child_qty >= 0 ? '+' : ''}${child - row.child_qty}; shared target ${target}` });
    }
  }

  async function processWrite(write) {
    const row = state.getSku(write.sku);
    const side = write.side;
    try {
      await writeQuantity(shops[side], { inventoryItemId: side === 'main' ? row.main_item : row.child_item,
        locationId: locations[side], from: write.from_qty, to: write.to_qty, key: write.id });
      state.completeWrite(write);
      onLog({ type: 'write', sku: write.sku, side, from: write.from_qty, to: write.to_qty,
        message: 'Shopify confirmed the inventory update' });
    } catch (error) {
      if (error.codes?.includes('CHANGE_FROM_QUANTITY_STALE')) {
        state.cancelWrites(write.sku);
        state.enqueue(randomUUID(), write.sku);
        onLog({ type: 'stale', sku: write.sku, side, from: write.from_qty,
          to: write.to_qty, message: error.message });
      } else {
        state.retryWrite(write.id, error.message, write.attempts + 1);
        onLog({ type: 'retry', sku: write.sku, side, from: write.from_qty,
          to: write.to_qty, message: error.message });
      }
    }
  }

  async function tick() {
    const write = state.nextWrite();
    if (write) { await processWrite(write); return true; }
    const job = state.nextJob();
    if (!job) return false;
    try { await scanSku(job.sku); }
    catch (error) {
      onLog({ type: 'scan_error', sku: job.sku, message: error.message });
      throw error;
    }
    state.markJobDone(job.id);
    return true;
  }

  return { scanSku, tick };
}
