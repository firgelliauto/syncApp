import test from 'node:test';
import assert from 'node:assert/strict';
import { openState } from '../src/state.mjs';
import { createEngine } from '../src/engine.mjs';

function setup(start = 10) {
  const state = openState(':memory:');
  state.seed('SKU', 'main-item', 'child-item', start);
  const actual = { main: start, child: start };
  const shops = { main: { side: 'main' }, child: { side: 'child' } };
  const locations = { main: 'main-location', child: 'child-location' };
  const readQuantity = async shop => actual[shop.side];
  const writeQuantity = async (shop, write) => {
    if (actual[shop.side] !== write.from) {
      const error = new Error('stale');
      error.codes = ['CHANGE_FROM_QUANTITY_STALE'];
      throw error;
    }
    actual[shop.side] = write.to;
  };
  const engine = createEngine({ state, shops, locations, readQuantity, writeQuantity,
    onLog: () => {} });
  return { state, actual, engine };
}

async function drain(engine) {
  for (let i = 0; i < 20; i++) if (!await engine.tick()) return;
  throw new Error('queue did not drain');
}

test('primary sale copies the delta; echo webhook causes no second decrement', async () => {
  const { state, actual, engine } = setup();
  actual.main = 9;
  state.enqueue('sale-main', 'SKU');
  await drain(engine);
  assert.deepEqual(actual, { main: 9, child: 9 });
  state.enqueue('echo-child', 'SKU');
  await drain(engine);
  assert.deepEqual(actual, { main: 9, child: 9 });
  assert.equal(state.getSku('SKU').shared_qty, 9);
  state.close();
});

test('pausing leaves a planned write pending until resumed', async () => {
  const state = openState(':memory:');
  state.seed('SKU', 'main-item', 'child-item', 10);
  state.enqueue('main-sale', 'SKU');
  const actual = { main: 9, child: 10 };
  let allowed = true;
  let writes = 0;
  const engine = createEngine({ state, shops: { main: { side: 'main' }, child: { side: 'child' } },
    locations: { main: 'm', child: 'c' }, canProcess: () => allowed,
    readQuantity: async shop => actual[shop.side],
    writeQuantity: async (shop, write) => { writes++; actual[shop.side] = write.to; },
    onLog: () => {} });
  await engine.tick();
  allowed = false;
  assert.equal(await engine.tick(), false);
  assert.equal(writes, 0);
  assert.deepEqual(actual, { main: 9, child: 10 });
  allowed = true;
  await drain(engine);
  assert.deepEqual(actual, { main: 9, child: 9 });
  state.close();
});

test('sales in both stores combine when each is observed before the next', async () => {
  const { state, actual, engine } = setup();
  actual.main = 9;
  state.enqueue('sale-main', 'SKU');
  await drain(engine);
  actual.child = 8;
  state.enqueue('sale-child', 'SKU');
  await drain(engine);
  assert.deepEqual(actual, { main: 8, child: 8 });
  assert.equal(state.getSku('SKU').shared_qty, 8);
  state.close();
});

test('two store decreases are treated as ambiguous and never double deducted', async () => {
  const { state, actual, engine } = setup(433);
  const events = [];
  const guarded = createEngine({ state,
    shops: { main: { side: 'main' }, child: { side: 'child' } },
    locations: { main: 'm', child: 'c' },
    readQuantity: async shop => actual[shop.side],
    writeQuantity: async () => { throw new Error('Should not write ambiguous stock'); },
    onLog: event => events.push(event) });
  actual.main = 430;
  actual.child = 430;
  state.enqueue('main-sale', 'SKU');
  state.enqueue('child-change', 'SKU');
  await drain(guarded);
  assert.deepEqual(actual, { main: 430, child: 430 });
  assert.equal(state.hasWrite('SKU'), false);
  assert.ok(events.some(event => event.type === 'ambiguous_change'));
  state.close();
});

test('stale compare-and-set rescans and keeps the intervening sale', async () => {
  const { state, actual, engine } = setup();
  actual.main = 9;
  state.enqueue('sale-main', 'SKU');
  await engine.tick(); // plan branch write from 10 to 9
  actual.child = 9; // branch purchase before the planned write
  await drain(engine);
  assert.deepEqual(actual, { main: 8, child: 8 });
  state.close();
});

test('pending write can be replayed with its original idempotency key', async () => {
  const state = openState(':memory:');
  state.seed('SKU', 'main-item', 'child-item', 10);
  const actual = { main: 9, child: 10 };
  const applied = new Set();
  let first = true;
  const options = { state, shops: { main: { side: 'main' }, child: { side: 'child' } },
    locations: { main: 'm', child: 'c' }, onLog: () => {},
    readQuantity: async shop => actual[shop.side],
    writeQuantity: async (shop, write) => {
      if (!applied.has(write.key)) {
        actual[shop.side] = write.to;
        applied.add(write.key);
      }
      if (first) { first = false; throw new Error('response lost'); }
    } };
  const engine = createEngine(options);
  state.enqueue('sale', 'SKU');
  await engine.tick();
  await engine.tick();
  assert.equal(actual.child, 9);
  state.db.prepare('UPDATE writes SET next_at = 0').run();
  await drain(createEngine(options));
  assert.equal(state.getSku('SKU').child_qty, 9);
  assert.equal(applied.size, 1);
  state.close();
});

test('does not write a negative shared quantity', async () => {
  const { state, actual, engine } = setup(1);
  actual.main = 0;
  actual.child = 0;
  state.enqueue('simultaneous-last-unit-sales', 'SKU');
  await drain(engine);
  assert.deepEqual(actual, { main: 0, child: 0 });
  assert.equal(state.getSku('SKU').shared_qty, 1);
  state.close();
});
