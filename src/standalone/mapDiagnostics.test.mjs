import test from 'node:test';
import assert from 'node:assert/strict';
import { installMapDiagnostics, redactDiagnosticText, summarizeDiagnosticPixels } from './mapDiagnostics.js';

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
  };
}
function event() {
  const listeners = new Set();
  return { listeners, addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); }, raise(...args) { for (const fn of listeners) fn(...args); } };
}
function fixture(hasViewer = true) {
  let now = 0, destroyed = false, reads = 0, appState = { status: 'ready', phase: null };
  const subscriptions = new Set(), intervals = new Map();
  const canvas = Object.assign(target(), { width: 824, height: 1830, clientWidth: 412, clientHeight: 915, tagName: 'CANVAS', getBoundingClientRect: () => ({ x: 0, y: 0, width: 412, height: 915 }) });
  const provider = { errorEvent: event() };
  const layer = { imageryProvider: provider };
  const gl = { VERSION: 1, SHADING_LANGUAGE_VERSION: 2, VENDOR: 3, RENDERER: 4, isContextLost: () => false, getExtension: () => null, getParameter: value => 'gpu-' + value, getContextAttributes: () => ({ preserveDrawingBuffer: true }) };
  const scene = {
    canvas, context: { _gl: gl }, postRender: event(), renderError: event(), requestRenderMode: true,
    requestRender() { throw Error('Diagnostics must never render'); },
    imageryLayers: { length: 1, get: () => layer, layerAdded: event(), layerRemoved: event() },
    globe: { show: true, tilesLoaded: true }, mode: 3,
  };
  const viewer = { scene, isDestroyed: () => destroyed, useDefaultRenderLoop: true };
  const mapListeners = new Set();
  const component = { viewer, mapStackController: { getActiveId: () => 'esri-imagery', subscribe(fn) { mapListeners.add(fn); return () => mapListeners.delete(fn); } }, tileset: { tilesLoaded: true, tileFailed: event(), loadProgress: event() } };
  const application = {
    getComponents: () => hasViewer ? { scene: component } : {},
    getState: () => appState,
    subscribe(fn) { subscriptions.add(fn); fn(appState); return () => subscriptions.delete(fn); },
  };
  const documentRef = Object.assign(target(), {
    visibilityState: 'visible', body: { dataset: {}, classList: { contains: () => false }, append() {} },
    getElementById: () => null,
    createElement: () => ({ getContext: () => ({ drawImage() { reads++; }, getImageData: () => ({ data: new Uint8ClampedArray([20, 30, 40, 255]) }) }) }),
  });
  const windowRef = Object.assign(target(), {
    navigator: { userAgent: 'Chrome test', onLine: true }, location: { protocol: 'http:' },
    innerWidth: 412, innerHeight: 915, devicePixelRatio: 2, performance: { now: () => now },
    setInterval(fn) { intervals.set(1, fn); return 1; }, clearInterval(id) { intervals.delete(id); },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', zIndex: 'auto', transform: 'none', filter: 'none', backdropFilter: 'none', mixBlendMode: 'normal' }),
  });
  const api = installMapDiagnostics({ application, documentRef, windowRef, getGovernor: () => ({ mode: 'idle', holds: [] }) });
  return {
    api, scene, canvas, provider, component, windowRef, documentRef, subscriptions, intervals, mapListeners,
    get reads() { return reads; },
    tick() { now += 2000; intervals.get(1)?.(); },
    status(status) { appState = { status, phase: null }; for (const fn of subscriptions) fn(appState); },
    destroyViewer() { destroyed = true; },
  };
}

test('passive sampling tracks rendered frames without requesting frames or reading pixels', () => {
  const f = fixture();
  f.scene.postRender.raise();
  f.tick();
  assert.equal(f.reads, 0);
  const report = f.api.capture();
  assert.equal(report.current.renders, 1);
  assert.equal(report.current.renderAgeMs, 2000);
  assert.equal(report.current.requestRenderMode, true);
  assert.equal(report.current.renderLoop, true);
  assert.equal(report.current.governor.mode, 'idle');
  assert.equal(f.reads, 1);
  f.api.destroy();
});

