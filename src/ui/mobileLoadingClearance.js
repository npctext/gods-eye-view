// Reserve space for visible loading cards without changing the sheet's route,
// expanded state or scroll containers. Ordinary toasts do not reserve space.
export function initMobileLoadingClearance(documentRef) {
  const win = documentRef.defaultView;
  const body = documentRef.body;
  const stack = documentRef.getElementById('mobile-status-stack');
  if (!stack || !win?.ResizeObserver || !win.MutationObserver) return null;
  const cards = ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip']
    .map((id) => documentRef.getElementById(id)).filter(Boolean);
  const panels = '#left-panel-stack, #right-context-rail, #mobile-settings';
  const property = '--mobile-loading-clearance-top';
  const tracked = new Set();
  const pointers = new Set();
  const removers = [];
  let frame = 0;
  let timer = 0;
  let reserved = 0;
  let applied = 0;
  let emptySince = null;
  let quietUntil = 0;
  let viewport = '';
  let destroyed = false;

  const apply = (value) => {
    if (value === applied) return;
    applied = value;
    if (value) body.style.setProperty(property, `${value}px`);
    else body.style.removeProperty(property);
  };
  const schedule = () => {
    if (!destroyed && !frame) frame = win.requestAnimationFrame(measure);
  };
  const later = (delay) => {
    win.clearTimeout(timer);
    timer = win.setTimeout(schedule, delay);
  };
  function measure() {
    frame = 0;
    if (destroyed) return;
    if (!body.classList.contains('mobile-shell') || !body.hasAttribute('data-mobile-sheet')) {
      reserved = 0;
      emptySince = null;
      tracked.clear();
      pointers.clear();
      win.clearTimeout(timer);
      apply(0);
      return;
    }
    const now = win.performance.now();
    if (pointers.size || body.matches('[data-mobile-layers-dragging], [data-mobile-scenes-dragging], [data-mobile-sheet-peek-dragging]')) return;
    if (now < quietUntil) { later(quietUntil - now); return; }
    const nextViewport = `${win.innerWidth}:${win.innerHeight}`;
    if (viewport !== nextViewport) { viewport = nextViewport; reserved = 0; }
    let bottom = 0;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (card.hidden || !rect.height || !rect.width) { tracked.delete(card); continue; }
      if (['loading', 'retry', 'error'].includes(card.dataset.state)) tracked.add(card);
      if (tracked.has(card)) bottom = Math.max(bottom, rect.bottom);
    }
    if (bottom) {
      emptySince = null;
      win.clearTimeout(timer);
      // Hold the largest reservation through a batch, including completion.
      reserved = Math.max(reserved, Math.ceil(bottom + 8));
      apply(reserved);
    } else if (applied) {
      emptySince ??= now;
      if (now - emptySince < 220) { later(220 - (now - emptySince)); return; }
      reserved = 0;
      emptySince = null;
      apply(0);
    }
  }
  const listen = (node, type, callback, options) => {
    node?.addEventListener(type, callback, options);
    removers.push(() => node?.removeEventListener(type, callback, options));
  };
  const pause = () => {
    quietUntil = win.performance.now() + 160;
    later(160);
  };
  listen(documentRef, 'pointerdown', (event) => {
    if (event.target.closest?.(panels)) pointers.add(event.pointerId);
  }, { passive: true, capture: true });
  for (const type of ['pointerup', 'pointercancel']) {
    listen(documentRef, type, (event) => { if (pointers.delete(event.pointerId)) pause(); }, { passive: true, capture: true });
  }
  for (const type of ['scroll', 'wheel', 'keydown']) {
    listen(documentRef, type, (event) => { if (event.target.closest?.(panels)) pause(); }, { passive: true, capture: true });
  }
  listen(win, 'blur', () => { pointers.clear(); schedule(); });
  listen(win, 'resize', schedule);
  listen(win.visualViewport, 'resize', schedule);
  listen(documentRef, 'visibilitychange', schedule);
  const resize = new win.ResizeObserver(schedule);
  resize.observe(stack);
  const observer = new win.MutationObserver(schedule);
  observer.observe(stack, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'data-state'] });
  observer.observe(body, { attributes: true, attributeFilter: ['class', 'data-mobile-sheet', 'data-mobile-search-open', 'data-mobile-layers-dragging', 'data-mobile-scenes-dragging', 'data-mobile-sheet-peek-dragging'] });
  schedule();
  return {
    destroy() {
      destroyed = true;
      win.cancelAnimationFrame(frame);
      win.clearTimeout(timer);
      resize.disconnect();
      observer.disconnect();
      for (const remove of removers) remove();
      body.style.removeProperty(property);
    },
  };
}
