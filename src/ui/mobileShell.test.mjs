import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { beforeEach, afterEach } from 'node:test';
import { StyleManager } from './applicationShell.js';
import { ContextControls } from './contextControls.js';
import {
  MOBILE_SHEET_PANELS,
  MOBILE_TABS,
  initMobileShell,
  nextSheet,
  sheetForPanelId,
} from './mobileShell.js';

const previousStyle = globalThis.getComputedStyle;
beforeEach(() => {
  globalThis.getComputedStyle = () => ({ maxHeight: '698px', display: 'block', getPropertyValue: () => '' });
});
afterEach(() => { globalThis.getComputedStyle = previousStyle; });

function element(tag, document) {
  const node = new EventTarget();
  const attributes = new Map();
  const classes = new Set();
  Object.assign(node, {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    hidden: false,
    textContent: '',
    className: '',
    parent: null,
    scrollTop: 0,
    parentElement: null,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    style: {
      values: new Map(),
      setProperty(name, value) {
        this.values.set(name, value);
      },
      removeProperty(name) {
        this.values.delete(name);
      },
    },
    setAttribute: (key, value) => attributes.set(key, String(value)),
    getAttribute: (key) => attributes.get(key) ?? null,
    hasAttribute: (key) => attributes.has(key),
    toggleAttribute: (key, force) => force ? attributes.set(key, '') : attributes.delete(key),
    removeAttribute: (key) => attributes.delete(key),
    append(...children) {
      for (const child of children) {
        const previous = child.parent?.children;
        if (previous) previous.splice(previous.indexOf(child), 1);
        child.parent = node;
        child.parentElement = node;
        node.children.push(child);
        if (child.id) document.ids.set(child.id, child);
      }
    },
    insertBefore(child, next) {
      const previous = child.parent?.children;
      if (previous) previous.splice(previous.indexOf(child), 1);
      child.parent = node;
      child.parentElement = node;
      const index = next ? node.children.indexOf(next) : -1;
      node.children.splice(index < 0 ? node.children.length : index, 0, child);
    },
    replaceChildren(...children) {
      for (const child of node.children) {
        child.parent = null;
        child.parentElement = null;
      }
      node.children = [];
      node.append(...children);
    },
    remove() {
      const siblings = node.parent?.children;
      siblings?.splice(siblings.indexOf(node), 1);
      document.ids.delete(node.id);
    },
    contains(other) {
      for (let current = other; current; current = current.parent)
        if (current === node) return true;
      return false;
    },
    closest(selector) {
      for (let current = node; current; current = current.parent) {
        if (
          selector.startsWith('button, a') &&
          (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(
            current.tagName,
          ) ||
            ['slider', 'button'].includes(current.getAttribute('role')) ||
            (current.getAttribute('contenteditable') !== null &&
              current.getAttribute('contenteditable') !== 'false'))
        )
          return current;
        if (selector === '[data-mobile-sheet]' && current.dataset.mobileSheet)
          return current;
      }
      return null;
    },
    querySelector(selector) {
      if (selector === '.mobile-sheet-title') return node.children.find(child => child.className === 'mobile-sheet-title') || null;
      if (selector === '[data-explore-action="weather"]') return node.children.find(child => child.dataset.exploreAction === 'weather') || null;
      return node.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const found = [];
      const matches = (child) =>
        selector === '[data-mobile-sheet]'
          ? Boolean(child.dataset.mobileSheet)
          : selector === '.data-toggle-btn.active'
            ? child.classList.contains('data-toggle-btn') && child.classList.contains('active')
          : selector === '.data-toggle-btn'
            ? child.classList.contains('data-toggle-btn')
          : child.tagName === 'BUTTON';
      const walk = (parent) => {
        for (const child of parent.children) {
          if (matches(child)) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
    getBoundingClientRect: () => ({ top: 0, height: 0 }),
    getClientRects: () => (node.hidden ? [] : [{}]),
    matches: (selector) =>
      selector === '.panel-collapse-btn' &&
      node.className.split(' ').includes('panel-collapse-btn'),
    focus() {
      document.activeElement = node;
      node.dispatchEvent(new Event('focus'));
    },
    click() { node.dispatchEvent(new Event('click')); },
    blur() {
      if (document.activeElement === node)
        document.activeElement = document.body;
    },
  });
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const siblings = node.parent?.children;
      return siblings?.[siblings.indexOf(node) + 1] ?? null;
    },
  });
  return node;
}

const PANEL_IDS = [...new Set([...Object.values(MOBILE_SHEET_PANELS).flat(), 'location-bar'])];

function fixture({
  mobile = true,
  expanded = [],
  onTabOpened = () => {},
  onExploreAction,
  onExploreLocation,
  readExploreView,
  subscribeRadio,
} = {}) {
  const document = new EventTarget();
  document.ids = new Map();
  document.createElement = (tag) => element(tag, document);
  document.getElementById = (id) => document.ids.get(id) ?? null;
  const viewport = element('meta', document);
  viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
  document.querySelector = (selector) =>
    selector === 'meta[name="viewport"]'
      ? viewport
      : selector === 'dialog[open]' && document.openDialog
        ? {}
        : null;
  document.body = element('body', document);
  document.activeElement = document.body;
  const search = element('input', document);
  search.id = 'location-search';
  const rails = {};
  for (const id of ['left-panel-stack', 'right-context-rail', 'command-dock']) {
    rails[id] = element('div', document);
    rails[id].id = id;
    document.body.append(rails[id]);
  }
  for (const id of PANEL_IDS) {
    const panel = element('section', document);
    panel.id = id;
    if (!expanded.includes(id)) panel.classList.add('collapsed');
    // A hidden tray toggle and a collapse control first, like the panels'
    // own chrome in a sheet.
    const toggle = element('button', document);
    toggle.hidden = true;
    const collapse = element('button', document);
    collapse.className = 'panel-collapse-btn';
    panel.append(toggle, collapse, element('button', document));
    if (id === 'location-bar') {
      const popover = element('div', document);
      popover.id = 'location-bar-popover';
      const pois = element('div', document);
      pois.id = 'poi-row';
      const divider = element('div', document);
      divider.id = 'location-bar-divider';
      const cities = element('div', document);
      cities.id = 'location-pills';
      popover.append(pois, divider, cities, search);
      panel.append(popover);
    }
    if (id === 'radio-panel') {
      const entry = element('button', document);
      entry.id = 'mobile-radio-receiver';
      const receiver = element('div', document);
      receiver.id = 'sdr-radio-card';
      panel.append(entry, receiver);
    }
    if (id === 'scene-panel') {
      const select = element('select', document);
      select.id = 'scene-select';
      select.options = [
        { value: 'bhote-koshi-nepal-scene', textContent: 'Nepal Flood Incident' },
        { value: 'flights-radar', textContent: 'Global Flights Radar' },
        { value: 'orbital-watch', textContent: 'Orbital Watch' },
      ];
      panel.append(select);
    }
    if (id === 'data-panel') {
      const handle = element('button', document);
      handle.id = 'mobile-layers-handle';
      const close = element('button', document);
      close.id = 'mobile-layers-close';
      const filter = element('div', document);
      filter.id = 'mobile-layers-filter';
      const all = element('button', document);
      all.id = 'mobile-layers-all';
      const active = element('button', document);
      active.id = 'mobile-layers-active';
      const count = element('span', document);
      count.id = 'mobile-layers-active-count';
      const total = element('span', document);
      total.id = 'mobile-layers-count';
      panel.append(total);
      active.append(count);
      filter.append(all, active);
      const list = element('div', document);
      list.id = 'data-toggles';
      panel.append(handle, close, filter, list);
    }
    const root =
      ['data-panel', 'scene-panel'].includes(id)
        ? 'left-panel-stack'
        : ['location-bar', 'control-panel'].includes(id)
          ? 'command-dock'
          : 'right-context-rail';
    rails[root].append(panel);
  }

  const media = new EventTarget();
  media.matches = mobile;
  const calls = [];
  const frames = [];
  let closedCount = 0;
  let observed = null;
  let layersObserved = null;
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      if (target.id === 'data-toggles') layersObserved = this.callback;
      else observed = this.callback;
    }
    disconnect() {
      if (observed === this.callback) observed = null;
      if (layersObserved === this.callback) layersObserved = null;
    }
  }
  const shell = initMobileShell({
    documentRef: document,
    onTabOpened,
    onExploreAction,
    onExploreLocation,
    readExploreView,
    subscribeRadio,
    matchMedia: (query) => query === '(prefers-reduced-motion: reduce)' ? { matches: false } : media,
    MutationObserverImpl: FakeMutationObserver,
    ResizeObserverImpl: null,
    requestFrame: (callback) => frames.push(callback),
    onSheetsClosed: () => {
      closedCount += 1;
    },
    setPanelCollapsed: (panelId, collapsed, options) => {
      calls.push({ panelId, collapsed, ...options });
      const panel = document.getElementById(panelId);
      if (collapsed) panel.classList.add('collapsed');
      else panel.classList.remove('collapsed');
    },
  });
  const tab = (sheet) =>
    document
      .getElementById('mobile-tab-bar')
      .children.find((button) => button.dataset.mobileSheet === sheet);
  const press = (sheet) => {
    const event = new Event('click', { cancelable: true });
    Object.defineProperty(event, 'target', { value: tab(sheet) });
    document.getElementById('mobile-tab-bar').dispatchEvent(event);
  };
  const resize = (matches) => {
    media.matches = matches;
    const event = new Event('change');
    event.matches = matches;
    media.dispatchEvent(event);
  };
  const setBodyClass = (name) => {
    document.body.classList.add(name);
    observed?.();
  };
  const collapsed = (id) =>
    document.getElementById(id).classList.contains('collapsed');
  const runFrames = () => frames.splice(0).forEach((callback) => callback());
  return {
    document,
    shell,
    calls,
    runFrames,
    closedCount: () => closedCount,
    press,
    tab,
    resize,
    viewport,
    search,
    setBodyClass,
    mutateLayers: () => layersObserved?.(),
    collapsed,
  };
}

