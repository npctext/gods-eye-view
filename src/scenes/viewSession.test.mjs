import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneViewSession } from './viewSession.js';
import { DataLayerManager } from '../data/manager.js';

function setup() {
  const manager = new DataLayerManager({});
  const modules = {};
  for (const id of ['flights', 'traffic']) {
    let params = { density: 1, selectedFlightsTrackingId: null };
    modules[id] = {
      id, name: id, updateInterval: -1,
      async init() {}, enable() {}, disable() {}, async update() {},
      getStats: () => ({ count: 0 }),
      getParams: () => ({ ...params }),
      setParams: next => { params = { ...params, ...next }; return true; },
    };
    manager.register(modules[id]);
  }
  manager.finalizeRegistrations(Object.keys(modules).map(id => ({ id, disposition: 'enabled+options' })));
  let visual = { style: 'normal', hud: { variant: 'minimal', visible: true } };
  const visuals = [], statuses = [];
  const director = {
    dataManager: manager,
    _pendingWork: new Set(),
    _waitForRunIdle: async () => {},
    _captureLayerStates: () => Object.fromEntries(manager.getAll().map(({ id, enabled }) => [id, { enabled, params: manager.getLayerParams(id) }])),
    _updateStatus: message => statuses.push(message),
    styleManager: {
      getVisualState: () => structuredClone(visual),
      applyVisualState: async (value, { isCurrent }) => {
        if (isCurrent()) { visuals.push(value); visual = { ...visual, ...value }; }
      },
    },
  };
  const session = createSceneViewSession(director);
  return { manager, modules, director, session, visuals, statuses, getVisual: () => visual };
}

test('one snapshot restores layers and map effects without HUD or camera tracking', async () => {
  const { manager, session, director, visuals } = setup();
  await manager.setEnabled('traffic', true);
  manager.setLayerParams('flights', { selectedFlightsTrackingId: 'original-flight' });
  session.begin();
  await manager.setEnabled('traffic', false, { origin: 'scene' });
  await manager.setEnabled('flights', true, { origin: 'scene' });
  manager.setLayerParams('flights', { density: 4, selectedFlightsTrackingId: null }, { origin: 'scene' });
  await director.styleManager.applyVisualState({ style: 'thermal', hud: { variant: 'tactical' } }, { isCurrent: () => true });
  session.begin();
  assert.equal(await session.restore(), true);
  assert.equal(manager.isEnabled('traffic'), true);
  assert.equal(manager.isEnabled('flights'), false);
  assert.equal(manager.getLayerParams('flights').density, 1);
  assert.equal(manager.getLayerParams('flights').selectedFlightsTrackingId, null);
  assert.deepEqual(visuals.at(-1), { style: 'normal' });
  assert.equal(session.restoring, null);
  session.destroy();
});

for (const origin of ['user', 'voice', 'tool']) {
  test(`manual ${origin} choices survive subsequent scene writes`, async () => {
    const { manager, session } = setup();
    session.begin();
    await manager.setEnabled('flights', true, { origin });
    manager.setLayerParams('flights', { density: 7 }, { origin });
    await manager.setEnabled('flights', false, { origin: 'scene' });
    manager.setLayerParams('flights', { density: 2 }, { origin: 'scene' });
    assert.equal(await session.restore(), true);
    assert.equal(manager.isEnabled('flights'), true);
    assert.equal(manager.getLayerParams('flights').density, 7);
    session.destroy();
  });
}

test('restoration waits for pending scene cleanup and is idempotent', async () => {
  const { manager, director, session, visuals } = setup();
  session.begin();
  let finish;
  director._pendingWork.add(new Promise(resolve => { finish = resolve; }));
  await manager.setEnabled('flights', true, { origin: 'scene' });
  const restoring = session.restore();
  assert.equal(session.restore(), restoring);
  await new Promise(setImmediate);
  assert.equal(manager.isEnabled('flights'), true);
  assert.equal(visuals.length, 0);
  finish();
  await restoring;
  assert.equal(manager.isEnabled('flights'), false);
  assert.equal(visuals.length, 1);
  session.destroy();
});

test('new manual intent wins over an in-flight restore', async () => {
  const { manager, modules, session } = setup();
  await manager.setEnabled('flights', true);
  session.begin();
  await manager.setEnabled('flights', false, { origin: 'scene' });
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  modules.flights.enable = async () => { entered(); await gate; };
  const restoring = session.restore();
  await started;
  const manual = manager.setEnabled('flights', false, { origin: 'user' });
  release();
  await Promise.all([restoring, manual]);
  assert.equal(manager.isEnabled('flights'), false);
  session.destroy();
});

test('pending manual enable is not replaced by a restoration request', async () => {
  const { manager, modules, session } = setup();
  session.begin();
  let release;
  modules.flights.enable = () => new Promise(resolve => { release = resolve; });
  const manual = manager.setEnabled('flights', true, { origin: 'user' });
  while (!release) await new Promise(setImmediate);
  assert.equal(await session.restore(), true);
  release();
  assert.equal(await manual, true);
  assert.equal(manager.isEnabled('flights'), true);
  session.destroy();
});

test('a user-adopted scene layer remains enabled on exit', async () => {
  const { manager, session } = setup();
  session.begin();
  await manager.setEnabled('flights', true, { origin: 'scene' });
  assert.equal(manager.adoptLayerVisibility('flights', true, { origin: 'user' }), true);
  await session.restore();
  assert.equal(manager.isEnabled('flights'), true);
  session.destroy();
});

test('restoring an enabled layer uses passive intent rather than scene authority', async () => {
  const { manager, session } = setup();
  await manager.setEnabled('flights', true);
  session.begin();
  await manager.setEnabled('flights', false, { origin: 'scene' });
  const origins = [];
  const unsubscribe = manager.subscribeVisibilityRequests(({ origin }) => { origins.push(origin); });
  await session.restore();
  assert.deepEqual(origins, ['local-restore']);
  unsubscribe();
  session.destroy();
});

test('a refused restore reports the layer and still restores other layers and effects', async () => {
  const { manager, session, visuals, statuses } = setup();
  await manager.setEnabled('flights', true);
  session.begin();
  await manager.setEnabled('flights', false, { origin: 'scene' });
  await manager.setEnabled('traffic', true, { origin: 'scene' });
  manager.addVisibilityGuard(({ layerId, enabled }) => layerId === 'flights' && enabled ? 'offline' : null);
  assert.equal(await session.restore(), false);
  assert.equal(manager.isEnabled('traffic'), false);
  assert.equal(visuals.at(-1).style, 'normal');
  assert.match(statuses.at(-1), /flights/);
  session.destroy();
});

test('destroy during pending cleanup prevents all later writes and unsubscribes', async () => {
  const { manager, director, session, visuals } = setup();
  session.begin();
  let finish;
  director._pendingWork.add(new Promise(resolve => { finish = resolve; }));
  await manager.setEnabled('flights', true, { origin: 'scene' });
  const restoring = session.restore();
  session.destroy();
  finish();
  assert.equal(await restoring, false);
  assert.equal(visuals.length, 0);
  assert.equal(manager.isEnabled('flights'), true);
  assert.equal(manager._visibilityRequestListeners.size, 0);
  assert.equal(manager._listeners.size, 0);
});