test('context, rendering and imagery failures are retained with credentials removed', () => {
  const f = fixture();
  f.canvas.fire('webglcontextlost');
  f.scene.renderError.raise(f.scene, new Error('Failed https://tiles.googleapis.com/v1/root.json?key=secret-123#token'));
  f.provider.errorEvent.raise({ message: 'Authorization: Bearer hidden-456' });
  f.windowRef.fire('unhandledrejection', { reason: new Error('access_token=hidden-789') });
  const report = f.api.capture();
  assert.ok(report.events.some(item => item.type === 'context-lost'));
  assert.ok(report.events.some(item => item.type === 'render-error'));
  assert.ok(report.events.some(item => item.type === 'imagery-error'));
  const json = JSON.stringify(report);
  for (const value of ['secret-123', 'hidden-456', 'hidden-789', '?key=', '#token']) assert.ok(!json.includes(value), value);
  f.api.destroy();
});

test('pre-menu state remains available after the menu changes the screen', () => {
  const f = fixture();
  f.documentRef.fire('pointerdown', { target: { closest: () => ({}) } });
  f.documentRef.body.dataset.mobileSheet = 'more';
  const report = f.api.capture();
  assert.equal(report.beforeInteraction.ui.sheet, null);
  assert.equal(report.current.ui.sheet, 'more');
  assert.equal(f.reads, 1, 'no readback before menu action');
  f.api.destroy();
});

test('bounded history and complete cleanup prevent listener and timer accumulation', () => {
  const f = fixture();
  for (let i = 0; i < 180; i++) { f.tick(); f.canvas.fire('webglcontextrestored'); }
  const report = f.api.capture();
  assert.equal(report.samples.length, 60);
  assert.equal(report.events.length, 100);
  f.status('destroyed');
  f.api.destroy();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.subscriptions.size, 0);
  assert.equal(f.scene.postRender.listeners.size, 0);
  assert.equal(f.provider.errorEvent.listeners.size, 0);
  assert.equal(f.mapListeners.size, 0);
  assert.equal(f.windowRef.__gevMapDiagnostics, undefined);
  for (const node of [f.windowRef, f.documentRef, f.canvas]) for (const callbacks of node.listeners.values()) assert.equal(callbacks.size, 0);
});

test('startup failures can be reported even when no viewer was constructed', () => {
  const f = fixture(false);
  f.api.recordError('startup-error', new SyntaxError('unsupported selector'));
  f.status('failed');
  const report = f.api.capture();
  assert.equal(report.current.viewerPresent, false);
  assert.equal(report.current.application.status, 'failed');
  assert.equal(report.canvasPixelsAtExport, null);
  assert.ok(report.events.some(item => item.type === 'startup-error'));
  f.api.destroy();
});

test('pixel summaries distinguish empty, black and colored buffers without exporting an image', () => {
  assert.equal(summarizeDiagnosticPixels(new Uint8ClampedArray()).pixels, 0);
  const black = summarizeDiagnosticPixels(new Uint8ClampedArray([0, 0, 0, 255]));
  assert.equal(black.nonBlackRatio, 0);
  assert.equal(black.opaqueRatio, 1);
  assert.equal(summarizeDiagnosticPixels(new Uint8ClampedArray([255, 0, 0, 255])).nonBlackRatio, 1);
  assert.ok(!redactDiagnosticText('AIza' + 'x'.repeat(35)).includes('AIza'));
  for (const value of ['key=hidden', '"apiKey": "hidden"', "'refresh_token': 'hidden'"])
    assert.ok(!redactDiagnosticText(value).includes('hidden'));
});