test('every tab names a sheet and every sheet panel maps back to its sheet', () => {
  assert.deepEqual(
    MOBILE_TABS.map(({ sheet }) => sheet),
    Object.keys(MOBILE_SHEET_PANELS).filter(sheet => sheet !== 'radio'),
  );
  for (const [sheet, panels] of Object.entries(MOBILE_SHEET_PANELS))
    for (const panelId of panels) assert.equal(sheetForPanelId(panelId), sheet);
  assert.equal(sheetForPanelId('unknown-panel'), null);
});

test('pressing a tab opens its sheet, pressing it again closes it', () => {
  assert.equal(nextSheet(null, 'layers'), 'layers');
  assert.equal(nextSheet('layers', 'layers'), null);
  assert.equal(nextSheet('layers', 'scenes'), 'scenes');
  assert.equal(nextSheet('layers', 'more'), 'more');
  assert.equal(nextSheet('layers', 'nonsense'), null);
  assert.equal(nextSheet(null, 'constructor'), null);
});

test('tab transitions only apply the latest requested tab', async () => {
  const { document, shell, press } = fixture();
  press('layers');
  const animations = [];
  document.documentElement = element('html', document);
  document.startViewTransition = (update) => {
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    const animation = { finished, skipTransition: () => { update(); finish(); }, finish: () => { update(); finish(); } };
    animations.push(animation);
    return animation;
  };
  press('scenes');
  assert.equal(shell.getSheet(), 'layers');
  press('context');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shell.getSheet(), 'layers');
  animations[1].finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shell.getSheet(), 'context');
  shell.destroy();
});

test('closing a sheet cancels a pending tab switch', async () => {
  const { document, shell, press } = fixture();
  press('layers');
  let finish;
  document.documentElement = element('html', document);
  document.startViewTransition = (update) => ({
    finished: new Promise((resolve) => { finish = resolve; }),
    skipTransition: () => { update(); finish(); },
  });
  press('scenes');
  shell.setSheet(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shell.getSheet(), null);
  shell.destroy();
});

test('selecting a shot lowers Scenes once and the handle restores its previous height', () => {
  const { document, shell, press } = fixture();
  const panel = document.getElementById('scene-panel');
  press('scenes');
  document.body.setAttribute('data-mobile-scenes-expanded', '');
  panel.dispatchEvent(new Event('mobile-scene-shot-selected'));
  panel.dispatchEvent(new Event('mobile-scene-shot-selected'));
  assert.equal(document.body.hasAttribute('data-mobile-scenes-lowered'), true);
  assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), true);
  panel.dispatchEvent(new Event('mobile-scene-expand'));
  assert.equal(document.body.hasAttribute('data-mobile-scenes-lowered'), false);
  assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), true);
  panel.dispatchEvent(new Event('mobile-scene-shot-selected'));
  press('layers');
  assert.equal(document.body.hasAttribute('data-mobile-scenes-lowered'), false);
  panel.dispatchEvent(new Event('mobile-scene-shot-selected'));
  assert.equal(document.body.hasAttribute('data-mobile-scenes-lowered'), false);
  shell.destroy();
});

test('opening the first tab uses the sheet transition', async () => {
  const { document, shell, press } = fixture();
  document.documentElement = element('html', document);
  let update;
  let finish;
  document.startViewTransition = (callback) => {
    update = callback;
    return { finished: new Promise((resolve) => { finish = resolve; }), skipTransition: () => finish() };
  };
  press('scenes');
  assert.equal(shell.getSheet(), null);
  assert.equal(document.documentElement.getAttribute('data-tab-transition'), '');
  update();
  assert.equal(shell.getSheet(), 'scenes');
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.documentElement.getAttribute('data-tab-transition'), null);
  shell.destroy();
});

test('one sheet at a time, without a backdrop blocking the map', () => {
  const { document, shell, press, tab } = fixture();
  assert.equal(document.body.classList.contains('mobile-shell'), true);
  press('layers');
  assert.equal(shell.getSheet(), 'layers');
  assert.equal(document.body.getAttribute('data-mobile-sheet'), 'layers');
  assert.equal(tab('layers').getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('mobile-sheet-backdrop'), null);
  press('more');
  assert.equal(shell.getSheet(), 'more');
  assert.equal(tab('layers').getAttribute('aria-expanded'), 'false');
  assert.equal(tab('more').getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('mobile-sheet-backdrop'), null);
  press('more');
  assert.equal(shell.getSheet(), null);
  assert.equal(document.body.getAttribute('data-mobile-sheet'), null);
  assert.equal(document.getElementById('mobile-sheet-backdrop'), null);
});

test('Layers Active filter tracks enabled rows and updates when one turns off', () => {
  const { document, press, mutateLayers } = fixture();
  const list = document.getElementById('data-toggles');
  const count = document.getElementById('mobile-layers-active-count');
  const total = document.getElementById('mobile-layers-count');
  const addRow = (active) => {
    const row = element('div', document);
    const toggle = element('button', document);
    toggle.classList.add('data-toggle-btn');
    if (active) toggle.classList.add('active');
    row.append(toggle);
    list.append(row);
    return toggle;
  };
  const first = addRow(true);
  addRow(true);
  addRow(false);
  mutateLayers();
  assert.equal(count.textContent, '2');
  assert.equal(total.textContent, '3');
  press('layers');
  list.scrollTop = 90;
  const active = document.getElementById('mobile-layers-active');
  active.dispatchEvent(new Event('click'));
  assert.equal(document.body.getAttribute('data-mobile-layer-filter'), 'active');
  assert.equal(active.getAttribute('aria-pressed'), 'true');
  assert.equal(list.scrollTop, 0);
  first.classList.remove('active');
  mutateLayers();
  assert.equal(count.textContent, '1');
  assert.equal(total.textContent, '3');
  addRow(false);
  mutateLayers();
  assert.equal(total.textContent, '4');
  document.getElementById('mobile-layers-all').dispatchEvent(new Event('click'));
  assert.equal(document.body.getAttribute('data-mobile-layer-filter'), null);
  assert.equal(active.getAttribute('aria-pressed'), 'false');
});

