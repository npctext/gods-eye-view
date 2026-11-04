import { getRenderGovernorDiagnostics } from '../renderGovernor.js';

const SAMPLE_LIMIT = 60;
const EVENT_LIMIT = 100;
const RESOURCE_LIMIT = 60;

// Keep credentials and query strings out of reports, including provider errors.
export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try { return new URL(value).origin + '/[resource]'; } catch { return '[url]'; }
    })
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:api[_-]?key|key|(?:access|refresh)[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*["']?[^\s,"';]+/gi, '[credential redacted]')
    .replace(/AIza[\w-]{30,}/g, '[key redacted]')
    .slice(0, 1200);
}

export function summarizeDiagnosticPixels(data) {
  let total = 0, maximum = 0, nonBlack = 0, opaque = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.max(data[i], data[i + 1], data[i + 2]);
    total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    maximum = Math.max(maximum, value);
    if (value > 8) nonBlack++;
    if (data[i + 3] === 255) opaque++;
  }
  return { pixels: count, meanRGB: count ? Math.round(total / count) : 0, maximum, nonBlackRatio: count ? nonBlack / count : 0, opaqueRatio: count ? opaque / count : 0 };
}

/** Passive, bounded diagnostics. Never requests a frame or changes WebGL state. */
export function installMapDiagnostics({ application, windowRef = window, documentRef = document, getGovernor = getRenderGovernorDiagnostics }) {
  const samples = [], events = [], resources = [], removers = [], sceneRemovers = [];
  const providerRemovers = new Map();
  let observedViewer = null, disposed = false, beforeInteraction = null;
  let renders = 0, lastRender = null, tileProgress = null;
  let resourceObserver = null;
  const time = () => Math.round(windowRef.performance.now());
  const startedAt = new Date().toISOString();
  const push = (list, value, limit) => { list.push(value); if (list.length > limit) list.shift(); };
  const record = (type, details = {}) => { if (!disposed) push(events, { at: time(), type, ...details }, EVENT_LIMIT); };
  const errorDetails = (error) => ({
    name: redactDiagnosticText(error?.name || 'Error'),
    message: redactDiagnosticText(error?.message ?? error),
    stack: redactDiagnosticText(error?.stack || ''),
  });
  const recordError = (type, error) => record(type, errorDetails(error));
  const listen = (node, name, callback, options, bucket = removers) => {
    node?.addEventListener(name, callback, options);
    bucket.push(() => node?.removeEventListener(name, callback, options));
  };
  const subscribe = (event, callback, bucket = sceneRemovers) => {
    const remove = event?.addEventListener(callback);
    if (typeof remove === 'function') bucket.push(remove);
  };
  const parts = () => application.getComponents().scene;
  const viewer = () => {
    const value = parts()?.viewer;
    return value && !value.isDestroyed() ? value : null;
  };
  const watchProvider = (layer) => {
    if (providerRemovers.has(layer)) return;
    const remove = layer?.imageryProvider?.errorEvent?.addEventListener(error => recordError('imagery-error', error));
    if (typeof remove === 'function') providerRemovers.set(layer, remove);
  };
  const attach = () => {
    const current = viewer();
    if (current === observedViewer) return;
    for (const remove of sceneRemovers.splice(0)) remove();
    for (const remove of providerRemovers.values()) remove();
    providerRemovers.clear();
    observedViewer = current;
    if (!current) return;
    const scene = current.scene;
    subscribe(scene.postRender, () => { renders++; lastRender = time(); });
    subscribe(scene.renderError, (_, error) => recordError('render-error', error));
    listen(scene.canvas, 'webglcontextlost', () => record('context-lost'), false, sceneRemovers);
    listen(scene.canvas, 'webglcontextrestored', () => record('context-restored'), false, sceneRemovers);
    subscribe(parts()?.tileset?.tileFailed, error => recordError('3d-tile-error', error));
    subscribe(parts()?.tileset?.loadProgress, (pending, processing) => { tileProgress = { pending, processing }; });
    for (let i = 0; i < scene.imageryLayers.length; i++) watchProvider(scene.imageryLayers.get(i));
    subscribe(scene.imageryLayers.layerAdded, watchProvider);
    subscribe(scene.imageryLayers.layerRemoved, layer => { providerRemovers.get(layer)?.(); providerRemovers.delete(layer); });
    const removeMap = parts()?.mapStackController?.subscribe(state => record('map-source', { id: state.activeId, status: state.status, error: redactDiagnosticText(state.lastError) }));
    if (removeMap) sceneRemovers.push(removeMap);
    record('viewer-attached');
  };
  const viewport = () => ({
    width: windowRef.innerWidth, height: windowRef.innerHeight, dpr: windowRef.devicePixelRatio,
    visual: windowRef.visualViewport ? { width: windowRef.visualViewport.width, height: windowRef.visualViewport.height, scale: windowRef.visualViewport.scale } : null,
  });
  const snapshot = () => {
    const current = viewer(), scene = current?.scene, canvas = scene?.canvas;
    const governor = getGovernor();
    return {
      at: time(), application: application.getState(), visibility: documentRef.visibilityState, online: windowRef.navigator.onLine,
      viewport: viewport(), viewerPresent: !!current, contextLost: scene?.context?._gl?.isContextLost() ?? null,
      renderLoop: current?.useDefaultRenderLoop ?? null, requestRenderMode: scene?.requestRenderMode ?? null,
      renders, lastRender, renderAgeMs: lastRender === null ? null : time() - lastRender,
      governor: { mode: governor.mode, holds: governor.holds },
      canvas: canvas ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight } : null,
      sceneMode: scene?.mode ?? null, globeVisible: scene?.globe?.show ?? null, globeTilesLoaded: scene?.globe?.tilesLoaded ?? null,
      photorealTilesLoaded: parts()?.tileset?.tilesLoaded ?? null, tileProgress,
      imageryLayers: scene?.imageryLayers?.length ?? null, mapSource: parts()?.mapStackController?.getActiveId() ?? null,
      ui: { sheet: documentRef.body?.dataset.mobileSheet ?? null, clean: !!documentRef.body?.classList.contains('ui-clean-view') },
    };
  };
  // Diagnostics must not interrupt application startup or event dispatch.
  const safe = callback => (...args) => {
    if (disposed) return;
    try { return callback(...args); } catch (error) { recordError('diagnostics-error', error); }
  };
  const sample = safe(() => { attach(); push(samples, snapshot(), SAMPLE_LIMIT); });
  const appearance = () => {
    const canvas = viewer()?.scene?.canvas;
    const nodes = [canvas, canvas?.parentElement, documentRef.getElementById('cesiumContainer'), ...['world-overlay-root', 'world-overlay-detection-surface', 'scope-mask', 'loading-screen', 'mobile-settings-backdrop'].map(id => documentRef.getElementById(id))];
    return nodes.filter(Boolean).map(node => {
      const style = windowRef.getComputedStyle(node), rect = node.getBoundingClientRect();
      return {
        node: node.id || node.className || node.tagName,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        display: style.display, visibility: style.visibility, opacity: style.opacity, zIndex: style.zIndex,
        transform: style.transform, filter: style.filter, backdropFilter: style.backdropFilter, mixBlendMode: style.mixBlendMode,
      };
    });
  };
  const gpu = () => {
    const gl = viewer()?.scene?.context?._gl;
    if (!gl || gl.isContextLost()) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
      renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), attributes: gl.getContextAttributes(),
    };
  };
  const pixels = () => {
    // One 32px readback only when saving. No image or coordinates are exported.
    const source = viewer()?.scene?.canvas;
    if (!source) return null;
    const canvas = documentRef.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, 32, 32);
    return { at: time(), ...summarizeDiagnosticPixels(context.getImageData(0, 0, 32, 32).data) };
  };
  const optional = callback => { try { return callback(); } catch (error) { return { unavailable: redactDiagnosticText(error.message) }; } };
  const capture = () => {
    sample();
    const connection = windowRef.navigator.connection;
    return {
      schemaVersion: 1, startedAt, capturedAt: new Date().toISOString(),
      environment: {
        userAgent: windowRef.navigator.userAgent, secureContext: windowRef.isSecureContext,
        protocol: windowRef.location.protocol, connection: connection ? { effectiveType: connection.effectiveType, rtt: connection.rtt, downlink: connection.downlink, saveData: connection.saveData } : null,
      },
      current: optional(snapshot), beforeInteraction, appearance: optional(appearance), gpu: optional(gpu), canvasPixelsAtExport: optional(pixels),
      samples: [...samples], events: [...events], resources: [...resources],
    };
  };
  const download = () => {
    const report = capture();
    const url = windowRef.URL.createObjectURL(new windowRef.Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = documentRef.createElement('a');
    link.href = url;
    link.download = 'gev-map-diagnostics-' + report.capturedAt.replace(/[:.]/g, '-') + '.json';
    documentRef.body.append(link);
    link.click();
    link.remove();
    windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 30000);
  };
  listen(windowRef, 'error', event => recordError('window-error', event.error || event.message));
  listen(windowRef, 'unhandledrejection', event => recordError('unhandled-rejection', event.reason));
  for (const name of ['online', 'offline', 'resize', 'pageshow', 'pagehide']) listen(windowRef, name, safe(() => { record(name); sample(); }));
  listen(documentRef, 'visibilitychange', safe(() => { record('visibility', { value: documentRef.visibilityState }); sample(); }));
  listen(windowRef.visualViewport, 'resize', safe(() => { record('visual-viewport'); sample(); }));
  listen(documentRef, 'pointerdown', safe(event => {
    if (!event.target?.closest?.('.mobile-header-settings, .mobile-tab, .mobile-map-more')) return;
    beforeInteraction = { ...snapshot(), appearance: appearance() };
    record('before-ui-interaction');
  }), true);
  if (windowRef.PerformanceObserver) {
    try {
      resourceObserver = new windowRef.PerformanceObserver(list => {
        for (const item of list.getEntries()) {
          const url = new URL(item.name);
          if (!/(?:googleapis\.com|arcgisonline\.com|openstreetmap\.org|cesium\.com|cesiumassets\.com)$/.test(url.hostname) && url.pathname !== '/api/google/tiles-token') continue;
          push(resources, { at: Math.round(item.startTime), host: url.hostname, durationMs: Math.round(item.duration), status: item.responseStatus || null, transferredBytes: item.transferSize, type: item.initiatorType }, RESOURCE_LIMIT);
        }
      });
      resourceObserver.observe({ type: 'resource', buffered: true });
    } catch { resourceObserver = null; }
  }
  const interval = windowRef.setInterval(sample, 2000);
  const api = {
    capture, download, recordError,
    destroy() {
      if (disposed) return;
      disposed = true;
      windowRef.clearInterval(interval);
      resourceObserver?.disconnect();
      for (const remove of [...removers, ...sceneRemovers, ...providerRemovers.values()]) remove();
      providerRemovers.clear();
      if (windowRef.__gevMapDiagnostics === api) delete windowRef.__gevMapDiagnostics;
    },
  };
  windowRef.__gevMapDiagnostics = api;
  removers.push(application.subscribe(state => {
    record('application', { status: state.status, phase: state.phase });
    sample();
    if (state.status === 'destroyed') api.destroy();
  }));
  return api;
}
