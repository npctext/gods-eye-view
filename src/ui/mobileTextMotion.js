import { disposeSplitFlap, setSplitFlapText } from '../splitFlap.js';

// Observe only short status labels, never headings, list rows or counters.
export function initMobileTextMotion(documentRef) {
  const win = documentRef.defaultView;
  if (!win?.MutationObserver || !win.requestAnimationFrame) return null;
  const body = documentRef.body;
  const byId = (id) => documentRef.getElementById(id);
  const states = new Map();
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let destroyed = false;
  let roots = new Set();
  const schedule = () => {
    if (!destroyed && !frame) frame = win.requestAnimationFrame(sync);
  };
  const observer = new win.MutationObserver((records) => {
    if (records.some((record) => record.type !== 'attributes' || record.oldValue !== record.target.getAttribute(record.attributeName))) schedule();
  });
  const watch = (node, options) => { if (node) observer.observe(node, { ...options, ...(options.attributes ? { attributeOldValue: true } : {}) }); };
  const visible = (node) => node?.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })
    ?? !!node?.getClientRects?.().length;
  const stop = (state) => { if (state?.node) disposeSplitFlap(state.node); };

  function sync() {
    frame = 0;
    observer.disconnect();
    const mobile = body.classList.contains('mobile-shell');
    const enabled = mobile && !documentRef.hidden && !reduced.matches;
    const sheet = body.dataset.mobileSheet;
    const player = byId('mobile-scene-player');
    const placeholder = documentRef.querySelector('.mobile-camera-placeholder');
    const transitioning = documentRef.documentElement.matches('[data-tab-transition], [data-scene-transition]');
    const holdingSheet = body.matches('[data-mobile-sheet-peek], [data-mobile-layers-dragging], [data-mobile-scenes-dragging], [data-mobile-sheet-peek-dragging]');
    const targets = [
      ['camera-status', placeholder?.querySelector('.mobile-camera-placeholder-text'), sheet === 'cameras' && !holdingSheet && placeholder?.dataset.loading === 'true' && placeholder?.dataset.error !== 'true', placeholder],
      ['player', player?.querySelector('.scene-player-title'), player?.classList.contains('is-visible') && ['loading', 'seeking'].includes(player?.dataset.state), player],
    ];
    for (const [cardId, labelId] of [['global-loading-status', 'global-loading-label'], ['traffic-sync-chip', 'traffic-sync-label'], ['cctv-sync-chip', 'cctv-sync-label']]) {
      const card = byId(cardId);
      targets.push([cardId, byId(labelId), !['error', 'retry', 'cancelled'].includes(card?.dataset.state), card]);
    }
    roots = new Set(targets.map(([, , , root]) => root).filter(Boolean));
    for (const [id, node, active, root, extra = ''] of targets) {
      const previous = states.get(id);
      if (previous?.node !== node) stop(previous);
      const text = node?.textContent || '';
      const key = text + '\n' + extra;
      if (enabled && active && transitioning && id === 'camera-status') {
        stop(previous);
      } else if (enabled && active && text && visible(node)) {
        if (!previous?.shown || previous.key !== key) {
          // Keep an existing controller's animation when its label changes.
          if (!previous?.shown || !node.querySelector('.gev-flap-cells > .is-flapping'))
            setSplitFlapText(node, text, { reveal: true });
        }
        states.set(id, { node, key, shown: true });
      } else {
        if (mobile || previous?.shown) { stop(previous); if (node !== previous?.node) disposeSplitFlap(node); }
        states.set(id, { node, key, shown: false });
      }
      watch(node, { childList: true, characterData: true, subtree: true });
      watch(root, { attributes: true, attributeFilter: ['class', 'hidden', 'data-state', 'data-loading', 'data-error'] });
    }
    watch(body, { childList: true, attributes: true, attributeFilter: ['class', 'data-mobile-sheet', 'data-mobile-sheet-peek', 'data-mobile-search-open', 'data-mobile-layers-dragging', 'data-mobile-scenes-dragging', 'data-mobile-sheet-peek-dragging'] });
    watch(documentRef.documentElement, { attributes: true, attributeFilter: ['data-tab-transition', 'data-scene-transition', 'lang'] });
    watch(byId('right-context-rail'), { attributes: true, attributeFilter: ['class', 'hidden', 'data-camera-tab'] });
  }
  const settled = (event) => {
    if (roots.has(event.target)) schedule();
  };
  for (const name of ['animationend', 'animationcancel', 'transitionend', 'transitioncancel']) documentRef.addEventListener(name, settled, true);
  documentRef.addEventListener('visibilitychange', schedule);
  reduced.addEventListener?.('change', schedule);
  schedule();
  return { destroy() {
    destroyed = true;
    win.cancelAnimationFrame(frame);
    observer.disconnect();
    for (const state of states.values()) stop(state);
    states.clear();
    for (const name of ['animationend', 'animationcancel', 'transitionend', 'transitioncancel']) documentRef.removeEventListener(name, settled, true);
    documentRef.removeEventListener('visibilitychange', schedule);
    reduced.removeEventListener?.('change', schedule);
  } };
}