test('Layers handle expands over search, collapses, then closes; close button works at either height', async () => {
  const { document, shell, press } = fixture();
  const body = document.body;
  const handle = document.getElementById('mobile-layers-handle');
  const drag = (endY) => {
    const start = new Event('touchstart');
    start.touches = [{ identifier: 1, clientY: 100 }];
    handle.dispatchEvent(start);
    const move = new Event('touchmove', { cancelable: true });
    move.touches = [{ identifier: 1, clientY: endY }];
    handle.dispatchEvent(move);
    const end = new Event('touchend');
    end.touches = [];
    end.changedTouches = [{ identifier: 1, clientY: endY }];
    handle.dispatchEvent(end);
  };
  press('layers');
  assert.equal(body.getAttribute('data-mobile-layers-expanded'), null);
  drag(30);
  assert.equal(body.getAttribute('data-mobile-layers-expanded'), '');
  assert.equal(handle.getAttribute('aria-expanded'), 'true');
  drag(170);
  assert.equal(body.getAttribute('data-mobile-layers-expanded'), null);
  assert.equal(shell.getSheet(), 'layers');
  drag(170);
  assert.equal(shell.getSheet(), null);
  press('layers');
  handle.dispatchEvent(new Event('click'));
  assert.equal(body.getAttribute('data-mobile-layers-expanded'), '');
  const toggles = element('div', document);
  toggles.id = 'data-toggles';
  toggles.scrollTop = 120;
  document.getElementById('data-panel').append(toggles);
  document.getElementById('mobile-layers-close').dispatchEvent(new Event('click'));
  assert.equal(shell.getSheet(), 'layers');
  assert.equal(document.getElementById('left-panel-stack').style.values.get('transform'), 'translateY(110%)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(shell.getSheet(), null);
  assert.equal(body.getAttribute('data-mobile-layers-expanded'), null);
  assert.equal(toggles.scrollTop, 0);
  press('layers');
  assert.equal(toggles.scrollTop, 0);
});

test('Layers follows the finger between compact and expanded heights', async () => {
  const { document, shell, press } = fixture();
  document.defaultView = { innerHeight: 844 };
  document.getElementById('mobile-tab-bar').getBoundingClientRect =
    () => ({ height: 74 });
  const root = document.getElementById('left-panel-stack');
  const handle = document.getElementById('mobile-layers-handle');
  const touch = (type, y) => {
    const event = new Event(type, { cancelable: true });
    event.touches = type === 'touchend' ? [] : [{ identifier: 1, clientY: y }];
    event.changedTouches = [{ identifier: 1, clientY: y }];
    handle.dispatchEvent(event);
    return event;
  };
  press('layers');
  touch('touchstart', 450);
  assert.equal(touch('touchmove', 350).defaultPrevented, true);
  assert.equal(document.body.getAttribute('data-mobile-layers-dragging'), '');
  const growingHeight = Number.parseFloat(root.style.values.get('height'));
  assert.ok(growingHeight > 380 && growingHeight < 698);
  touch('touchmove', -500);
  assert.equal(Number.parseFloat(root.style.values.get('height')), 698);
  touch('touchend', 350);
  assert.equal(document.body.getAttribute('data-mobile-layers-expanded'), '');
  assert.equal(root.style.values.has('height'), false);
  touch('touchstart', 50);
  touch('touchmove', 250);
  const shrinkingHeight = Number.parseFloat(root.style.values.get('height'));
  assert.ok(shrinkingHeight > 380 && shrinkingHeight < 844);
  touch('touchend', 250);
  assert.equal(document.body.getAttribute('data-mobile-layers-expanded'), null);
  touch('touchstart', 450);
  touch('touchmove', 550);
  assert.equal(root.style.values.get('transform'), 'translateY(100px)');
  touch('touchend', 550);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(shell.getSheet(), null);
});

test('sheets borrow panels and put them back exactly as they were', () => {
  // The user left Data Layers and Presets open on desktop.
  const kept = ['data-panel', 'control-panel'];
  const { calls, press, collapsed } = fixture({ expanded: kept });
  press('cameras');
  assert.equal(collapsed('cctv-panel'), false);
  assert.equal(collapsed('street-level-panel'), false);
  press('layers');
  assert.equal(collapsed('cctv-panel'), true, 'Cameras put back on switch');
  assert.equal(collapsed('data-panel'), false);
  press('layers');
  for (const id of PANEL_IDS)
    assert.equal(collapsed(id), !kept.includes(id), `${id} is back as it was`);
  // Nothing a sheet does is the user's choice, persisted or shared.
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.explicit, undefined, `${call.panelId} is not explicit`);
    assert.equal(call.persist, false);
    assert.equal(call.syncShare, false);
  }
  // Already-open panels are not touched.
  assert.ok(!calls.some(({ panelId }) => kept.includes(panelId)));
});

test('Layers and Scenes open only their own panels', () => {
  const { press, collapsed } = fixture();
  press('layers');
  assert.equal(collapsed('data-panel'), false);
  assert.equal(collapsed('scene-panel'), true);
  press('scenes');
  assert.equal(collapsed('data-panel'), true);
  assert.equal(collapsed('scene-panel'), false);
  press('scenes');
  assert.equal(collapsed('scene-panel'), true);
});

test('a panel the user changes inside a sheet stays as they left it', () => {
  const { press, collapsed, document } = fixture();
  press('cameras');
  // The user collapses CCTV inside the sheet (their own, persisted choice).
  document.getElementById('cctv-panel').classList.add('collapsed');
  press('cameras');
  assert.equal(collapsed('cctv-panel'), true, 'their collapse is kept');
  assert.equal(
    collapsed('street-level-panel'),
    true,
    'the borrowed one is put back',
  );

  // Expanding one in a sheet is kept too, and later sheets respect it.
  press('layers');
  document.getElementById('cctv-panel').classList.remove('collapsed');
  press('more');
  press('more');
  assert.equal(collapsed('cctv-panel'), false);
});

test('mobile search uses the existing input and returns it to the dock on desktop', () => {
  const { document, resize, search, shell } = fixture();
  assert.equal(document.getElementById('mobile-search-bar').contains(search), true);
  assert.equal(document.getElementById('location-bar').contains(search), false);
  resize(false);
  assert.equal(document.getElementById('location-bar').contains(search), true);
  resize(true);
  assert.equal(document.getElementById('mobile-search-bar').contains(search), true);
  shell.destroy();
  assert.equal(document.getElementById('location-bar').contains(search), true);
  assert.equal(document.getElementById('mobile-search-bar'), null);
});

test('search opens over the map without a backdrop and closes with X or Escape', () => {
  const { document, search } = fixture();
  const body = document.body;
  const open = () => body.getAttribute('data-mobile-search-open') !== null;
  assert.equal(document.getElementById('mobile-search-backdrop'), null);
  search.focus();
  assert.equal(open(), true);
  document.getElementById('mobile-search-close').dispatchEvent(new Event('click'));
  assert.equal(open(), false);
  assert.equal(document.activeElement, body);
  search.focus();
  const escape = new Event('keydown', { cancelable: true });
  escape.key = 'Escape';
  document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(open(), false);
});

test('city selection closes search and reuses the existing POI buttons in details', () => {
  const { document, search, resize, shell } = fixture();
  const pois = document.getElementById('poi-row');
  search.focus();
  shell.showCity('Austin');
  assert.equal(document.body.getAttribute('data-mobile-search-open'), null);
  assert.equal(search.value, 'Austin');
  assert.equal(document.getElementById('mobile-details-title').textContent, 'Austin');
  assert.equal(document.getElementById('mobile-details-content').contains(pois), true);
  assert.equal(document.body.getAttribute('data-mobile-details'), '');
  document.getElementById('mobile-details-close').dispatchEvent(new Event('click'));
  assert.equal(document.body.getAttribute('data-mobile-details'), null);
  assert.equal(search.value, '', 'closing details restores the search placeholder');
  assert.equal(document.body.getAttribute('data-mobile-search-typing'), null);
  search.focus();
  shell.showDestination('Paris');
  assert.equal(search.value, 'Paris');
  assert.equal(document.body.hasAttribute('data-mobile-details'), true);
  assert.equal(document.getElementById('mobile-details-title').textContent, 'Paris');
  assert.equal(document.getElementById('mobile-details').hasAttribute('data-location-only'), true);
  assert.equal(document.getElementById('mobile-details-content').contains(pois), false, 'search must not reuse the previous city POIs');
  assert.equal(document.body.getAttribute('data-mobile-search-open'), null);
  resize(false);
  assert.equal(document.getElementById('location-bar-popover').contains(pois), true);
});

test('the details handle closes on a downward swipe', () => {
  const { document, search, shell } = fixture();
  const handle = document.getElementById('mobile-details').children[0];
  const touch = (type, y) => {
    const event = new Event(type, { cancelable: true });
    event.touches = type === 'touchend' ? [] : [{ identifier: 1, clientY: y }];
    handle.dispatchEvent(event);
  };
  shell.showCity('London');
  touch('touchstart', 20);
  touch('touchmove', 50);
  assert.equal(document.getElementById('mobile-details').style.values.get('transform'), 'translateY(30px)');
  touch('touchend', 50);
  assert.equal(document.getElementById('mobile-details').style.values.has('transform'), false);
  assert.equal(document.body.getAttribute('data-mobile-details'), '');
  touch('touchstart', 20);
  touch('touchmove', 100);
  touch('touchend', 100);
  assert.equal(document.body.getAttribute('data-mobile-details'), null);
  assert.equal(search.value, '');
});

test('focus moves into the sheet and returns to the tab on close', () => {
  const { document, press, search, tab } = fixture();
  search.focus();
  assert.equal(document.activeElement, search);
  press('layers');
  const dataPanel = document.getElementById('data-panel');
  // The first visible control that is not the panel's own collapse button.
  assert.equal(document.activeElement, dataPanel.children[2]);
  const escape = new Event('keydown', { cancelable: true });
  escape.key = 'Escape';
  document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(document.activeElement, tab('layers'));
});

