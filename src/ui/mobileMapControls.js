import { t } from '../i18n/index.js';
import { initMobileVoice } from './mobileVoice.js';

const OPTIONS = [
  ['zoom', 'Zoom controls'],
  ['tilt', 'Top-down / Tilted'],
  ['globe', 'Show whole globe'],
  ['share', 'Share this view'],
  ['location', 'My location'],
];
const SOURCE_IDS = { north: 'north-up-view', tilt: 'tilt-map-view', globe: 'reset-globe-view', share: 'share-btn' };
const STORAGE_KEY = 'gev.mobile.map-buttons';
const clamp = (value) => Math.max(0, Math.min(1, value));

export function sanitizeMapPins(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((key) => OPTIONS.some(([id]) => id === key)))]
    : [];
}

// Slots retain their size while their contents fade; collapsing a button must
// never reflow the column into another button's collision boundary.
export function mapControlVisibility(top, height, boundary) {
  return clamp((top + height - boundary) / height);
}

export function initMobileMapControls({ documentRef, openSearch, openSettings, onVoiceOpen, onMapTool, zoom, locate, onMapInteraction }) {
  const win = documentRef.defaultView;
  if (!win?.requestAnimationFrame) return null;
  const body = documentRef.body;
  const element = (id) => documentRef.getElementById(id);
  const removers = [];
  const listen = (node, type, callback, options) => {
    node?.addEventListener(type, callback, options);
    removers.push(() => node?.removeEventListener(type, callback, options));
  };
  const make = (tag, className, parent) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    parent?.append(node);
    return node;
  };
  const image = (key, parent) => {
    if (key === 'tilt' || key === 'more') {
      const icon = make('span', 'mobile-map-icon mobile-map-' + key + '-icon', parent);
      icon.setAttribute('aria-hidden', 'true');
      return icon;
    }
    const img = make('img', 'mobile-map-icon mobile-map-' + key + '-icon', parent);
    img.src = `/icons/${key === 'search' || key === 'mic' || key === 'settings' ? 'mobile-header' : 'mobile-map'}/${key}.svg`;
    img.alt = '';
    return img;
  };
  const button = (key, label, parent, callback) => {
    const node = make('button', 'mobile-map-button', parent);
    node.type = 'button';
    node.setAttribute('aria-label', t(label));
    node.title = t(label);
    image(key, node);
    if (callback) node.addEventListener('click', callback);
    return node;
  };
  let mobile = false;
  let disposed = false;
  let frame = 0;
  let animateUntil = 0;
  let pins = [];
  let locating = false;
  let pressedControl = null;
  let heldLayout = null;
  let northVisible = false;
  let northHideTimer = null;
  try { pins = sanitizeMapPins(JSON.parse(win.localStorage.getItem(STORAGE_KEY))); } catch { /* Browser storage is optional. */ }

  const header = make('div', '', body);
  header.id = 'mobile-header-actions';
  const headerGroup = make('div', 'mobile-header-group', header);
  const search = button('search', 'Search', headerGroup, openSearch);
  search.setAttribute('aria-controls', 'mobile-search-bar');
  const mic = button('mic', 'Voice control', headerGroup);
  mic.setAttribute('aria-disabled', 'true');
  const settings = button('settings', 'Settings', headerGroup, () => { closeMenu(); openSettings?.(); });
  settings.classList.add('mobile-header-settings');
  settings.setAttribute('aria-controls', 'mobile-settings');

  const toolbar = make('nav', '', body);
  toolbar.id = 'mobile-map-controls';
  toolbar.setAttribute('aria-label', t('Map controls'));
  const primaryRow = make('div', 'mobile-map-primary');
  const sources = Object.fromEntries(Object.entries(SOURCE_IDS).map(([key, id]) => [key, element(id)]));
  const slots = [];
  const proxies = new Map();
  const navigate = () => {
    if (onMapInteraction?.() && !heldLayout)
      heldLayout = { width: win.innerWidth, height: win.innerHeight, toolbarHeight: toolbar.offsetHeight };
    wake();
  };
  const run = async (key) => {
    if (key !== 'location') {
      if (key !== 'share' && sources[key] && !sources[key].disabled) navigate();
      return sources[key]?.click();
    }
    if (locating) return;
    navigate();
    locating = true;
    wake();
    try { await locate?.(); } finally {
      locating = false;
      if (!disposed) wake();
    }
  };
  const slot = (key, parent = toolbar) => {
    const node = make('div', 'mobile-map-slot', parent);
    node.dataset.control = key;
    slots.push(node);
    return node;
  };
  const north = button('north', 'Reset map to north up', slot('north', primaryRow), () => run('north'));
  north.classList.add('mobile-map-north');
  north.setAttribute('data-north-hidden', '');
  north.setAttribute('aria-hidden', 'true');
  north.inert = true;
  proxies.set('north', [north]);
  for (const [key, label] of OPTIONS.filter(([key]) => key !== 'zoom')) {
    proxies.set(key, [button(key, label, slot(key, key === 'location' ? primaryRow : toolbar), () => run(key))]);
  }
  const zoomSlot = slot('zoom');
  const zoomGroup = make('div', 'mobile-map-zoom', zoomSlot);
  for (const [value, label, symbol] of [[1, 'Zoom in', '+'], [-1, 'Zoom out', '−']]) {
    const node = make('button', 'mobile-map-zoom-button', zoomGroup);
    node.type = 'button';
    const icon = make('span', 'mobile-map-icon mobile-map-zoom-' + (value > 0 ? 'in' : 'out') + '-icon', node);
    icon.textContent = symbol;
    icon.setAttribute('aria-hidden', 'true');
    node.setAttribute('aria-label', t(label));
    node.addEventListener('click', () => { navigate(); zoom?.(value); });
  }
  const more = button('more', 'Map tools', slot('more', primaryRow), () => {
    const open = body.hasAttribute('data-mobile-map-menu');
    closeMenu();
    if (!open) {
      body.setAttribute('data-mobile-map-menu', '');
      draw();
    }
    wake();
  });
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'mobile-map-menu');
  toolbar.append(primaryRow);

  const menu = make('section', '', body);
  menu.id = 'mobile-map-menu';
  menu.setAttribute('aria-label', t('Map tools'));
  listen(menu, 'selectstart', (event) => event.preventDefault());
  listen(menu, 'contextmenu', (event) => event.preventDefault());
  const menuHeading = make('h2', '', menu);
  menuHeading.textContent = t('MAP TOOLS');
  const pinCount = make('span', 'mobile-map-pin-count', menuHeading);
  pinCount.setAttribute('aria-live', 'polite');
  const pinButtons = new Map();
  let zoomAction;
  let rowFeedback = null;
  for (const key of ['location', 'tilt', 'globe', 'share', 'zoom']) {
    const label = OPTIONS.find(([id]) => id === key)[1];
    const row = make('div', 'mobile-map-menu-item', menu);
    row.dataset.mapTool = key;
    const ripple = make('span', 'mobile-map-row-ripple', row);
    ripple.setAttribute('aria-hidden', 'true');
    const node = button(key, label, row, async (event) => {
      if (key === 'zoom') { togglePin(key); return; }
      // Clipboard access must stay inside the original click gesture.
      if (key === 'share') run(key);
      const feedback = event.detail > 0 ? rowFeedback : null;
      const finishFeedback = feedback?.ripple.parentElement === row
        && !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (finishFeedback) {
        try { await feedback.animation.finished; } catch { return; }
        if (rowFeedback !== feedback) return;
        feedback.ripple.style.opacity = '1';
        // Paint the completed fill before camera work can block a frame.
        await new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
        if (rowFeedback === feedback) feedback.ripple.style.opacity = '0';
        if (disposed || rowFeedback !== feedback || !body.hasAttribute('data-mobile-map-menu') || node.disabled) return;
      }
      closeMenu(finishFeedback);
      if (key !== 'share') run(key);
    });
    node.className = 'mobile-map-menu-row';
    make('span', '', node).textContent = t(label);
    if (proxies.has(key)) proxies.get(key).push(node);
    if (key === 'zoom') zoomAction = node;
    const pin = make('button', 'mobile-map-pin', row);
    pin.type = 'button';
    // Reuse public/pin.svg geometry; inline paths inherit the current theme.
    pin.innerHTML = '<svg class="mobile-map-icon mobile-map-pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"/><path class="mobile-map-pin-head" d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.12-2.65A2 2 0 0 1 16 10.11V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v5.11a2 2 0 0 1-.44 1.24L5.44 14a2 2 0 0 0-.44 1.24Z"/></svg>';
    pin.addEventListener('click', () => togglePin(key));
    pinButtons.set(key, pin);
  }
  const toolGroup = make('div', 'mobile-map-menu-tools', menu);
  for (const [key, label, icon] of [['draw', 'Draw', 'draw'], ['import', 'Import', 'upload_file'], ['clean', 'Clean UI', 'fullscreen']]) {
    const node = make('button', 'mobile-map-menu-row', toolGroup);
    node.type = 'button';
    node.dataset.mapToolAction = key;
    const symbol = make('span', 'material-symbols-outlined mobile-map-icon mobile-map-' + key + '-icon', node);
    if (key === 'clean') symbol.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
    else symbol.textContent = icon;
    symbol.setAttribute('aria-hidden', 'true');
    make('span', '', node).textContent = t(label);
    node.addEventListener('click', () => { closeMenu(); more.focus(); onMapTool?.(key); });
  }
  function clearRowFeedback() {
    if (!rowFeedback) return;
    rowFeedback.ripple.style.opacity = '0';
    rowFeedback.animation.cancel();
    rowFeedback = null;
  }
  function clearControlPress(event) {
    if (!pressedControl || (event && event.pointerId !== pressedControl.pointerId)) return;
    pressedControl.node.removeAttribute('data-map-press');
    pressedControl = null;
  }
  listen(menu, 'pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button')?.disabled) return;
    const row = event.target.closest('.mobile-map-menu-item');
    if (!row) return;
    clearRowFeedback();
    const rect = row.getBoundingClientRect();
    const x = (event.clientX - rect.left) * row.offsetWidth / rect.width;
    const y = (event.clientY - rect.top) * row.offsetHeight / rect.height;
    const radius = Math.hypot(Math.max(x, row.offsetWidth - x), Math.max(y, row.offsetHeight - y));
    const ripple = row.querySelector('.mobile-map-row-ripple');
    const duration = win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120;
    const animation = ripple.animate([
      { clipPath: `circle(0px at ${x}px ${y}px)` },
      { clipPath: `circle(${radius}px at ${x}px ${y}px)` },
    ], { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
    ripple.style.opacity = '1';
    rowFeedback = { ripple, animation, pointerId: event.pointerId };
  }, { passive: true });
  listen(documentRef, 'pointerup', (event) => {
    clearControlPress(event);
    const feedback = rowFeedback;
    if (!feedback || event.pointerId !== feedback.pointerId) return;
    feedback.animation.finished.then(() => {
      if (rowFeedback === feedback) feedback.ripple.style.opacity = '0';
    }).catch(() => {});
  }, { passive: true });
  listen(documentRef, 'pointercancel', (event) => {
    clearControlPress(event);
    if (event.pointerId === rowFeedback?.pointerId) clearRowFeedback();
  }, { passive: true });
  function togglePin(key) {
    if (pins.includes(key)) pins = pins.filter((id) => id !== key);
    else pins = [...pins, key];
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins)); } catch { /* Keep the session preference. */ }
    renderPins();
  }
  function renderPins() {
    let stackBase = null;
    for (const node of slots) {
      const key = node.dataset.control;
      node.hidden = OPTIONS.some(([id]) => id === key) && !pins.includes(key);
      node.classList.remove('mobile-map-stack-base');
      if (node.parentElement === toolbar && !node.hidden) stackBase = node;
    }
    stackBase?.classList.add('mobile-map-stack-base');
    for (const [key, node] of pinButtons) {
      const pinned = pins.includes(key);
      const name = t(OPTIONS.find(([id]) => id === key)[1]);
      const label = pinned ? t('Unpin {name} from map', { name }) : t('Pin {name} to map', { name });
      node.setAttribute('aria-pressed', String(pinned));
      node.setAttribute('aria-label', label);
      node.title = label;
    }
    zoomAction.setAttribute('aria-pressed', String(pins.includes('zoom')));
    pinCount.textContent = t('Pinned {count}', { count: pins.length });
    wake();
  }
  function closeMenu(keepFeedback = false) {
    if (!keepFeedback) clearRowFeedback();
    body.removeAttribute('data-mobile-map-menu');
    more.setAttribute('aria-expanded', 'false');
    menu.inert = true;
  }

  const title = element('title-bar');
  const sheetNodes = ['left-panel-stack', 'right-context-rail', 'mobile-details', 'mobile-settings', 'command-dock'].map(element).filter(Boolean);
  const visual = (node, amount) => {
    const value = Math.round(amount * 1000) / 1000;
    const css = String(value);
    if (node.style.getPropertyValue('--map-control-visibility') !== css)
      node.style.setProperty('--map-control-visibility', css);
    node.inert = value === 0;
    node.setAttribute('aria-hidden', String(value === 0));
  };
  const northAngle = () => {
    const heading = parseFloat(sources.north?.style.getPropertyValue('--camera-heading')) || 0;
    const wrapped = ((heading % 360) + 360) % 360;
    return Math.min(wrapped, 360 - wrapped);
  };
  const setNorthVisible = (visible) => {
    northVisible = visible;
    north.toggleAttribute('data-north-hidden', !visible);
    north.inert = !visible;
    north.setAttribute('aria-hidden', String(!visible));
  };
  const syncNorthVisibility = () => {
    const angle = northAngle();
    if (angle > 1) {
      win.clearTimeout(northHideTimer);
      northHideTimer = null;
      if (angle > 3 && !northVisible) setNorthVisible(true);
    } else if (northVisible && northHideTimer === null) {
      northHideTimer = win.setTimeout(() => {
        northHideTimer = null;
        if (!disposed && mobile && !documentRef.hidden && northAngle() <= 1) setNorthVisible(false);
      }, 500);
    }
  };
  function draw() {
    const searchOpen = body.hasAttribute('data-mobile-search-open');
    search.setAttribute('aria-expanded', String(searchOpen));
    settings.setAttribute('aria-expanded', String(body.getAttribute('data-mobile-sheet') === 'more'));
    if (searchOpen) closeMenu();
    for (const [key, nodes] of proxies) {
      const source = sources[key];
      for (const node of nodes) {
        node.disabled = key === 'location' ? locating : !source || source.disabled;
        if (key === 'location') node.setAttribute('aria-busy', String(locating));
        if (key === 'tilt') node.setAttribute('aria-pressed', source?.getAttribute('data-top-down') || 'false');
      }
    }
    north.style.setProperty('--camera-heading', sources.north?.style.getPropertyValue('--camera-heading') || '0deg');
    syncNorthVisibility();
    const headerRect = header.getBoundingClientRect();
    const controlTop = Math.max(headerRect.bottom + 12, parseFloat(body.style.getPropertyValue('--mobile-loading-clearance-top')) || 0);
    const tabTop = element('mobile-tab-bar').getBoundingClientRect().top;
    let panelTop = tabTop;
    for (const node of sheetNodes) {
      if (node.id === 'command-dock' && body.getAttribute('data-mobile-sheet') !== 'more') continue;
      const style = win.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = node.getBoundingClientRect();
      if (rect.height > 0) panelTop = Math.min(panelTop, rect.top);
    }
    let restingBottom = tabTop;
    for (const id of ['mobile-scene-player', 'mobile-voice-panel']) {
      const player = element(id);
      if (player?.classList.contains('is-visible') && win.getComputedStyle(player).visibility !== 'hidden') {
        const rect = player.getBoundingClientRect();
        const height = id === 'mobile-voice-panel' ? parseFloat(body.style.getPropertyValue('--mobile-voice-height')) || rect.height : rect.height;
        restingBottom = Math.min(restingBottom, rect.bottom - height);
      }
    }
    if (!body.hasAttribute('data-mobile-sheet-peek') || body.hasAttribute('data-mobile-sheet-peek-dragging') ||
        heldLayout?.width !== win.innerWidth || heldLayout?.height !== win.innerHeight ||
        heldLayout?.toolbarHeight !== toolbar.offsetHeight) heldLayout = null;
    const toolbarBottom = Math.min(panelTop, restingBottom);
    const toolbarTop = toolbarBottom - 16 - toolbar.offsetHeight;
    // Repeated map taps keep their target while the sheet retreats.
    if (!heldLayout) toolbar.style.top = `${toolbarTop}px`;
    const visibleTop = toolbar.getBoundingClientRect().top;
    const creditsBottom = `${Math.max(2, Math.round(win.innerHeight - visibleTop - toolbar.offsetHeight - 14))}px`;
    if (body.style.getPropertyValue('--mobile-map-credits-bottom') !== creditsBottom)
      body.style.setProperty('--mobile-map-credits-bottom', creditsBottom);
    // Let the bottom row use up the stack gap before moving the column.
    const stackBase = slots.find((node) => node.classList.contains('mobile-map-stack-base'));
    const stackGap = stackBase ? parseFloat(win.getComputedStyle(stackBase).marginBottom) : 0;
    const stackOffset = Math.min(stackGap, Math.max(0, restingBottom - 16 - toolbar.offsetHeight - visibleTop));
    if (!heldLayout) toolbar.style.setProperty('--map-stack-offset', `${stackOffset}px`);
    for (const node of heldLayout ? [] : slots) {
      if (node.hidden) continue;
      const offset = node.parentElement === toolbar ? stackOffset : 0;
      const amount = mapControlVisibility(visibleTop + node.offsetTop + offset, node.offsetHeight, controlTop);
      visual(node, amount);
    }
    const snapshotTransition = documentRef.documentElement.matches('[data-tab-transition], [data-scene-transition]');
    const visiblePanelTop = snapshotTransition ? visibleTop + toolbar.offsetHeight + 16 : panelTop;
    const headerAmount = clamp((visiblePanelTop - headerRect.bottom) / headerRect.height);
    for (const node of [title, ...header.children].filter(Boolean)) visual(node, headerAmount);
    const menuOpen = body.hasAttribute('data-mobile-map-menu');
    more.setAttribute('aria-expanded', String(menuOpen));
    menu.inert = !menuOpen;
    menu.setAttribute('aria-hidden', String(!menuOpen));
    // Measure the full menu, independently of the space above a moving sheet.
    const viewportTop = win.visualViewport?.offsetTop || 0;
    const viewportBottom = viewportTop + (win.visualViewport?.height || win.innerHeight);
    const menuTop = Math.max(viewportTop + 12, Math.min(
      more.getBoundingClientRect().bottom - menu.offsetHeight,
      viewportBottom - menu.offsetHeight - 12,
    ));
    menu.style.top = `${menuTop}px`;
  }
  function tick() {
    frame = 0;
    if (disposed || !mobile || documentRef.hidden) return;
    draw();
    if (win.performance.now() < animateUntil) frame = win.requestAnimationFrame(tick);
  }
  function wake() {
    if (disposed || !mobile) return;
    animateUntil = win.performance.now() + 400;
    if (!frame) frame = win.requestAnimationFrame(tick);
  }
  const observer = new win.MutationObserver((records) => {
    // Scene controls mount after the shell; observe visibility, not progress ticks.
    for (const record of records) for (const node of record.addedNodes) {
      if (!['mobile-scene-player', 'mobile-voice-panel'].includes(node.id)) continue;
      observer.observe(node, { attributes: true, attributeFilter: ['class'] });
      resize.observe(node);
    }
    wake();
  });
  observer.observe(body, { childList: true, attributes: true, attributeFilter: ['class', 'data-mobile-sheet', 'data-mobile-details', 'data-mobile-search-open', 'data-mobile-map-menu', 'data-mobile-scenes-expanded', 'data-mobile-layers-expanded', 'data-mobile-scenes-lowered', 'data-mobile-sheet-peek', 'data-mobile-sheet-peek-dragging', 'data-mobile-voice', 'data-mobile-voice-visible'] });
  observer.observe(documentRef.documentElement, { attributes: true, attributeFilter: ['data-tab-transition', 'data-scene-transition'] });
  const player = element('mobile-scene-player');
  if (player) observer.observe(player, { attributes: true, attributeFilter: ['class'] });
  for (const node of [...sheetNodes, ...Object.values(sources)].filter(Boolean))
    observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'aria-pressed', 'data-top-down', 'disabled'] });
  const resize = new win.ResizeObserver(wake);
  for (const node of [...sheetNodes, player, menu, header, toolbar, element('mobile-status-stack')].filter(Boolean)) resize.observe(node);
  listen(win, 'resize', wake);
  listen(win, 'blur', () => clearControlPress());
  listen(win.visualViewport, 'resize', wake);
  listen(documentRef, 'visibilitychange', wake);
  listen(documentRef, 'transitionrun', wake, true);
  listen(documentRef, 'animationstart', wake, true);
  listen(documentRef, 'pointermove', wake, { passive: true });
  listen(documentRef, 'touchmove', wake, { passive: true });
  listen(documentRef, 'pointerdown', (event) => {
    if (event.isPrimary && event.button === 0) {
      clearControlPress();
      const node = event.target.closest('.mobile-map-button, .mobile-map-zoom-button');
      if (mobile && node && !node.disabled && (toolbar.contains(node) || header.contains(node))) {
        node.setAttribute('data-map-press', '');
        pressedControl = { node, pointerId: event.pointerId };
      }
    }
    if (!menu.contains(event.target) && !more.contains(event.target)) closeMenu();
  }, true);
  listen(documentRef, 'pointerout', (event) => {
    if (pressedControl?.node.contains(event.target) && !pressedControl.node.contains(event.relatedTarget)) clearControlPress(event);
  });
  listen(documentRef, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (body.hasAttribute('data-mobile-map-menu')) { event.preventDefault(); closeMenu(); more.focus(); }
  });
  listen(documentRef, 'gev:mobile-voice-layout', wake);
  const voice = initMobileVoice({ documentRef, trigger: mic, onReveal: () => { closeMenu(); onVoiceOpen?.(); } });
  renderPins();
  closeMenu();
  return {
    setMobile(value) {
      mobile = value;
      if (value) wake();
      else {
        win.clearTimeout(northHideTimer);
        northHideTimer = null;
        heldLayout = null;
        body.style.removeProperty('--mobile-map-credits-bottom');
        clearControlPress();
        closeMenu();
        win.cancelAnimationFrame(frame); frame = 0;
        for (const node of [title, ...header.children].filter(Boolean)) {
          node.style.removeProperty('--map-control-visibility');
          node.inert = false;
          node.removeAttribute('aria-hidden');
        }
      }
    },
    destroy() {
      voice?.destroy();
      this.setMobile(false);
      disposed = true;
      observer.disconnect(); resize.disconnect();
      for (const remove of removers) remove();
      for (const node of [header, toolbar, menu]) node.remove();
    },
  };
}
