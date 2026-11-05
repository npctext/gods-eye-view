import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordingControls } from './recordingControls.js';

function setup() {
  const oldDocument = globalThis.document;
  const classList = { toggle() {}, add() {}, remove() {} };
  globalThis.document = { body: { classList }, getElementById: () => ({ classList }) };
  let variant = 'minimal', mode = 'auto';
  const calls = [];
  const controls = new RecordingControls({ syncShareState() {} });
  controls.hud = {
    visible: true,
    getMode: () => mode, getVariant: () => variant,
    setMode: value => { calls.push(['mode', value]); mode = value; },
    setVariant: value => { calls.push(['variant', value]); variant = value; },
  };
  return { controls, calls, cleanup() { controls.destroy(); globalThis.document = oldDocument; } };
}

test('scene preview keeps the current HUD and a later manual theme change on exit', () => {
  const { controls, calls, cleanup } = setup();
  try {
    controls.setRecordingMode(true, { hudMode: 'full', preserveHud: true });
    assert.deepEqual(calls, []);
    controls.hud.setVariant('retro');
    calls.length = 0;
    controls.setRecordingMode(false);
    assert.deepEqual(calls, []);
    assert.equal(controls.hud.getVariant(), 'retro');
  } finally { cleanup(); }
});

test('ordinary recording still changes and restores the HUD', () => {
  const { controls, cleanup } = setup();
  try {
    controls.setRecordingMode(true, { hudMode: 'full' });
    assert.equal(controls.hud.getVariant(), 'tactical');
    assert.equal(controls.hud.getMode(), 'on');
    controls.setRecordingMode(false);
    assert.equal(controls.hud.getVariant(), 'minimal');
    assert.equal(controls.hud.getMode(), 'auto');
  } finally { cleanup(); }
});