test('the share link keeps the state from before the sheets', () => {
  const { shell, press, document, closedCount } = fixture({
    expanded: ['street-level-panel'],
  });
  assert.equal(shell.sharedCollapsed('data-panel'), undefined);
  press('layers');
  // Data Layers is open only because the sheet borrowed it.
  assert.equal(shell.sharedCollapsed('data-panel'), true);
  assert.equal(shell.sharedCollapsed('street-level-panel'), false);
  assert.equal(shell.sharedCollapsed('unrelated-panel'), undefined);
  // A user change inside the sheet is theirs to share.
  document.getElementById('cctv-panel').classList.remove('collapsed');
  assert.equal(shell.sharedCollapsed('cctv-panel'), false);
  press('more');
  assert.equal(closedCount(), 0, 'switching sheets is not closing');
  press('more');
  assert.equal(closedCount(), 1, 'closing refreshes the share link once');
  assert.equal(shell.sharedCollapsed('data-panel'), undefined);
});

test('Escape closes the sheet only when nothing else took it', () => {
  const { document, shell, press } = fixture();
  const escape = () => {
    const event = new Event('keydown', { cancelable: true, bubbles: true });
    event.key = 'Escape';
    return event;
  };
  press('layers');
  // A field cancelling its edit (or a lightbox closing) handles it first.
  const handled = escape();
  handled.preventDefault();
  document.dispatchEvent(handled);
  assert.equal(shell.getSheet(), 'layers');
  // An open dialog keeps Escape for its native close.
  document.openDialog = true;
  document.dispatchEvent(escape());
  assert.equal(shell.getSheet(), 'layers');
  document.openDialog = false;
  const plain = escape();
  document.dispatchEvent(plain);
  assert.equal(shell.getSheet(), null);
  assert.equal(plain.defaultPrevented, true);
});

test('share state and restores follow the preference, not layout collapse', () => {
  const { shell, press, collapsed, document } = fixture();
  // Layout collapsed Street Level only for space; the user left it open.
  const street = document.getElementById('street-level-panel');
  street.classList.add('layout-auto-collapsed');
  press('cameras');
  assert.equal(shell.sharedCollapsed('street-level-panel'), false);
  press('cameras');
  assert.equal(
    collapsed('street-level-panel'),
    false,
    'not turned into a real collapse',
  );
});

test('layout settling after a sheet opens is part of opening', () => {
  const { press, runFrames, collapsed, document } = fixture({
    expanded: ['street-level-panel'],
  });
  press('cameras');
  // A rail layout pass on the next frame collapses Street Level.
  document.getElementById('street-level-panel').classList.add('collapsed');
  runFrames();
  press('cameras');
  assert.equal(collapsed('street-level-panel'), false, 'put back as it was');
});

test('the active navigation tab uses the standard closing transition for every sheet', async () => {
  for (const { sheet } of MOBILE_TABS) {
    const { document, shell, press } = fixture();
    press(sheet);
    document.documentElement = element('html', document);
    let update;
    let finish;
    document.startViewTransition = (callback) => {
      update = callback;
      return { finished: new Promise((resolve) => { finish = resolve; }), skipTransition: () => finish() };
    };
    press(sheet);
    assert.equal(shell.getSheet(), sheet);
    assert.equal(document.documentElement.getAttribute('data-tab-transition'), '');
    update();
    assert.equal(shell.getSheet(), null);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.documentElement.getAttribute('data-tab-transition'), null);
    shell.destroy();
  }
});

test('a map click does not close a navigation sheet', () => {
  const { document, shell, press } = fixture();
  press('context');
  document.body.dispatchEvent(new Event('click'));
  assert.equal(shell.getSheet(), 'context');
  shell.destroy();
});

test('surfaces that own the screen close sheets; scene playback does not', () => {
  for (const mode of ['cockpit-mode', 'recording-mode', 'ui-clean-view']) {
    const { shell, press, setBodyClass, collapsed } = fixture();
    press('layers');
    setBodyClass(mode);
    assert.equal(shell.getSheet(), null, `${mode} closes the sheet`);
    assert.equal(collapsed('data-panel'), true, `${mode} puts panels back`);
    press('layers');
    assert.equal(shell.getSheet(), null, `${mode} keeps sheets closed`);
  }
  // Scene STOP lives in the Scenes sheet.
  const playback = fixture();
  playback.setBodyClass('scene-playback-mode');
  playback.press('scenes');
  assert.equal(playback.shell.getSheet(), 'scenes');
  assert.equal(playback.collapsed('scene-panel'), false);
});

test('desktop widths never see the shell; crossing to desktop restores it', () => {
  const desktop = fixture({ mobile: false });
  assert.equal(desktop.document.body.classList.contains('mobile-shell'), false);
  desktop.press('layers');
  assert.equal(desktop.shell.getSheet(), null);
  assert.equal(
    desktop.viewport.getAttribute('content'),
    'width=device-width, initial-scale=1.0',
  );

  const phone = fixture({ expanded: ['street-level-panel'] });
  assert.match(phone.viewport.getAttribute('content'), /viewport-fit=cover$/);
  phone.press('cameras');
  phone.resize(false);
  assert.equal(phone.shell.getSheet(), null);
  assert.equal(phone.document.body.classList.contains('mobile-shell'), false);
  assert.equal(phone.collapsed('cctv-panel'), true);
  assert.equal(phone.collapsed('street-level-panel'), false);
  assert.equal(
    phone.viewport.getAttribute('content'),
    'width=device-width, initial-scale=1.0',
  );
});

test('destroy puts panels back and removes the shell', () => {
  const { document, shell, press, viewport, collapsed } = fixture();
  press('layers');
  shell.destroy();
  assert.equal(collapsed('data-panel'), true);
  assert.equal(document.getElementById('mobile-tab-bar'), null);
  assert.equal(document.getElementById('mobile-footer-scrim'), null);
  assert.equal(document.getElementById('mobile-sheet-backdrop'), null);
  assert.equal(document.body.classList.contains('mobile-shell'), false);
  assert.equal(document.body.getAttribute('data-mobile-sheet'), null);
  assert.equal(document.body.style.values.size, 0);
  assert.equal(
    viewport.getAttribute('content'),
    'width=device-width, initial-scale=1.0',
  );
});

test('the phone shell keeps the required attribution visible', () => {
  // Whitespace-normalised, so formatter line wrapping cannot hide a rule.
  const css = readFileSync(
    new URL('./styles/mobile-shell.css', import.meta.url),
    'utf8',
  )
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
  /** The declaration block of the rule whose selector list ends with `selector`. */
  const rule = (selector) => {
    const end = css.indexOf(`${selector} {`);
    assert.notEqual(end, -1, `missing rule ending in ${selector}`);
    const open = css.indexOf('{', end);
    return css.slice(open, css.indexOf('}', open));
  };
  const z = (block) => Number(/z-index: (\d+);/.exec(block)?.[1]);
  const idleCredit = rule(
    'body.mobile-shell:not(.recording-mode):not(.cockpit-mode):not(.ui-clean-view) #cesium-credits',
  );
  // Follow the map buttons, with navigation clearance before layout is measured.
  assert.match(idleCredit, /bottom: var\(--mobile-map-credits-bottom, calc\(var\(--mobile-tab-space\) \+ 2px\)\) !important;/);
  // It must beat the dock's :has() placements, so the offset is !important.
  assert.match(idleCredit, /\) !important;/);
  assert.doesNotMatch(
    idleCredit,
    /display:\s*none|visibility:\s*hidden|opacity:\s*0/,
  );
  // Sheets share the map-button position and retain their credit stacking order.
  const sheetCredit = rule(
    'body.mobile-shell[data-mobile-sheet]:not(.recording-mode):not(.cockpit-mode):not(.ui-clean-view) #cesium-credits',
  );
  assert.doesNotMatch(
    sheetCredit,
    /bottom:/,
  );
  const openDock = rule('body.mobile-shell[data-mobile-sheet] #command-dock');
  const railSheet = rule(
    "body.mobile-shell[data-mobile-sheet='more'] #right-context-rail",
  );
  assert.ok(z(sheetCredit) > z(openDock));
  assert.ok(z(sheetCredit) > z(railSheet));
});

function touchEvent(
  document,
  type,
  target,
  { x = 10, y = 10, count = 1, id = 1, cancelable = true } = {},
) {
  const event = new Event(type, { cancelable });
  const touch = { identifier: id, clientX: x, clientY: y };
  Object.defineProperty(event, 'target', { value: target });
  event.touches =
    type === 'touchend' || type === 'touchcancel'
      ? []
      : Array.from({ length: count }, (_, i) => ({
          ...touch,
          identifier: id + i,
        }));
  event.changedTouches = [touch];
  document.dispatchEvent(event);
  return event;
}

