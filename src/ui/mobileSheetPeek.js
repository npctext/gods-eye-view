import { t } from '../i18n/index.js';

// A temporary visual retreat, separate from the sheet's height, route and scroll.
export function initMobileSheetPeek({ documentRef, tabs, onChange, onClose }) {
  const win = documentRef.defaultView;
  if (!win?.requestAnimationFrame) return null;
  const body = documentRef.body;
  const element = (id) => documentRef.getElementById(id);
  const removers = [];
  const listen = (node, type, callback, options) => {
    node?.addEventListener(type, callback, options);
    removers.push(() => node?.removeEventListener(type, callback, options));
  };
  const restoreBar = documentRef.createElement('div');
  restoreBar.id = 'mobile-sheet-restore';
  restoreBar.hidden = true;
  const restoreButton = documentRef.createElement('button');
  restoreButton.className = 'mobile-sheet-peek-open';
  restoreButton.type = 'button';
  const handle = documentRef.createElement('span');
  handle.className = 'mobile-details-handle';
  handle.setAttribute('aria-hidden', 'true');
  const title = documentRef.createElement('span');
  title.className = 'mobile-sheet-title';
  const count = documentRef.createElement('span');
  count.className = 'mobile-sheet-count';
  const heading = documentRef.createElement('span');
  heading.className = 'mobile-sheet-heading';
  heading.append(title, count);
  restoreButton.append(handle, heading);
  const closeButton = documentRef.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'mobile-details-close mobile-sheet-control mobile-sheet-close';
  closeButton.setAttribute('aria-label', t('Close'));
  const closeIcon = documentRef.createElement('span');
  closeIcon.className = 'mobile-sheet-close-icon';
  closeIcon.setAttribute('aria-hidden', 'true');
  closeButton.append(closeIcon);
  restoreBar.append(restoreButton, closeButton);
  body.append(restoreBar);

  let active = null;
  let pull = null;
  let suppressClick = false;
  let closeTimer = null;
  const pointers = new Map();
  const rootsFor = (sheet) => (sheet === 'layers' || sheet === 'scenes'
    ? ['left-panel-stack']
    : sheet === 'more' ? ['mobile-settings'] : ['right-context-rail'])
    .map(element).filter((node) => node && win.getComputedStyle(node).display !== 'none');
  const setOffset = (value) => body.style.setProperty('--mobile-sheet-peek-offset', `${value}px`);
  const measure = () => {
    if (!active || pull || active.closing) return;
    const top = Math.min(...active.roots.map(({ node }) => {
      const translateY = parseFloat(win.getComputedStyle(node).translate.split(' ')[1]) || 0;
      return node.getBoundingClientRect().top - translateY;
    }));
    active.offset = Math.max(0, element('mobile-tab-bar').getBoundingClientRect().top - restoreBar.offsetHeight - top);
    setOffset(active.offset);
  };
  const clear = (animate = false) => {
    if (!active) return;
    const previous = active;
    clearTimeout(closeTimer);
    closeTimer = null;
    active = null;
    pull = null;
    pointers.clear();
    body.removeAttribute('data-mobile-sheet-peek');
    body.removeAttribute('data-mobile-sheet-peek-dragging');
    restoreBar.hidden = true;
    restoreBar.style.removeProperty('translate');
    if (!animate) body.setAttribute('data-mobile-sheet-peek-reset', '');
    body.style.removeProperty('--mobile-sheet-peek-offset');
    for (const { node, inert } of previous.roots) {
      node.inert = inert;
      if (!animate) node.getBoundingClientRect();
    }
    body.removeAttribute('data-mobile-sheet-peek-reset');
    resize.disconnect();
    headerObserver.disconnect();
    onChange();
    return previous;
  };
  const restore = () => {
    if (active?.closing) return;
    const focus = documentRef.activeElement === restoreButton;
    const previous = clear(true);
    if (focus) previous?.focus?.focus({ preventScroll: true });
  };
  const close = () => {
    if (!active || active.closing) return;
    active.closing = true;
    pull = null;
    body.removeAttribute('data-mobile-sheet-peek-dragging');
    const distance = restoreBar.offsetHeight + 2;
    setOffset(active.offset + distance);
    restoreBar.style.setProperty('translate', `0 ${distance}px`);
    const value = win.getComputedStyle(documentRef.documentElement).getPropertyValue('--mobile-sheet-animation-duration').trim() || '280ms';
    const duration = win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    closeTimer = win.setTimeout(() => { closeTimer = null; onClose(); }, duration);
    onChange();
  };
  const updateHeading = () => {
    if (!active) return;
    const heading = active.sheet === 'more' ? element(active.panel?.getAttribute('aria-labelledby')) : active.panel?.querySelector('.mobile-sheet-title');
    const label = heading?.textContent || t(tabs.find((tab) => tab.sheet === active.sheet).label);
    const sourceCount = active.panel?.querySelector('.mobile-sheet-count');
    title.textContent = label;
    count.textContent = sourceCount?.textContent || '';
    count.hidden = !sourceCount || sourceCount.hidden;
    restoreButton.setAttribute('aria-label', `${t('Expand')}: ${label}${count.hidden ? '' : ` (${count.textContent})`}`);
  };
  const headerObserver = new win.MutationObserver(updateHeading);
  const collapse = () => {
    if (active) return !active.closing;
    const sheet = body.getAttribute('data-mobile-sheet');
    if (!sheet || !body.classList.contains('mobile-shell') || documentRef.querySelector('dialog[open]') ||
        documentRef.documentElement.matches('[data-tab-transition], [data-scene-transition]') ||
        body.matches('[data-mobile-layers-dragging], [data-mobile-scenes-dragging]')) return false;
    const roots = rootsFor(sheet);
    if (!roots.length || roots.some((node) => node.style.transform)) return false;
    const panel = element(sheet === 'scenes' ? 'scene-panel' : sheet === 'layers' ? 'data-panel' : sheet === 'more' ? 'mobile-settings' : sheet === 'context' ? 'mobile-context-header' : '');
    restoreButton.setAttribute('aria-controls', roots.map((node) => node.id).join(' '));
    restoreBar.hidden = false;
    body.setAttribute('data-mobile-sheet-peek', '');
    active = { roots: roots.map((node) => ({ node, inert: node.inert })), focus: documentRef.activeElement, offset: 0, panel, sheet };
    updateHeading();
    if (panel) headerObserver.observe(panel, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    measure();
    if (!active.offset) { clear(); return false; }
    for (const { node } of active.roots) { node.inert = true; resize.observe(node); }
    onChange();
    return true;
  };
  const resize = new win.ResizeObserver(measure);
  listen(win, 'resize', measure);
  listen(win.visualViewport, 'resize', measure);
  listen(documentRef, 'transitionend', (event) => {
    if (event.propertyName === 'translate') onChange();
  });
  listen(documentRef, 'pointerdown', (event) => {
    if (!event.target.matches?.('#cesiumContainer .cesium-widget canvas')) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) collapse();
  }, { passive: true, capture: true });
  listen(documentRef, 'pointermove', (event) => {
    const start = pointers.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6) collapse();
  }, { passive: true, capture: true });
  for (const type of ['pointerup', 'pointercancel'])
    listen(documentRef, type, (event) => pointers.delete(event.pointerId), { passive: true, capture: true });
  listen(win, 'blur', () => pointers.clear());
  listen(documentRef, 'wheel', (event) => {
    if (event.target.matches?.('#cesiumContainer .cesium-widget canvas') && (event.deltaX || event.deltaY)) collapse();
  }, { passive: true, capture: true });
  listen(restoreButton, 'click', (event) => {
    if (event.detail > 0 && suppressClick) { suppressClick = false; return; }
    restore();
  });
  listen(closeButton, 'click', close);
  listen(restoreButton, 'pointerdown', (event) => {
    if (!active || active.closing || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    pull = { id: event.pointerId, x: event.clientX, y: event.clientY, dy: 0 };
    restoreButton.setPointerCapture(event.pointerId);
  });
  listen(restoreButton, 'pointermove', (event) => {
    if (!pull || pull.id !== event.pointerId) return;
    pull.dy = Math.min(restoreBar.offsetHeight + 16, Math.max(-active.offset, event.clientY - pull.y));
    if (Math.hypot(event.clientX - pull.x, event.clientY - pull.y) >= 4) suppressClick = true;
    if (Math.abs(pull.dy) < 4) return;
    suppressClick = true;
    body.setAttribute('data-mobile-sheet-peek-dragging', '');
    setOffset(active.offset + pull.dy);
    restoreBar.style.setProperty('translate', `0 ${pull.dy}px`);
    onChange();
  });
  const endPull = (event) => {
    if (!pull || pull.id !== event.pointerId) return;
    const expand = event.type === 'pointerup' && pull.dy < -40;
    const dismiss = event.type === 'pointerup' && pull.dy > 40;
    pull = null;
    body.removeAttribute('data-mobile-sheet-peek-dragging');
    if (expand) restore();
    else if (dismiss) close();
    else { restoreBar.style.removeProperty('translate'); measure(); }
  };
  for (const type of ['pointerup', 'pointercancel']) listen(restoreButton, type, endPull);
  return {
    collapse,
    clear,
    destroy() {
      clear();
      resize.disconnect();
      headerObserver.disconnect();
      for (const remove of removers) remove();
      restoreBar.remove();
    },
  };
}
