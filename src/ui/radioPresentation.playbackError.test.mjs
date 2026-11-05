import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../i18n/index.js';
import { renderRadioState } from './radioPresentation.js';

function el() {
  const classes = new Set();
  return {
    textContent: '',
    classList: {
      toggle(name, on) {
        on ? classes.add(name) : classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
  };
}

function render(audioError, overrides = {}) {
  globalThis.document = { getElementById: () => null, activeElement: null };
  const host = {
    destroyed: false,
    _radioPanel: el(),
    _radioPlaybackState: el(),
    _syncContextRadioLauncherState() {},
    actions: {
      getLifecycle: () => null,
      preservePanelStateDuringClear: () => false,
      setPanelCollapsed() {},
      scheduleLayout() {},
    },
  };
  renderRadioState.call(host, {
    enabled: true,
    audioState: 'error',
    audioError,
    filteredCount: 1,
    stationCount: 1,
    volume: 1,
    ...overrides,
  });
  return host._radioPlaybackState.textContent;
}

const PLAYBACK_ERRORS = [
  'Playback requires a direct click or tap.',
  'Broadcaster stream could not be started.',
  'Broadcaster stream is unavailable or blocked by the browser.',
];

for (const locale of ['es', 'ru']) {
  test(`radio playback errors are localized in ${locale}`, () => {
    setLocale(locale);
    try {
      for (const message of PLAYBACK_ERRORS) {
        assert.notEqual(render(message), message, `${locale}: ${message}`);
      }
      // Control: the fallback (no audioError) is translated.
      assert.notEqual(render(null), 'Broadcaster stream unavailable');
    } finally {
      setLocale('en');
    }
  });
}

test('radio playback errors stay English', () => {
  setLocale('en');
  for (const message of PLAYBACK_ERRORS) {
    assert.equal(render(message), message);
  }
  assert.equal(render(null), 'Broadcaster stream unavailable');
});

test('playing Radio reports voice mute and restoration instead of ordinary playback', () => {
  const state = { audioState: 'playing', selected: { name: 'Test Radio' }, selectedIndex: 0 };
  assert.equal(render(null, { ...state, voiceDucked: true }), 'Muted for voice');
  assert.equal(render(null, { ...state, voiceRestoring: true }), 'Restoring volume…');
  assert.equal(render(null, state), 'Playing Test Radio');
});

test('voice volume flags do not obscure pause, stop, connection or playback failure', () => {
  for (const flags of [{ voiceDucked: true }, { voiceRestoring: true }]) {
    assert.equal(render(null, { audioState: 'paused', ...flags }), 'Paused station');
    assert.equal(render(null, { audioState: 'stopped', ...flags }), 'Ready — playback starts only from your action');
    assert.equal(render(null, { audioState: 'loading', ...flags }), 'Connecting directly to broadcaster…');
    assert.equal(render(null, { audioState: 'buffering', ...flags }), 'Buffering broadcaster stream…');
    assert.equal(render('Broadcaster stream could not be started.', flags), 'Broadcaster stream could not be started.');
  }
});