test('Layers can expand from its content and leave a scrolled list to native scrolling', () => {
  const { document, shell, press } = fixture();
  document.defaultView = { innerHeight: 844 };
  press('layers');
  const rail = document.getElementById('left-panel-stack');
  const list = document.getElementById('data-toggles');
  touchEvent(rail, 'touchstart', list, { y: 200 });
  assert.equal(touchEvent(rail, 'touchmove', list, { y: 100 }).defaultPrevented, true);
  touchEvent(rail, 'touchend', list, { y: 100 });
  assert.equal(document.body.hasAttribute('data-mobile-layers-expanded'), true);
  list.scrollTop = 100;
  touchEvent(rail, 'touchstart', list, { y: 100 });
  assert.equal(touchEvent(rail, 'touchmove', list, { y: 200 }).defaultPrevented, false);
  touchEvent(rail, 'touchend', list, { y: 200 });
  assert.equal(document.body.hasAttribute('data-mobile-layers-expanded'), true);
  shell.destroy();
});

test('City details drag from content and preserve horizontal place swipes', () => {
  const { document, shell } = fixture();
  shell.showCity('London');
  const panel = document.getElementById('mobile-details');
  const content = document.getElementById('mobile-details-content');
  touchEvent(panel, 'touchstart', content, { x: 10, y: 100 });
  assert.equal(touchEvent(panel, 'touchmove', content, { x: 100, y: 105 }).defaultPrevented, false);
  touchEvent(panel, 'touchend', content, { x: 100, y: 105 });
  assert.equal(document.body.hasAttribute('data-mobile-details'), true);
  touchEvent(panel, 'touchstart', content, { y: 100 });
  assert.equal(touchEvent(panel, 'touchmove', content, { y: 180 }).defaultPrevented, true);
  assert.equal(panel.style.values.get('transform'), 'translateY(80px)');
  touchEvent(panel, 'touchend', content, { y: 180 });
  assert.equal(document.body.hasAttribute('data-mobile-details'), false);
  shell.destroy();
});

test('Scenes keeps compact content scrolling and expands from the handle', () => {
  const { document, shell, press } = fixture();
  press('scenes');
  const panel = document.getElementById('scene-panel');
  const rail = document.getElementById('left-panel-stack');
  rail.getBoundingClientRect = () => ({ top: 300, height: 400 });
  const content = { scrollTop: 0, clientHeight: 300, scrollHeight: 900 };
  const card = { closest: (selector) => selector === '.mobile-scene-content' ? content : null };
  touchEvent(panel, 'touchstart', card, { y: 200 });
  assert.equal(touchEvent(panel, 'touchmove', card, { y: 100 }).defaultPrevented, false);
  touchEvent(panel, 'touchend', card, { y: 100 });
  assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), false);
  const handle = { closest: (selector) => selector === '[data-mobile-scene-handle]' ? {} : null };
  touchEvent(panel, 'touchstart', handle, { y: 200 });
  assert.equal(touchEvent(panel, 'touchmove', handle, { y: 100 }).defaultPrevented, true);
  touchEvent(panel, 'touchend', handle, { y: 100 });
  assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), true);
  touchEvent(panel, 'touchstart', card, { y: 200 });
  assert.equal(touchEvent(panel, 'touchmove', card, { y: 100 }).defaultPrevented, false);
  touchEvent(panel, 'touchend', card, { y: 100 });
  content.scrollTop = 100;
  touchEvent(panel, 'touchstart', card, { y: 100 });
  assert.equal(touchEvent(panel, 'touchmove', card, { y: 200 }).defaultPrevented, false);
  touchEvent(panel, 'touchend', card, { y: 200 });
  assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), true);
  content.scrollTop = 0;
  touchEvent(panel, 'touchstart', card, { y: 100 });
  assert.equal(touchEvent(panel, 'touchmove', card, { y: 200 }).defaultPrevented, true);
  touchEvent(panel, 'touchend', card, { y: 200 });
  assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), false);
  shell.destroy();
});

test('compact Layers scrolls before expanding and does not steal a gesture at the list end', () => {
  const { document, shell, press } = fixture();
  document.defaultView = { innerHeight: 844 };
  press('layers');
  const rail = document.getElementById('left-panel-stack');
  const list = document.getElementById('data-toggles');
  Object.assign(list, { scrollTop: 0, clientHeight: 200, scrollHeight: 600 });
  touchEvent(rail, 'touchstart', list, { y: 200 });
  assert.equal(touchEvent(rail, 'touchmove', list, { y: 180 }).defaultPrevented, false);
  list.scrollTop = 400;
  assert.equal(touchEvent(rail, 'touchmove', list, { y: 100 }).defaultPrevented, false);
  touchEvent(rail, 'touchend', list, { y: 100 });
  assert.equal(document.body.hasAttribute('data-mobile-layers-expanded'), false);
  shell.destroy();
});

test('Scenes editor outer scroller and lowered content keep native scroll priority', () => {
  for (const lowered of [false, true]) {
    const { document, shell, press } = fixture();
    press('scenes');
    if (lowered) document.body.setAttribute('data-mobile-scenes-lowered', '');
    const panel = document.getElementById('scene-panel');
    const outer = { scrollTop: 50, clientHeight: 200, scrollHeight: 800 };
    const card = { closest: selector => selector === '.scene-panel-inner' ? outer : null };
    for (const y of [100, 300]) {
      touchEvent(panel, 'touchstart', card, { y: 200 });
      assert.equal(touchEvent(panel, 'touchmove', card, { y }).defaultPrevented, false);
      touchEvent(panel, 'touchend', card, { y });
    }
    assert.equal(document.body.hasAttribute('data-mobile-scenes-expanded'), false);
    assert.equal(document.body.hasAttribute('data-mobile-scenes-lowered'), lowered);
    shell.destroy();
  }
});

test('downward sheet pull closes through borrowed-panel lifecycle and returns tab focus', () => {
  for (const sheet of Object.keys(MOBILE_SHEET_PANELS).filter((name) => !['layers', 'scenes', 'more', 'radio'].includes(name))) {
    const phone = fixture();
    const { document, shell, press, tab } = phone;
    press(sheet);
    const target = document.getElementById(MOBILE_SHEET_PANELS[sheet][0]);
    touchEvent(document, 'touchstart', target);
    const move = touchEvent(document, 'touchmove', target, { y: 90 });
    assert.equal(move.defaultPrevented, true);
    assert.equal(shell.getSheet(), sheet, 'waits until finger lifts');
    touchEvent(document, 'touchend', target, { y: 90 });
    assert.equal(shell.getSheet(), null);
    assert.equal(phone.closedCount(), 1);
    assert.equal(document.activeElement, tab(sheet));
    for (const id of MOBILE_SHEET_PANELS[sheet])
      assert.equal(phone.collapsed(id), true);
    assert.ok(
      phone.calls.every(
        (call) => call.persist === false && call.syncShare === false,
      ),
    );
    shell.destroy();
  }
});

test('content scroll stays native, including a scroll that reaches the top mid-gesture', () => {
  for (const nested of [false, true]) {
    const { document, shell, press } = fixture();
    press('layers');
    const panel = document.getElementById('data-panel');
    const scroller = nested
      ? panel
      : document.getElementById('left-panel-stack');
    scroller.scrollTop = 40;
    touchEvent(document, 'touchstart', panel);
    scroller.scrollTop = 0;
    assert.equal(
      touchEvent(document, 'touchmove', panel, { y: 120 }).defaultPrevented,
      false,
    );
    touchEvent(document, 'touchend', panel, { y: 120 });
    assert.equal(shell.getSheet(), 'layers');
    shell.destroy();
  }
});

test('taps, short pulls, upward and horizontal gestures never dismiss', () => {
  for (const path of [
    [],
    [{ x: 12, y: 14 }],
    [{ y: 40 }],
    [{ y: -30 }, { y: 120 }],
    [{ x: 60, y: 12 }, { y: 120 }],
  ]) {
    const { document, shell, press } = fixture();
    press('layers');
    const panel = document.getElementById('data-panel');
    touchEvent(document, 'touchstart', panel);
    for (const point of path) touchEvent(document, 'touchmove', panel, point);
    touchEvent(document, 'touchend', panel, path.at(-1) ?? {});
    assert.equal(shell.getSheet(), 'layers');
    shell.destroy();
  }
});

test('native controls and custom sliders keep touch gestures', () => {
  for (const tag of [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    'slider',
    'editable',
  ]) {
    const { document, shell, press } = fixture();
    press('more');
    const control = document.createElement(
      ['slider', 'editable'].includes(tag) ? 'div' : tag,
    );
    if (tag === 'slider') control.setAttribute('role', 'slider');
    if (tag === 'editable') control.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    control.append(child);
    document.getElementById('control-panel').append(control);
    touchEvent(document, 'touchstart', child);
    assert.equal(
      touchEvent(document, 'touchmove', child, { y: 120 }).defaultPrevented,
      false,
    );
    touchEvent(document, 'touchend', child, { y: 120 });
    assert.equal(shell.getSheet(), 'more');
    shell.destroy();
  }
});

