import { sceneLayerPlan } from './scenePolicy.js';
import { t } from '../i18n/index.js';

const clone = value => JSON.parse(JSON.stringify(value));
const explicit = origin => ['user', 'voice', 'tool'].includes(origin);
const withoutHud = ({ hud, ...visual } = {}) => visual;

/** Keep the operator's map state for one playback session, including seeks/replays. */
export function createSceneViewSession(director) {
  const manager = director.dataManager;
  let snapshot = null;
  let restoring = null;
  let destroyed = false;
  let currentLayer = null;
  let layerAbort = null;
  const readLayer = id => {
    const layer = manager.getAll().find(layer => layer.id === id);
    if (!layer) return null;
    const params = manager.getLayerParams(id);
    return { enabled: !!layer.enabled, ...(params ? { params: clone(params) } : {}) };
  };
  const onChange = change => {
    if (!snapshot || !change.layerId) return;
    const visibility = change.type === 'visibility-requested' || (change.type === 'visibility' && change.adopted);
    if (!visibility && change.type !== 'params-requested') return;
    if (change.origin === 'scene') {
      if (snapshot.manual.has(change.layerId)) snapshot.overwritten.add(change.layerId);
      return;
    }
    if (!explicit(change.origin)) return;
    const state = snapshot.manual.get(change.layerId) || readLayer(change.layerId);
    if (!state) return;
    if (visibility) state.enabled = change.enabled;
    else state.params = { ...state.params, ...clone(change.params || {}) };
    snapshot.manual.set(change.layerId, state);
    snapshot.overwritten.delete(change.layerId);
    // A new direct choice also wins over restoration already in flight.
    if (currentLayer === change.layerId) layerAbort?.abort();
  };
  const unsubscribeVisibility = manager.subscribeVisibilityRequests?.(onChange);
  const unsubscribeParams = manager.subscribe?.(onChange);
  const session = {
    get restoring() { return restoring; },
    begin() {
      if (snapshot || destroyed) return;
      snapshot = {
        layers: clone(director._captureLayerStates()),
        visual: clone(withoutHud(director.styleManager.getVisualState())),
        manual: new Map(),
        overwritten: new Set(),
      };
    },
    restore() {
      if (restoring) return restoring;
      if (!snapshot || destroyed) return Promise.resolve(false);
      const saved = snapshot;
      // Capture before the Director tracks this restore, avoiding a self-wait.
      const pending = [...(director._pendingWork || [])];
      restoring = (async () => {
        const refused = [];
        try {
          await Promise.allSettled([...pending, director._waitForRunIdle()]);
          if (destroyed) return false;
          director._loadedSceneId = null;
          const registered = new Set(manager.getAll().map(layer => layer.id));
          for (const [id, baseline] of Object.entries(saved.layers)) {
            if (destroyed) return false;
            if (!registered.has(id)) continue;
            // An unchanged manual choice may still be settling in the manager.
            if (saved.manual.has(id) && !saved.overwritten.has(id)) continue;
            const target = saved.manual.get(id) || baseline;
            const [plan] = sceneLayerPlan({ [id]: target }, registered);
            const current = readLayer(id);
            const [currentPlan] = sceneLayerPlan({ [id]: current }, registered);
            if (JSON.stringify(plan) === JSON.stringify(currentPlan)) continue;
            currentLayer = id;
            layerAbort = new AbortController();
            // Reuse the passive restore origin: enabling a layer must not fly its camera.
            const options = { origin: 'local-restore', signal: layerAbort.signal };
            let ok;
            try {
              if (plan.params && typeof manager.restoreLayerState === 'function') {
                ok = (await manager.restoreLayerState(id, { enabled: plan.enabled, params: plan.params }, options))?.succeeded === true;
              } else {
                ok = await manager.setEnabled(id, plan.enabled, options);
                if (ok !== false && !layerAbort.signal.aborted && plan.params) {
                  ok = manager.setLayerParams(id, plan.params, { origin: options.origin });
                }
              }
              if (ok === false && !layerAbort.signal.aborted) refused.push(id);
            } catch (error) {
              if (!layerAbort.signal.aborted) {
                refused.push(id);
                console.warn(`[Scenes] Could not restore layer: ${id}`, error);
              }
            } finally {
              currentLayer = null;
              layerAbort = null;
            }
          }
          if (destroyed) return false;
          await director.styleManager.applyVisualState(saved.visual, {
            isCurrent: () => !destroyed && snapshot === saved,
          });
          if (refused.length) director._updateStatus(t('Layers refused: {layers}', { layers: refused.join(', ') }));
          return !refused.length;
        } catch (error) {
          if (!destroyed) {
            console.warn('[Scenes] Could not restore map state', error);
            director._updateStatus(t('Error: {message}', { message: error.message || 'Map state restoration failed' }));
          }
          return false;
        } finally {
          snapshot = null;
          restoring = null;
        }
      })();
      return restoring;
    },
    destroy() {
      destroyed = true;
      layerAbort?.abort();
      unsubscribeVisibility?.();
      unsubscribeParams?.();
      snapshot = null;
    },
  };
  return session;
}