test('multitouch, cancellation, sheet changes and desktop transitions abandon the gesture', () => {
  for (const cancel of [
    'multitouch',
    'cancel',
    'sheet',
    'desktop',
    'noncancelable',
  ]) {
    const { document, shell, press, resize } = fixture();
    press('layers');
    const panel = document.getElementById('data-panel');
    touchEvent(document, 'touchstart', panel);
    if (cancel === 'multitouch')
      touchEvent(document, 'touchstart', document.body, { count: 2 });
    if (cancel === 'cancel') touchEvent(document, 'touchcancel', panel);
    if (cancel === 'sheet') press('context');
    if (cancel === 'desktop') {
      resize(false);
      resize(true);
      press('layers');
    }
    if (cancel === 'noncancelable')
      touchEvent(document, 'touchmove', panel, { y: 30, cancelable: false });
    assert.equal(
      touchEvent(document, 'touchmove', panel, { y: 120 }).defaultPrevented,
      false,
    );
    touchEvent(document, 'touchend', panel, { y: 120 });
    assert.equal(shell.getSheet(), cancel === 'sheet' ? 'context' : 'layers');
    shell.destroy();
  }
});

test('touches outside the active sheet and destroyed listeners cannot dismiss or claim a gesture', () => {
  const { document, shell, press } = fixture();
  press('layers');
  const hiddenPanel = document.getElementById('global-context-panel');
  touchEvent(document, 'touchstart', hiddenPanel);
  assert.equal(
    touchEvent(document, 'touchmove', hiddenPanel, { y: 120 }).defaultPrevented,
    false,
  );
  touchEvent(document, 'touchend', hiddenPanel, { y: 120 });
  assert.equal(shell.getSheet(), 'layers');
  const panel = document.getElementById('data-panel');
  touchEvent(document, 'touchstart', panel);
  shell.destroy();
  assert.equal(
    touchEvent(document, 'touchmove', panel, { y: 120 }).defaultPrevented,
    false,
  );
  touchEvent(document, 'touchend', panel, { y: 120 });
  assert.equal(shell.getSheet(), null);
});

test('the tab-open callback reports only a successful manual opening', () => {
  const opened = [];
  const phone = fixture({ onTabOpened: (sheet) => opened.push(sheet) });
  phone.shell.setSheet('context');
  assert.deepEqual(opened, []);
  phone.press('context');
  assert.deepEqual(opened, [], 'closing is not a new context request');
  phone.press('context');
  assert.deepEqual(opened, ['context']);
  phone.setBodyClass('cockpit-mode');
  phone.press('context');
  assert.deepEqual(
    opened,
    ['context'],
    'blocked sheets cannot activate a mode',
  );
  phone.shell.destroy();
});

test('manual Context opens the existing transaction without disabling the tracked aircraft', async () => {
  const calls = [];
  const tracked = { layerId: 'flights', icao24: 'abc123', callsign: 'EJA225' };
  const viewer = { trackedEntity: { gevTrackedId: 'flights:abc123' } };
  const entity = viewer.trackedEntity;
  const enabled = new Set(['flights', 'weather']);
  const controls = new ContextControls({
    elements: {},
    installations: {},
    actions: {
      getCockpit: () => null,
      claimVisualAuthority: () => calls.push('claim'),
      syncDetection() {},
      scheduleLayout() {},
      showToast() {},
    },
  });
  controls.connect({
    layers: new Map(
      ['flights', 'weather', 'military-awareness'].map((id) => [id, {}]),
    ),
    getEnabledLayerIds: () => [...enabled],
    getLayerParams: () => ({}),
    isEffectivelyEnabled: (id) => enabled.has(id),
    isEnabled: (id) => enabled.has(id),
    setLayerParams: (id, params) => calls.push({ id, params }),
    setEnabled: async (id, value) => {
      calls.push({ id, value });
      if (!value) enabled.delete(id);
      if (id === 'flights' && !value) viewer.trackedEntity = null;
      return true;
    },
    _setEnabledWithIntent: (id, value) => {
      calls.push({ id, value });
      enabled.add(id);
      return { intentEpoch: 1, promise: Promise.resolve(true) };
    },
  });
  const shell = {
    cockpitView: {
      readAircraftInfo: () => (viewer.trackedEntity ? tracked : null),
    },
    getAircraftTrackingTarget: StyleManager.prototype.getAircraftTrackingTarget,
    getContextModeState: () => controls.getContextModeState(),
    setContextMode: (mode) => controls.setContextMode(mode),
    _showToast: () => assert.fail('successful entry must not report a failure'),
  };
  try {
    assert.equal(
      await StyleManager.prototype._onMobileTabOpened.call(shell, 'context'),
      true,
    );
    assert.equal(controls.getContextModeState().mode, 'flights');
    assert.equal(viewer.trackedEntity, entity);
    assert.deepEqual(shell.getAircraftTrackingTarget(), {
      layerId: 'flights',
      id: 'abc123',
    });
    assert.ok(enabled.has('flights'));
    assert.ok(
      calls.some(
        (call) => call.id === 'military-awareness' && call.value === true,
      ),
    );
    assert.ok(!calls.some((call) => call.id === 'flights'));
    const count = calls.length;
    assert.equal(
      await StyleManager.prototype._onMobileTabOpened.call(shell, 'context'),
      false,
    );
    assert.equal(
      calls.length,
      count,
      'an already active Contacts session is not restarted',
    );
  } finally {
    controls.stop();
    controls.disconnect();
  }
});

test('manual Context respects Space Missions, busy transitions, missing tracks and disposal', async () => {
  for (const state of [
    { mode: 'space-missions' },
    { mode: 'flights' },
    { changing: true },
    { entering: 'space-missions' },
    { noTrack: true },
    { disposed: true },
    { sheet: 'layers' },
  ]) {
    const shell = {
      _disposed: state.disposed,
      getContextModeState: () => state,
      getAircraftTrackingTarget: () =>
        state.noTrack ? null : { layerId: 'flights', id: 'abc123' },
      setContextMode: () =>
        assert.fail('guarded tab must not mutate Context or tracking'),
    };
    assert.equal(
      await StyleManager.prototype._onMobileTabOpened.call(
        shell,
        state.sheet || 'context',
      ),
      false,
    );
  }
});

test('failed mobile Contacts entry uses the existing notice and cancelled/disposed entries stay quiet', async () => {
  for (const outcome of ['failure', 'throw', 'cancelled', 'disposed']) {
    const notices = [];
    const shell = {
      getContextModeState: () => ({ mode: null }),
      getAircraftTrackingTarget: () => ({ layerId: 'flights', id: 'abc123' }),
      setContextMode: async () => {
        if (outcome === 'throw') throw new Error('source unavailable');
        if (outcome === 'disposed') shell._disposed = true;
        return { ok: false, cancelled: outcome === 'cancelled' };
      },
      _showToast: (message) => notices.push(message),
    };
    assert.equal(
      await StyleManager.prototype._onMobileTabOpened.call(shell, 'context'),
      false,
    );
    assert.equal(
      notices.length,
      ['failure', 'throw'].includes(outcome) ? 1 : 0,
    );
  }
});

test('a slow downward pull is claimed before Android native scroll takes ownership', async () => {
  const { document, shell, press } = fixture();
  press('scenes');
  const panel = document.getElementById('scene-panel');
  touchEvent(panel, 'touchstart', panel, { y: 100 });
  assert.equal(
    touchEvent(panel, 'touchmove', panel, { y: 102 }).defaultPrevented,
    false,
    'tap jitter is left native',
  );
  assert.equal(
    touchEvent(panel, 'touchmove', panel, { y: 109.3 }).defaultPrevented,
    true,
    'cancel the first directional move while Android still allows it',
  );
  assert.equal(
    touchEvent(panel, 'touchmove', panel, { y: 131 }).defaultPrevented,
    true,
  );
  touchEvent(panel, 'touchend', panel, { y: 195 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(shell.getSheet(), null);
  shell.destroy();
});


test('Explore opens without focusing the input and keeps native city controls across desktop resize', () => {
  const { document, resize, search, shell } = fixture();
  const cities = document.getElementById('location-pills');
  const searchBar = document.getElementById('mobile-search-bar');
  assert.equal(cities.parentElement.className, 'mobile-explore-cities');
  shell.openSearch();
  assert.equal(document.activeElement, searchBar, 'opening Explore must not invoke the phone keyboard');
  assert.equal(searchBar.inert, false);
  assert.equal(document.getElementById('mobile-tab-bar').inert, true);
  search.focus();
  assert.equal(document.activeElement, search, 'tapping the field still focuses it');
  resize(false);
  assert.equal(cities.parentElement.id, 'location-bar-popover');
  assert.equal(search.getAttribute('placeholder'), null);
  assert.equal(searchBar.inert, true);
  assert.equal(document.getElementById('mobile-tab-bar').inert, false);
  resize(true);
  assert.equal(cities.parentElement.className, 'mobile-explore-cities');
  shell.destroy();
  assert.equal(cities.parentElement.id, 'location-bar-popover');
});

test('Explore previews open the selected story through the scene panel and keep deleted stories hidden', () => {
  const opened = [];
  const stories = [];
  const { document, shell, tab } = fixture({ onTabOpened: sheet => opened.push(sheet) });
  document.getElementById('scene-panel').addEventListener('mobile-scene-open', event => stories.push(event.detail.sceneId));
  const searchBar = document.getElementById('mobile-search-bar');
  const cards = searchBar.querySelectorAll('button').filter(button => button.dataset.exploreScene);
  shell.openSearch();
  assert.equal(cards.filter(card => !card.hidden).length, 3);
  assert.equal(cards.find(card => card.dataset.exploreScene === 'city-overload').hidden, true);
  for (const sceneId of ['bhote-koshi-nepal-scene', 'flights-radar', 'orbital-watch']) {
    shell.openSearch();
    cards.find(card => card.dataset.exploreScene === sceneId).click();
    assert.equal(shell.getSheet(), 'scenes');
    assert.equal(document.body.hasAttribute('data-mobile-search-open'), false);
    assert.equal(stories.at(-1), sceneId);
    assert.equal(opened.at(-1), 'scenes');
    shell.setSheet(null);
    assert.equal(document.activeElement, tab('scenes'));
  }
  document.getElementById('scene-select').options = [];
  shell.openSearch();
  assert.ok(cards.every(card => card.hidden));
  shell.destroy();
});

test('clearing a typed query returns to Explore without replacing the native search input', () => {
  const { document, shell, search } = fixture();
  shell.openSearch();
  const content = document.getElementById('mobile-search-bar').children.find(node => node.className === 'mobile-explore-content');
  const query = content.children[0];
  const browse = content.children[1];
  assert.equal(query.hidden, true);
  search.value = '40.7128, -74.0060';
  search.dispatchEvent(new Event('input'));
  assert.equal(browse.hidden, true);
  assert.equal(query.hidden, false);
  document.getElementById('mobile-search-clear').click();
  assert.equal(search.value, '');
  assert.equal(browse.hidden, false);
  assert.equal(query.hidden, true);
  assert.equal(document.activeElement, search);
  shell.destroy();
});

test('Explore quick actions close search and explicitly open data without tab side effects', () => {
  const actions = [];
  const opened = [];
  const { document, shell, search, tab, press } = fixture({ readExploreView: () => ({ latitude: 40, longitude: -74 }), onExploreAction: action => actions.push(action), onTabOpened: sheet => opened.push(sheet) });
  const buttons = document.getElementById('mobile-search-bar').querySelectorAll('button').filter(button => button.dataset.exploreAction);
  assert.deepEqual(buttons.map(button => button.dataset.exploreAction), ['contacts', 'cameras', 'weather', 'radio']);
  const header = document.createElement('div');
  header.id = 'mobile-header-actions';
  const launcher = document.createElement('button');
  launcher.setAttribute('aria-controls', 'mobile-search-bar');
  header.append(launcher);
  document.body.append(header);
  for (const button of buttons) {
    const action = button.dataset.exploreAction;
    const expectedSheet = action === 'cameras' ? 'cameras' : action === 'radio' ? 'radio' : 'context';
    shell.openSearch();
    button.click();
    assert.equal(shell.getSheet(), expectedSheet);
    assert.equal(document.body.hasAttribute('data-mobile-search-open'), false);
    if (action !== 'weather') assert.equal(actions.at(-1), action);
    if (action === 'weather') {
      assert.equal(tab('context').getAttribute('aria-expanded'), 'false');
      assert.equal(document.body.hasAttribute('data-mobile-context-weather'), true);
      press('context');
      assert.equal(opened.pop(), 'context');
      assert.equal(document.body.hasAttribute('data-mobile-context-weather'), false);
      assert.equal(tab('context').getAttribute('aria-expanded'), 'true');
    }
    assert.equal(document.getElementById('location-search'), search);
    shell.setSheet(null);
    assert.equal(document.activeElement, expectedSheet === 'radio' ? document.getElementById('mobile-header-actions').querySelector('[aria-controls="mobile-search-bar"]') : tab(expectedSheet));
  }
  assert.deepEqual(opened, [], 'Radio must not implicitly enter Contacts for a tracked aircraft');
  shell.destroy();
});

function exploreActionHost() {
  const calls = [];
  const enabled = new Set();
  const host = {
    sheet: 'context',
    _mobileShell: { getSheet: () => host.sheet },
    _dataManager: {
      layers: new Map([['cctv', {}], ['radio', {}]]),
      isEnabled: id => enabled.has(id),
      setEnabled: async (id, value) => { calls.push(['enable', id, value]); enabled.add(id); return true; },
    },
    services: {
      cctvLayer: { focusNearest: options => calls.push(['camera', options]) },
      radioLayer: { getUIState: () => ({ audioState: 'idle' }), selectRequestedStation: (criteria, options) => calls.push(['radio', options]) },
    },
    setContextMode: async (mode, options) => { calls.push(['context', mode, options.notificationToken]); return { ok: true }; },
    setPanelCollapsed: (...args) => calls.push(['panel', ...args]),
    _radioControls: { _revealRadioPanelInsideContext: async () => calls.push(['reveal']) },
    _runUserFacingContextAction: async operation => operation('notification'),
  };
  return { host, calls };
}

test('Explore enables Contacts and cameras idempotently without flying', async () => {
  const { host, calls } = exploreActionHost();
  await StyleManager.prototype._openExploreAction.call(host, 'contacts');
  assert.deepEqual(calls, [['context', 'contacts', 'notification']]);
  calls.length = 0;
  host.sheet = 'cameras';
  await StyleManager.prototype._openExploreAction.call(host, 'cameras');
  await StyleManager.prototype._openExploreAction.call(host, 'cameras');
  assert.deepEqual(calls, [['enable', 'cctv', true], ['camera', { focus: false }], ['enable', 'cctv', true], ['camera', { focus: false }]]);
});

test('Explore Radio selects nearby silently and preserves an existing broadcast', async () => {
  const { host, calls } = exploreActionHost();
  host.sheet = 'radio';
  await StyleManager.prototype._openExploreAction.call(host, 'radio');
  assert.deepEqual(calls, [['enable', 'radio', true], ['radio', { autoplay: false, origin: 'user' }], ['panel', 'radio-panel', false, { explicit: true }]]);
  for (const audioState of ['playing', 'loading', 'buffering']) {
    calls.length = 0;
    host.services.radioLayer.getUIState = () => ({ audioState });
    await StyleManager.prototype._openExploreAction.call(host, 'radio');
    assert.equal(calls.some(call => call[0] === 'radio'), false);
    assert.equal(calls.some(call => call[0] === 'panel'), true);
    assert.equal(calls.some(call => call[0] === 'reveal'), false);
  }
});

test('Explore ignores late data presentation after another action or a closed sheet', async () => {
  const { host, calls } = exploreActionHost();
  let finish;
  host._dataManager.setEnabled = () => new Promise(resolve => { finish = resolve; });
  host._dataManager.isEnabled = () => true;
  const first = StyleManager.prototype._openExploreAction.call(host, 'radio');
  await StyleManager.prototype._openExploreAction.call(host, 'contacts');
  finish(true);
  await first;
  assert.deepEqual(calls.map(call => call[0]), ['context']);
  calls.length = 0;
  const second = StyleManager.prototype._openExploreAction.call(host, 'radio');
  host.sheet = null;
  finish(true);
  await second;
  assert.deepEqual(calls, []);
});

test('Explore propagates failed enablement without selecting or presenting results', async () => {
  const { host, calls } = exploreActionHost();
  host._dataManager.setEnabled = async () => false;
  assert.equal(await StyleManager.prototype._openExploreAction.call(host, 'radio'), false);
  host.setContextMode = async () => ({ ok: false });
  assert.equal(await StyleManager.prototype._openExploreAction.call(host, 'contacts'), false);
  assert.deepEqual(calls, []);
});

test('Layers navigation count follows the active filter, hides at zero and updates while closed', () => {
  const { document, mutateLayers, tab, shell } = fixture();
  const count = document.getElementById('mobile-layers-nav-count');
  assert.equal(count.hidden, true);
  const list = document.getElementById('data-toggles');
  const toggle = element('button', document);
  toggle.classList.add('data-toggle-btn', 'active');
  list.append(toggle);
  mutateLayers();
  assert.equal(count.hidden, false);
  assert.equal(count.textContent, '1');
  assert.match(tab('layers').getAttribute('aria-label'), /1/);
  assert.equal(shell.getSheet(), null);
  toggle.classList.remove('active');
  mutateLayers();
  assert.equal(count.hidden, true);
  assert.equal(count.textContent, '0');
  shell.destroy();
});

test('Context sheet close control restores the borrowed desktop state', () => {
  const { document, press, shell, collapsed } = fixture();
  press('context');
  assert.equal(collapsed('global-context-panel'), false);
  document.getElementById('mobile-context-close').click();
  assert.equal(shell.getSheet(), null);
  assert.equal(collapsed('global-context-panel'), true);
  shell.destroy();
  assert.equal(document.getElementById('mobile-context-header'), null);
});

test('Current map view navigates to the displayed snapshot and closes Explore without entering Context', () => {
  const calls = [];
  const view = { latitude: 53.9, longitude: 27.5, height: 1800, heading: 0.5 };
  const { document, shell } = fixture({ readExploreView: () => view, onExploreLocation: point => calls.push(point) });
  shell.openSearch();
  const card = document.getElementById('mobile-search-bar').querySelectorAll('button').find(node => node.className === 'mobile-explore-area');
  view.latitude = 20;
  card.click();
  assert.equal(calls[0].latitude, 53.9);
  assert.equal(calls[0].height, 1800);
  assert.equal(shell.getSheet(), null);
  assert.equal(document.body.hasAttribute('data-mobile-search-open'), false);
  shell.destroy();
});

test('Current map view claims navigation before flying and rejects missing ground', () => {
  const calls = [];
  const host = { viewer: { camera: { flyTo: options => calls.push(options) } }, runImmediateNavigation: (kind, move) => { calls.push(kind); return move(); } };
  assert.equal(StyleManager.prototype._flyToExploreView.call(host, { latitude: null, longitude: 10 }), false);
  assert.equal(calls.length, 0);
  StyleManager.prototype._flyToExploreView.call(host, { latitude: 53.9, longitude: 27.5, height: 1800, heading: 0.5 });
  assert.equal(calls[0], 'location');
  assert.deepEqual(calls[1].orientation, { heading: 0.5, pitch: -Math.PI / 2, roll: 0 });
});

test('Radio is a separate sheet, restores panel state and leaves Context closed', () => {
  const { document, shell, collapsed, tab, resize } = fixture();
  document.dispatchEvent(new Event('gev:radio-selected'));
  assert.equal(shell.getSheet(), 'radio');
  assert.equal(collapsed('global-context-panel'), true);
  assert.equal(collapsed('radio-panel'), false);
  assert.equal(tab('context').getAttribute('aria-expanded'), 'false');
  assert.equal(document.getElementById('mobile-context-handle').querySelector('.mobile-sheet-title').textContent, 'Radio');
  document.getElementById('radio-panel').scrollTop = 80;
  document.getElementById('mobile-context-close').click();
  assert.equal(shell.getSheet(), null);
  assert.equal(collapsed('radio-panel'), true);
  shell.setSheet('radio');
  assert.equal(document.getElementById('radio-panel').scrollTop, 0);
  resize(false);
  assert.equal(shell.getSheet(), null);
  document.dispatchEvent(new Event('gev:radio-selected'));
  assert.equal(shell.getSheet(), null, 'desktop selection does not open the mobile sheet');
  shell.destroy();
});

test('Radio receiver Back restores the main view; X, navigation and desktop reset it', () => {
  const { document, shell, resize, press } = fixture();
  const panel = document.getElementById('radio-panel');
  const entry = document.getElementById('mobile-radio-receiver');
  const back = document.getElementById('mobile-radio-back');
  const title = document.getElementById('mobile-context-handle').querySelector('.mobile-sheet-title');
  shell.setSheet('radio');
  panel.scrollTop = 90;
  entry.click();
  assert.equal(title.textContent, 'RTL-SDR receiver');
  assert.equal(back.hidden, false);
  assert.equal(panel.scrollTop, 0);
  assert.equal(document.activeElement, back);
  document.body.setAttribute('data-mobile-rail-expanded', '');
  back.click();
  assert.equal(title.textContent, 'Radio');
  assert.equal(back.hidden, true);
  assert.equal(panel.scrollTop, 90);
  assert.equal(document.body.hasAttribute('data-mobile-rail-expanded'), false);
  assert.equal(document.activeElement, entry);
  entry.click();
  const escape = new Event('keydown', { cancelable: true });
  escape.key = 'Escape';
  document.dispatchEvent(escape);
  assert.equal(shell.getSheet(), 'radio');
  assert.equal(back.hidden, true);
  entry.click();
  document.getElementById('mobile-context-close').click();
  assert.equal(shell.getSheet(), null);
  shell.setSheet('radio');
  assert.equal(back.hidden, true);
  assert.equal(panel.scrollTop, 0);
  entry.click();
  press('layers');
  assert.equal(document.body.hasAttribute('data-mobile-radio-receiver'), false);
  shell.setSheet('radio');
  entry.click();
  document.dispatchEvent(new Event('gev:radio-selected'));
  assert.equal(back.hidden, true, 'map selection returns to internet radio');
  entry.click();
  resize(false);
  assert.equal(document.body.hasAttribute('data-mobile-radio-receiver'), false);
  shell.destroy();
});

test('a pending receiver transition cannot reopen a closed Radio sheet', async () => {
  const { document, shell } = fixture();
  shell.setSheet('radio');
  document.documentElement = element('html', document);
  let finish;
  document.startViewTransition = update => ({
    finished: new Promise(resolve => { finish = resolve; }),
    skipTransition: () => { update(); finish(); },
  });
  document.getElementById('mobile-radio-receiver').click();
  shell.setSheet(null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shell.getSheet(), null);
  assert.equal(document.body.hasAttribute('data-mobile-radio-receiver'), false);
  assert.equal(document.documentElement.hasAttribute('data-tab-transition'), false);
  shell.destroy();
});

test('Explore reflects radio events while open and releases the subscription', () => {
  let update;
  let unsubscribed = 0;
  const { document, shell } = fixture({ subscribeRadio: listener => {
    update = listener;
    listener({ enabled: false, audioState: 'stopped' });
    return () => { unsubscribed += 1; };
  } });
  const card = document.getElementById('mobile-search-bar').querySelectorAll('button').find(node => node.dataset.exploreAction === 'radio');
  const label = card.children.find(node => node.className === 'mobile-explore-radio-label');
  const [station, status] = label.children[1].children;
  assert.equal(station.hidden, true);
  assert.equal(status.textContent, 'Radio off');
  shell.openSearch();
  const selected = { id: 'radio-one', name: '<Radio & station>' };
  for (const [audioState, expected] of [['loading', 'Connecting…'], ['playing', 'Playing'], ['buffering', 'Buffering…'], ['paused', 'Paused'], ['error', 'Playback error'], ['stopped', 'Ready']]) {
    update({ enabled: true, selected, audioState });
    assert.equal(station.textContent, selected.name);
    assert.equal(station.hidden, false);
    assert.equal(status.textContent, expected);
    assert.equal(document.body.hasAttribute('data-mobile-search-open'), true);
  }
  for (const flags of [{ voiceDucked: true }, { voiceRestoring: true }]) {
    update({ enabled: true, selected, audioState: 'playing', ...flags });
    assert.equal(status.textContent, flags.voiceDucked ? 'Muted for voice' : 'Restoring volume…');
    for (const [audioState, expected] of [['paused', 'Paused'], ['stopped', 'Ready'], ['loading', 'Connecting…'], ['buffering', 'Buffering…'], ['error', 'Playback error']]) {
      update({ enabled: true, selected, audioState, ...flags });
      assert.equal(status.textContent, expected);
    }
    update({ enabled: false, selected, audioState: 'playing', ...flags });
    assert.equal(status.textContent, 'Radio off');
  }
  update({ enabled: true, selected, audioState: 'playing', error: 'Catalog unavailable' });
  assert.equal(status.textContent, 'Playing', 'a catalog refresh failure must not claim that a playing stream failed');
  update({ enabled: true, audioState: 'stopped', loading: true });
  assert.equal(status.textContent, 'Loading stations…');
  assert.equal(station.hidden, true);
  update({ enabled: true, audioState: 'stopped', error: 'Catalog unavailable' });
  assert.equal(status.textContent, 'Stations unavailable');
  update({ enabled: false, selected, audioState: 'error' });
  assert.equal(status.textContent, 'Radio off');
  assert.equal(station.hidden, true);
  shell.destroy();
  assert.equal(unsubscribed, 1);
});

test('returning from Explore preserves the selected paused, stopped or failed station', async () => {
  const { host, calls } = exploreActionHost();
  host.sheet = 'radio';
  for (const audioState of ['paused', 'stopped', 'error']) {
    host.services.radioLayer.getUIState = () => ({ audioState, selected: { id: 'same-station' } });
    calls.length = 0;
    await StyleManager.prototype._openExploreAction.call(host, 'radio');
    assert.equal(calls.some(call => call[0] === 'radio'), false);
    assert.equal(calls.some(call => call[0] === 'panel'), true);
  }
});
