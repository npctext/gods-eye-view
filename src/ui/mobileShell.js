/**
 * Phone shell for narrow viewports (≤720px). The globe stays full screen and a
 * bottom tab bar opens one sheet at a time; search stays at the top. Sheets show
 * existing panels,
 * which stay where they are in the rails and dock while CSS presents them
 * (styles/mobile-shell.css). Desktop never sees the class or the sheet state.
 *
 * Sheets borrow panels: the panels a sheet expands are put back exactly as
 * they were when the sheets close, and nothing a sheet does is persisted or
 * treated as the user's own panel choice.
 *
 * Adapted from the phone tab-shell proposed in public PR #203 by blearymoth.
 */

import { EXCLUSIVE_SURFACE_CLASSES } from '../exclusiveSurfaces.js';
import { msg, t } from '../i18n/index.js';
import { localizePlaceName } from './placeNames.js';
import { initMobileSettings } from './mobileSettings.js';
import { initMobileMapControls } from './mobileMapControls.js';
import { initMobileSheetPeek } from './mobileSheetPeek.js';
import { initMobileLoadingClearance } from './mobileLoadingClearance.js';

export const MOBILE_SHELL_MEDIA_QUERY = '(max-width: 720px)';
export const MOBILE_SHELL_CLASS = 'mobile-shell';
export const MOBILE_SHEET_ATTR = 'data-mobile-sheet';

/**
 * Panels each sheet expands. Other panels in the same rail stay hidden,
 * per styles/mobile-shell.css.
 */
export const MOBILE_SHEET_PANELS = Object.freeze({
  layers: Object.freeze(['data-panel']),
  scenes: Object.freeze(['scene-panel']),
  cameras: Object.freeze(['cctv-panel', 'street-level-panel']),
  context: Object.freeze(['global-context-panel']),
  more: Object.freeze(['control-panel', 'pp-toggles']),
});

export const MOBILE_TABS = Object.freeze([
  Object.freeze({ sheet: 'layers', label: msg('Layers'), icon: 'layers' }),
  Object.freeze({ sheet: 'scenes', label: msg('Scenes'), icon: 'slideshow' }),
  Object.freeze({ sheet: 'cameras', label: msg('Cameras'), icon: 'videocam' }),
  Object.freeze({ sheet: 'context', label: msg('Context'), icon: 'radar' }),
  Object.freeze({ sheet: 'more', label: msg('More'), icon: 'more_horiz' }),
]);

/**
 * Surfaces that own the screen close the open sheet and keep sheets closed.
 * Scene playback is the exception: its STOP control lives in the Scenes panel
 * (Scenes sheet), and a phone has no Escape key to stop it otherwise.
 */
const SHEET_BLOCKING_CLASSES = Object.freeze(
  EXCLUSIVE_SURFACE_CLASSES.filter((name) => name !== 'scene-playback-mode'),
);

/** Every panel any sheet borrows; the dock trays close each other. */
const BORROWED_PANELS = Object.freeze([
  ...new Set(Object.values(MOBILE_SHEET_PANELS).flat()),
]);

const BORROW_OPTIONS = Object.freeze({ persist: false, syncShare: false });

/**
 * @param {string} panelId
 * @returns {string|null} The sheet that presents `panelId`.
 */
export function sheetForPanelId(panelId) {
  for (const [sheet, ids] of Object.entries(MOBILE_SHEET_PANELS)) {
    if (ids.includes(panelId)) return sheet;
  }
  return null;
}

/**
 * The sheet after a tab press: the same tab closes its sheet, another opens.
 * @param {string|null} current
 * @param {string|null} pressed
 * @returns {string|null}
 */
export function nextSheet(current, pressed) {
  if (!pressed || !Object.hasOwn(MOBILE_SHEET_PANELS, pressed)) return null;
  return current === pressed ? null : pressed;
}

function sheetBlocked(body) {
  return SHEET_BLOCKING_CLASSES.some((name) => body.classList.contains(name));
}

function currentSheetOf(body) {
  const value = body.getAttribute(MOBILE_SHEET_ATTR);
  return value && Object.hasOwn(MOBILE_SHEET_PANELS, value) ? value : null;
}

function buildChrome(documentRef) {
  const headerScrim = documentRef.createElement('div');
  headerScrim.id = 'mobile-header-scrim';
  headerScrim.setAttribute('aria-hidden', 'true');
  const footerScrim = documentRef.createElement('div');
  footerScrim.id = 'mobile-footer-scrim';
  footerScrim.setAttribute('aria-hidden', 'true');
  const searchBar = documentRef.createElement('div');
  searchBar.id = 'mobile-search-bar';
  const searchClose = documentRef.createElement('button');
  searchClose.id = 'mobile-search-close';
  searchClose.type = 'button';
  searchClose.className = 'mobile-sheet-control mobile-sheet-back';
  searchClose.setAttribute('aria-label', t('Back'));
  searchBar.append(searchClose);

  const details = documentRef.createElement('section');
  details.id = 'mobile-details';
  details.setAttribute('aria-labelledby', 'mobile-details-title');
  details.setAttribute('aria-hidden', 'true');
  const handle = documentRef.createElement('div');
  handle.className = 'mobile-details-handle';
  handle.setAttribute('aria-hidden', 'true');
  const header = documentRef.createElement('div');
  header.className = 'mobile-details-header';
  const identity = documentRef.createElement('div');
  identity.className = 'mobile-details-identity';
  const eyebrow = documentRef.createElement('span');
  eyebrow.className = 'mobile-details-eyebrow';
  eyebrow.textContent = t('CURRENT LOCATION');
  const title = documentRef.createElement('h2');
  title.id = 'mobile-details-title';
  identity.append(eyebrow, title);
  const close = documentRef.createElement('button');
  close.id = 'mobile-details-close';
  close.type = 'button';
  close.className = 'mobile-details-close mobile-sheet-control mobile-sheet-close';
  close.setAttribute('aria-label', t('Close'));
  const closeIcon = documentRef.createElement('span');
  closeIcon.className = 'mobile-sheet-close-icon';
  closeIcon.setAttribute('aria-hidden', 'true');
  close.append(closeIcon);
  header.append(identity, close);
  const divider = documentRef.createElement('div');
  divider.className = 'mobile-details-divider';
  const content = documentRef.createElement('div');
  content.id = 'mobile-details-content';
  const sectionLabel = documentRef.createElement('span');
  sectionLabel.className = 'mobile-details-section-label';
  sectionLabel.textContent = t('NAVIGATE TO');
  details.append(handle, header, divider, content);

  const tabBar = documentRef.createElement('nav');
  tabBar.id = 'mobile-tab-bar';
  tabBar.setAttribute('aria-label', t('Panels'));
  for (const tab of MOBILE_TABS) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'mobile-tab';
    button.dataset.mobileSheet = tab.sheet;
    button.setAttribute('aria-expanded', 'false');
    const icon = documentRef.createElement('span');
    icon.className = 'material-symbols-outlined mobile-tab-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tab.icon;
    const label = documentRef.createElement('span');
    label.className = 'mobile-tab-label';
    label.textContent = t(tab.label);
    button.append(icon, label);
    tabBar.append(button);
  }
  documentRef.body.append(headerScrim, footerScrim, searchBar, tabBar, details);
  return { headerScrim, footerScrim, searchBar, searchClose, tabBar, details, handle, title, close, content, sectionLabel };
}

/**
 * Wires the phone shell: the media gate, tab bar, Escape, focus,
 * and closing for full-screen modes.
 * @param {object} input
 * @param {(panelId: string, collapsed: boolean, options?: object) => void} input.setPanelCollapsed
 * @param {Document} [input.documentRef]
 * @param {(query: string) => MediaQueryList} [input.matchMedia]
 * @param {typeof MutationObserver} [input.MutationObserverImpl]
 * @param {typeof ResizeObserver} [input.ResizeObserverImpl]
 * @param {(callback: () => void) => number} [input.requestFrame]
 * @param {() => void} [input.onSheetsClosed] Runs after the last sheet closes
 *   and its panels are put back (e.g. to refresh the share link).
 * @param {(sheet: string) => void} [input.onTabOpened] Runs only when the user
 *   opens a sheet from its tab, never on close or programmatic presentation.
 * @returns {{ destroy: () => void, setSheet: (sheet: string|null) => void, getSheet: () => string|null, showCity: (name: string) => void, showDestination: (label: string) => void, sharedCollapsed: (panelId: string) => boolean|undefined }}
 */
export function initMobileShell({
  setPanelCollapsed,
  documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  MutationObserverImpl = globalThis.MutationObserver,
  ResizeObserverImpl = globalThis.ResizeObserver,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  onSheetsClosed = () => {},
  onTabOpened = () => {},
  onMapZoom,
  onMapLocation,
  onLanguageSelect,
} = {}) {
  const body = documentRef.body;
  const { headerScrim, footerScrim, searchBar, searchClose, tabBar, details, handle, title, close, content, sectionLabel } = buildChrome(documentRef);
  const viewport = documentRef.querySelector('meta[name="viewport"]');
  const viewportContent = viewport?.getAttribute('content') ?? null;
  const removers = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  };
  const element = (id) => documentRef.getElementById(id);
  const layersHandle = element('mobile-layers-handle');
  const layersClose = element('mobile-layers-close');
  const layersRoot = element('left-panel-stack');
  const scenePanel = element('scene-panel');
  const layersList = element('data-toggles');
  const layersActiveCount = element('mobile-layers-active-count');
  const layersCount = element('mobile-layers-count');
  const layersFilter = element('mobile-layers-filter');
  const clearLayers = element('clear-selected-layers');
  const clearLayersHome = clearLayers?.parentElement;
  const clearLayersNext = clearLayers?.nextSibling;
  const layersFilterButtons = [element('mobile-layers-all'), element('mobile-layers-active')].filter(Boolean);
  const statusStack = element('mobile-status-stack');
  const searchInput = element('location-search');
  const searchIcon = documentRef.createElement('img');
  searchIcon.className = 'mobile-search-icon';
  searchIcon.src = '/search-figma.svg';
  searchIcon.alt = '';
  const micSlot = documentRef.createElement('span');
  micSlot.className = 'mobile-search-mic';
  micSlot.setAttribute('aria-hidden', 'true');
  const micIcon = documentRef.createElement('img');
  micIcon.className = 'mobile-search-mic-icon';
  micIcon.src = '/mic-figma.svg';
  micIcon.alt = '';
  micSlot.append(micIcon);
  const searchClear = documentRef.createElement('button');
  searchClear.id = 'mobile-search-clear';
  searchClear.type = 'button';
  searchClear.setAttribute('aria-label', t('Clear search'));
  const clearIcon = documentRef.createElement('img');
  clearIcon.className = 'mobile-search-clear-icon';
  clearIcon.src = '/ico-close.svg';
  clearIcon.alt = '';
  searchClear.append(clearIcon);
  searchBar.append(searchClear);
  const locationPopover = element('location-bar-popover');
  const locationHome = locationPopover?.parentElement;
  const poiRow = element('poi-row');
  const poiHome = poiRow?.parentElement;
  const poiNext = poiRow?.nextSibling;
  const cities = element('location-pills');
  const scrollWindow = documentRef.defaultView;
  if (scrollWindow?.ResizeObserver && scrollWindow?.MutationObserver) {
    for (const [row, host] of [[cities, cities?.parentElement], [poiRow, content]]) {
      if (!row || !host) continue;
      host.classList.add('mobile-scroll-edges');
      const updateEdges = () => {
        const visible = body.classList.contains(MOBILE_SHELL_CLASS) && row.parentElement === host && row.clientWidth > 0;
        const max = row.scrollWidth - row.clientWidth;
        host.toggleAttribute('data-scroll-left', visible && row.scrollLeft > 1);
        host.toggleAttribute('data-scroll-right', visible && row.scrollLeft < max - 1);
        if (!visible) return;
        host.style.setProperty('--scroll-edge-top', (row.getBoundingClientRect().top - host.getBoundingClientRect().top) + 'px');
        host.style.setProperty('--scroll-edge-height', row.offsetHeight + 'px');
      };
      listen(row, 'scroll', updateEdges, { passive: true });
      const edgeResize = new scrollWindow.ResizeObserver(updateEdges);
      edgeResize.observe(row);
      edgeResize.observe(host);
      const edgeContents = new scrollWindow.MutationObserver(updateEdges);
      edgeContents.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      removers.push(() => {
        edgeResize.disconnect();
        edgeContents.disconnect();
        host.classList.remove('mobile-scroll-edges');
        host.removeAttribute('data-scroll-left');
        host.removeAttribute('data-scroll-right');
        host.style.removeProperty('--scroll-edge-top');
        host.style.removeProperty('--scroll-edge-height');
      });
    }
  }
  const placeSearch = (mobile) => {
    const parent = mobile ? searchBar : locationHome;
    if (locationPopover && parent && locationPopover.parentElement !== parent)
      parent.append(locationPopover);
    const iconParent = mobile ? searchInput?.parentElement : searchBar;
    if (iconParent && searchClose.parentElement !== iconParent)
      iconParent.append(searchClose);
    if (iconParent && searchClear.parentElement !== iconParent)
      iconParent.append(searchClear);
    if (mobile && iconParent) {
      iconParent.insertBefore(searchIcon, searchInput);
      iconParent.append(micSlot);
    } else {
      searchIcon.remove();
      micSlot.remove();
    }
  };
  const placePois = (mobile) => {
    if (!poiRow || !poiHome) return;
    if (mobile && poiRow.parentElement !== content) content.append(poiRow);
    else if (!mobile && poiRow.parentElement !== poiHome)
      poiHome.insertBefore(poiRow, poiNext);
  };
  const placeClearLayers = (mobile) => {
    if (!clearLayers || !clearLayersHome || !layersFilter) return;
    if (mobile && clearLayers.parentElement !== layersFilter) layersFilter.append(clearLayers);
    else if (!mobile && clearLayers.parentElement !== clearLayersHome)
      clearLayersHome.insertBefore(clearLayers, clearLayersNext);
  };
  const rails = ['left-panel-stack', 'right-context-rail']
    .map(element)
    .filter(Boolean);
  const dock = element('command-dock');
  const shown = (node) =>
    node && globalThis.getComputedStyle?.(node).display !== 'none';

  /**
   * Panel states from before the first sheet opened (`before`) and right after
   * the open sheet was set up (`applied`); null when closed.
   */
  let borrowed = null;
  let returnFocus = null;
  let swipe = null;
  let detailsTouch = null;
  let layersTouch = null;
  let layersCloseTimer = null;
  let sceneTouch = null;
  let sceneCloseTimer = null;
  const written = new Map();

  const writeVar = (name, value) => {
    if (written.get(name) === value) return;
    written.set(name, value);
    body.style.setProperty(name, value);
  };
  const updateLayersActiveCount = () => {
    if (layersCount)
      layersCount.textContent = String(layersList?.querySelectorAll('.data-toggle-btn').length ?? 0);
    if (layersActiveCount)
      layersActiveCount.textContent = String(layersList?.querySelectorAll('.data-toggle-btn.active').length ?? 0);
  };
  updateLayersActiveCount();

  const setLayersExpanded = (expanded) => {
    if (currentSheetOf(body) !== 'layers') return;
    if (expanded) body.setAttribute('data-mobile-layers-expanded', '');
    else body.removeAttribute('data-mobile-layers-expanded');
    layersHandle?.setAttribute('aria-expanded', String(expanded));
    layersHandle?.setAttribute('aria-label', t(expanded ? 'Collapse layers' : 'Expand layers'));
    measureSheet();
  };

  const settleLayersDrag = (expanded) => {
    body.removeAttribute('data-mobile-layers-dragging');
    layersRoot?.classList.remove('dragging');
    layersRoot?.getBoundingClientRect();
    setLayersExpanded(expanded);
    for (const property of ['height', 'bottom', 'transform'])
      layersRoot?.style.removeProperty(property);
    measureSheet();
  };

  const closeDetails = () => {
    const wasOpen = body.getAttribute('data-mobile-details') !== null;
    detailsTouch = null;
    details.classList.remove('dragging');
    details.style.removeProperty('transform');
    body.removeAttribute('data-mobile-details');
    details.setAttribute('aria-hidden', 'true');
    if (wasOpen && searchInput) {
      searchInput.value = '';
      const InputEvent = documentRef.defaultView?.Event ?? Event;
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    measureSheet();
  };

  const updateSearchClear = () => {
    if (searchInput?.value) body.setAttribute('data-mobile-search-typing', '');
    else body.removeAttribute('data-mobile-search-typing');
  };

  const setSearchOpen = (open) => {
    updateSearchClear();
    if (!open) {
      body.removeAttribute('data-mobile-search-open');
      searchBar.inert = true;
      searchInput?.blur?.();
      return;
    }
    if (!body.classList.contains(MOBILE_SHELL_CLASS) || sheetBlocked(body)) return;
    if (body.getAttribute('data-mobile-search-open') !== null) return;
    closeDetails();
    setSheet(null);
    body.setAttribute('data-mobile-search-open', '');
    searchBar.inert = false;
    if (documentRef.activeElement !== searchInput) searchInput?.focus?.();
    if (searchInput?.value) searchInput.select?.();
  };

  const showDetails = (label, node) => {
    if (!body.classList.contains(MOBILE_SHELL_CLASS) || sheetBlocked(body)) return;
    setSearchOpen(false);
    setSheet(null);
    title.textContent = label;
    content.replaceChildren(...(node ? [sectionLabel, node] : []));
    body.setAttribute('data-mobile-details', '');
    details.setAttribute('aria-hidden', 'false');
    measureSheet();
  };

  // The presets dock sits on top of whichever rail is the sheet,
  // and the required map attribution sits above everything the sheet covers.
  const measureSheet = () => {
    if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
    const height = Math.max(
      0,
      ...rails.map((rail) =>
        shown(rail) ? rail.getBoundingClientRect().height : 0,
      ),
    );
    writeVar('--mobile-sheet-height', `${Math.round(height)}px`);
    const viewportHeight = globalThis.innerHeight || 0;
    const cover = Math.max(
      0,
      ...[...rails, element('mobile-settings'), currentSheetOf(body) ? dock : null]
        .filter(shown)
        .map((node) => viewportHeight - node.getBoundingClientRect().top),
    );
    writeVar('--mobile-sheet-cover', `${Math.round(cover)}px`);
    writeVar(
      '--mobile-details-height',
      body.getAttribute('data-mobile-details') !== null
        ? `${Math.round(details.getBoundingClientRect().height)}px`
        : '0px',
    );
  };

  const measureStatus = () => {
    if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
    const height = statusStack?.getBoundingClientRect().height || 0;
    writeVar('--mobile-status-offset', String(Math.round(height ? height + 12 : 0)) + 'px');
  };
  const resize =
    typeof ResizeObserverImpl === 'function'
      ? new ResizeObserverImpl(() => {
          measureSheet();
          measureStatus();
        })
      : null;
  removers.push(() => resize?.disconnect());

  const isCollapsed = (panelId) =>
    element(panelId)?.classList.contains('collapsed') ?? true;
  // The user's preference, as share links record it: a collapse that layout
  // applies only for space (Tactical, Cyber) still counts as expanded.
  const prefersCollapsed = (panelId) => {
    const classes = element(panelId)?.classList;
    if (!classes) return true;
    return (
      classes.contains('collapsed') &&
      !classes.contains('layout-auto-collapsed') &&
      !classes.contains('cyber-accordion-collapsed')
    );
  };

  const panelStates = () =>
    new Map(
      BORROWED_PANELS.map((panelId) => [panelId, prefersCollapsed(panelId)]),
    );

  // Undo only what opening the sheet did (including side effects, such as dock
  // trays closing each other). A panel the user changed since stays as they
  // left it, and becomes the state later sheets put back.
  const restoreBorrowed = () => {
    if (!borrowed) return;
    for (const [panelId, before] of borrowed.before) {
      const now = prefersCollapsed(panelId);
      if (now !== borrowed.applied.get(panelId))
        borrowed.before.set(panelId, now);
      else if (now !== before)
        setPanelCollapsed(panelId, before, BORROW_OPTIONS);
    }
  };

  const present = (sheet) => {
    sheetPeek?.clear();
    if (sheet) body.setAttribute(MOBILE_SHEET_ATTR, sheet);
    else body.removeAttribute(MOBILE_SHEET_ATTR);
    settingsPanel?.sync(sheet === 'more');
    if (sheet !== 'layers') {
      clearTimeout(layersCloseTimer);
      layersCloseTimer = null;
      body.removeAttribute('data-mobile-layers-expanded');
      body.removeAttribute('data-mobile-layers-dragging');
      layersHandle?.setAttribute('aria-expanded', 'false');
      layersTouch = null;
      layersRoot?.classList.remove('dragging');
      for (const property of ['height', 'bottom', 'transform'])
        layersRoot?.style.removeProperty(property);
    }
    if (sheet !== 'scenes') {
      body.removeAttribute('data-mobile-scenes-lowered');
      clearTimeout(sceneCloseTimer);
      sceneCloseTimer = null;
      sceneTouch = null;
      body.removeAttribute('data-mobile-scenes-expanded');
      body.removeAttribute('data-mobile-scenes-dragging');
      layersRoot?.style.removeProperty('height');
      layersRoot?.style.removeProperty('transform');
    }
    for (const button of tabBar.querySelectorAll('[data-mobile-sheet]'))
      button.setAttribute(
        'aria-expanded',
        String(button.dataset.mobileSheet === sheet),
      );
    measureSheet();
  };

  /** The first visible control of the sheet's first panel, for focus on open. */
  const sheetFocusTarget = (sheet) => {
    const panel = element(sheet === 'more' ? 'mobile-settings' : MOBILE_SHEET_PANELS[sheet][0]);
    const controls =
      panel?.querySelectorAll?.(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [];
    // Sheets hide some panel chrome (tray toggles, pins) that stays in the
    // DOM, and a panel's own collapse control is a poor first stop.
    return (
      [...controls].find(
        (control) =>
          control.getClientRects().length > 0 &&
          !control.matches?.('.panel-collapse-btn'),
      ) ?? null
    );
  };

  let tabTransitionGeneration = 0;
  let tabTransition = null;
  const cancelTabTransition = () => {
    tabTransitionGeneration += 1;
    tabTransition?.skipTransition();
    tabTransition = null;
    documentRef.documentElement?.removeAttribute('data-tab-transition');
  };

  const setSheet = (requested, keepTransition = false) => {
    if (!keepTransition) cancelTabTransition();
    swipe = null;
    if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
    if (requested) {
      setSearchOpen(false);
      closeDetails();
    }
    const sheet = sheetBlocked(body) ? null : requested;
    const previous = currentSheetOf(body);
    if (previous === sheet) return;
    if (!previous) {
      borrowed = { before: panelStates(), applied: panelStates() };
      returnFocus = documentRef.activeElement ?? null;
    } else {
      restoreBorrowed();
    }
    present(sheet);
    if (previous === 'scenes' && sheet !== 'scenes')
      scenePanel?.dispatchEvent(new Event('mobile-scenes-closed'));
    if (!sheet) {
      borrowed = null;
      onSheetsClosed();
      const focus = returnFocus;
      returnFocus = null;
      if (focus && focus !== body && body.contains?.(focus)) focus.focus?.();
      return;
    }
    for (const panelId of MOBILE_SHEET_PANELS[sheet])
      if (isCollapsed(panelId))
        setPanelCollapsed(panelId, false, BORROW_OPTIONS);
    borrowed.applied = panelStates();
    // Rail layout settles on a later frame; what it does is part of opening.
    const opening = (borrowed.opening ?? 0) + 1;
    borrowed.opening = opening;
    const opened = borrowed;
    requestFrame?.(() => {
      if (borrowed === opened && opened.opening === opening)
        opened.applied = panelStates();
    });
    measureSheet();
    sheetFocusTarget(sheet)?.focus?.();
    if (sheet === 'layers') {
      const toggles = element('data-toggles');
      if (toggles) toggles.scrollTop = 0;
    }
  };

  const tabFor = (sheet) =>
    [...tabBar.querySelectorAll('[data-mobile-sheet]')].find(
      (button) => button.dataset.mobileSheet === sheet,
    );

  const sheetAnimationDuration = () => {
    const value = globalThis.getComputedStyle?.(documentRef.documentElement)
      .getPropertyValue('--mobile-sheet-animation-duration').trim() || '280ms';
    return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  };

  const closeLayers = () => {
    if (layersCloseTimer) return;
    body.removeAttribute('data-mobile-layers-dragging');
    layersRoot?.classList.remove('dragging');
    layersRoot?.getBoundingClientRect();
    layersRoot?.style.setProperty('transform', 'translateY(110%)');
    returnFocus = tabFor('layers') ?? returnFocus;
    layersCloseTimer = setTimeout(() => {
      layersCloseTimer = null;
      const toggles = element('data-toggles');
      if (toggles) toggles.scrollTop = 0;
      setSheet(null);
    }, sheetAnimationDuration());
  };

  const closeScenes = () => {
    if (sceneCloseTimer || currentSheetOf(body) !== 'scenes') return;
    layersRoot?.style.setProperty('transform', 'translateY(110%)');
    returnFocus = tabFor('scenes') ?? returnFocus;
    sceneCloseTimer = setTimeout(() => {
      sceneCloseTimer = null;
      setSheet(null);
    }, sheetAnimationDuration());
  };

  const onMedia = (matches) => {
    if (!matches) {
      setSearchOpen(false);
      closeDetails();
    }
    placeSearch(matches);
    placePois(matches);
    placeClearLayers(matches);
    if (matches) {
      body.classList.add(MOBILE_SHELL_CLASS);
      // Lets the page draw under the notch and system bars; the shell's CSS
      // keeps its chrome clear of them.
      if (viewport && !/viewport-fit\s*=/.test(viewportContent || ''))
        viewport.setAttribute(
          'content',
          `${viewportContent || ''}, viewport-fit=cover`,
        );
      for (const node of [...rails, dock, details, statusStack, element('mobile-settings')].filter(Boolean))
        resize?.observe(node);
      measureSheet();
      measureStatus();
    } else {
      // Crossing to desktop closes the sheet, which puts its panels back.
      setSheet(null);
      body.classList.remove(MOBILE_SHELL_CLASS);
      present(null);
      resize?.disconnect();
      if (viewport && viewportContent !== null)
        viewport.setAttribute('content', viewportContent);
    }
    tabBar.setAttribute('aria-hidden', String(!matches));
    mapControls?.setMobile(matches);
  };

  const settingsPanel = initMobileSettings({
    documentRef, onClose: () => setSheet(null), onCollapse: () => sheetPeek?.collapse(), onLanguageSelect,
  });
  resize?.observe(element('mobile-settings') || details);
  const sheetPeek = initMobileSheetPeek({
    documentRef, tabs: MOBILE_TABS, onChange: measureSheet,
    onClose: () => {
      const sheet = currentSheetOf(body);
      if (sheet === 'layers' && layersList) layersList.scrollTop = 0;
      returnFocus = tabFor(sheet) ?? returnFocus;
      setSheet(null);
    },
  });
  const loadingClearance = initMobileLoadingClearance(documentRef);
  const mapControls = initMobileMapControls({
    documentRef,
    openSearch: () => setSearchOpen(true),
    openSettings: () => {
      if (currentSheetOf(body) === 'more') { settingsPanel?.dismiss(); return; }
      setSheet('more'); onTabOpened('more');
    },
    onMapTool: (tool) => {
      if (tool === 'clean') { setSheet(null); element('clean-view-toggle')?.click(); return; }
      setSheet('more');
      onTabOpened('more');
      settingsPanel?.show(tool, true);
      if (tool === 'draw' && element('draw-toggle')?.getAttribute('aria-pressed') !== 'true') element('draw-toggle')?.click();
      if (tool === 'import') element('geo-import-button')?.click();
    },
    zoom: onMapZoom,
    locate: onMapLocation,
    onMapInteraction: () => sheetPeek?.collapse(),
  });

  const media =
    typeof matchMedia === 'function'
      ? matchMedia(MOBILE_SHELL_MEDIA_QUERY)
      : null;
  onMedia(Boolean(media?.matches));
  const onChange = (event) => onMedia(event.matches);
  if (media?.addEventListener) {
    media.addEventListener('change', onChange);
    removers.push(() => media.removeEventListener('change', onChange));
  } else if (media?.addListener) {
    // Safari before 14 only offers the legacy listener API.
    media.addListener(onChange);
    removers.push(() => media.removeListener(onChange));
  }

  const transitionSheet = (sheet, button) => {
    cancelTabTransition();
    const generation = tabTransitionGeneration;
    const update = () => {
      if (generation !== tabTransitionGeneration) return;
      // Closing from the tab bar returns focus to the tab that was pressed.
      if (!sheet) returnFocus = button;
      setSheet(sheet, true);
      if (sheet && currentSheetOf(body) === sheet) onTabOpened(sheet);
    };
    if (!documentRef.startViewTransition ||
        matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      update();
      return;
    }
    documentRef.documentElement.setAttribute('data-tab-transition', '');
    const transition = documentRef.startViewTransition(update);
    tabTransition = transition;
    transition.finished.catch(() => {}).finally(() => {
      if (tabTransition !== transition) return;
      documentRef.documentElement.removeAttribute('data-tab-transition');
      tabTransition = null;
    });
  };
  listen(tabBar, 'click', (event) => {
    const button = event.target?.closest?.('[data-mobile-sheet]');
    if (!button) return;
    event.preventDefault();
    transitionSheet(nextSheet(currentSheetOf(body), button.dataset.mobileSheet), button);
  });
  if (scenePanel) {
    if (layersRoot) listen(layersRoot, 'transitionend', measureSheet);
    listen(scenePanel, 'mobile-scene-close', closeScenes);
    listen(scenePanel, 'mobile-scene-shot-selected', () => {
      if (currentSheetOf(body) !== 'scenes' || sceneCloseTimer) return;
      layersRoot?.style.setProperty('--mobile-scenes-hidden-height', `${(layersRoot?.getBoundingClientRect().height || 0) / 2}px`);
      body.setAttribute('data-mobile-scenes-lowered', '');
      requestFrame?.(() => {
        if (currentSheetOf(body) !== 'scenes' || !body.hasAttribute('data-mobile-scenes-lowered')) return;
        const selected = scenePanel.querySelector('.mobile-scene-shot[aria-current="true"]');
        const content = selected?.closest('.mobile-scene-content');
        if (!content) return;
        content.scrollTo({
          top: content.scrollTop + selected.getBoundingClientRect().top - content.getBoundingClientRect().top - 12,
          behavior: matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      });
      measureSheet();
    });
    listen(scenePanel, 'mobile-scene-expand', () => {
      if (currentSheetOf(body) !== 'scenes') return;
      if (body.hasAttribute('data-mobile-scenes-lowered'))
        body.removeAttribute('data-mobile-scenes-lowered');
      else
        body.toggleAttribute('data-mobile-scenes-expanded');
      measureSheet();
    });
    listen(scenePanel, 'touchstart', (event) => {
      sceneTouch = null;
      if (currentSheetOf(body) !== 'scenes' || event.touches.length !== 1 ||
          event.target?.closest?.('input, select, textarea, [contenteditable="true"], [role="slider"]')) return;
      sceneTouch = {
        id: event.touches[0].identifier,
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        target: event.target,
        handle: !!event.target?.closest?.('[data-mobile-scene-handle]'),
        claimed: false,
        height: layersRoot?.getBoundingClientRect().height || 0,
        expanded: body.hasAttribute('data-mobile-scenes-expanded'),
        lowered: body.hasAttribute('data-mobile-scenes-lowered'),
      };
    }, { passive: true });
    listen(scenePanel, 'touchmove', (event) => {
      if (!sceneTouch || event.touches.length !== 1 ||
          event.touches[0].identifier !== sceneTouch.id || !layersRoot) return;
      const distance = event.touches[0].clientY - sceneTouch.y;
      if (Math.abs(distance) < 4) return;
      if (!sceneTouch.claimed) {
        const dx = event.touches[0].clientX - sceneTouch.x;
        if (Math.abs(distance) <= Math.abs(dx) * 1.25 || !event.cancelable) {
          sceneTouch = null;
          return;
        }
        if (!sceneTouch.handle) {
          const scrollers = [
            sceneTouch.target?.closest?.('.mobile-scene-content'),
            sceneTouch.target?.closest?.('.scene-panel-inner'),
          ];
          const canScroll = scrollers.some((content) => content && (
            distance > 0 ? content.scrollTop > 0 :
              content.scrollTop + content.clientHeight < content.scrollHeight - 1
          ));
          if (canScroll) {
            sceneTouch = null;
            return;
          }
        }
        sceneTouch.claimed = true;
      }
      event.preventDefault();
      body.setAttribute('data-mobile-scenes-dragging', '');
      const viewportHeight = documentRef.defaultView?.innerHeight || globalThis.innerHeight || 0;
      const compact = viewportHeight * 0.45;
      const expanded = parseFloat(globalThis.getComputedStyle(layersRoot).maxHeight);
      if (sceneTouch.lowered)
        layersRoot.style.setProperty('transform', `translateY(${Math.max(0, sceneTouch.height / 2 + distance)}px)`);
      else if (!sceneTouch.expanded && distance > 0)
        layersRoot.style.setProperty('transform', `translateY(${distance}px)`);
      else
        layersRoot.style.setProperty('height', `${Math.max(compact, Math.min(expanded, sceneTouch.height - distance))}px`);
      measureSheet();
    }, { passive: false });
    listen(scenePanel, 'touchend', (event) => {
      if (!sceneTouch || event.touches.length) return;
      if (!sceneTouch.claimed) {
        sceneTouch = null;
        return;
      }
      const touch = [...event.changedTouches].find((item) => item.identifier === sceneTouch.id);
      const distance = touch ? touch.clientY - sceneTouch.y : 0;
      const wasExpanded = sceneTouch.expanded;
      const wasLowered = sceneTouch.lowered;
      sceneTouch = null;
      body.removeAttribute('data-mobile-scenes-dragging');
      layersRoot?.style.removeProperty('height');
      layersRoot?.style.removeProperty('transform');
      if (wasLowered) {
        if (distance < -48) body.removeAttribute('data-mobile-scenes-lowered');
        else if (distance > 80) closeScenes();
      }
      else if (!wasExpanded && distance > 80) closeScenes();
      else if (distance < -48) body.setAttribute('data-mobile-scenes-expanded', '');
      else if (distance > 48) body.removeAttribute('data-mobile-scenes-expanded');
      measureSheet();
    }, { passive: true });
    listen(scenePanel, 'touchcancel', () => {
      sceneTouch = null;
      body.removeAttribute('data-mobile-scenes-dragging');
      layersRoot?.style.removeProperty('height');
      layersRoot?.style.removeProperty('transform');
    }, { passive: true });
  }
  for (const button of layersFilterButtons) listen(button, 'click', () => {
    const active = button.id === 'mobile-layers-active';
    if (active) body.setAttribute('data-mobile-layer-filter', 'active');
    else body.removeAttribute('data-mobile-layer-filter');
    for (const option of layersFilterButtons)
      option.setAttribute('aria-pressed', String(option === button));
    if (layersList) layersList.scrollTop = 0;
  });
  const listenPanelTouch = (panel, grip, type, handler, options) => {
    listen(grip, type, handler, options);
    if (panel) listen(panel, type, (event) => {
      if (!grip.contains(event.target)) handler(event);
    }, options);
  };
  if (layersHandle) {
    listen(layersHandle, 'click', () =>
      setLayersExpanded(body.getAttribute('data-mobile-layers-expanded') === null),
    );
    listenPanelTouch(layersRoot, layersHandle, 'touchstart', (event) => {
      layersTouch = null;
      if (currentSheetOf(body) !== 'layers' || event.touches.length !== 1 ||
          event.target?.closest?.('input, select, textarea, [contenteditable="true"], [role="slider"]')) return;
      const viewportHeight = documentRef.defaultView?.innerHeight || globalThis.innerHeight || 0;
      const tabHeight = tabBar.getBoundingClientRect().height;
      const compactTop = Math.max(0, viewportHeight * 0.55 - tabHeight);
      const rect = layersRoot?.getBoundingClientRect();
      const expanded = body.getAttribute('data-mobile-layers-expanded') !== null;
      layersTouch = {
        id: event.touches[0].identifier,
        x: event.touches[0].clientX,
        target: event.target,
        y: event.touches[0].clientY,
        viewportHeight,
        tabHeight,
        compactTop,
        startTop: rect?.height ? rect.top : expanded ? 0 : compactTop,
        expanded,
        moved: false,
      };
    }, { passive: true });
    listenPanelTouch(layersRoot, layersHandle, 'touchmove', (event) => {
      if (!layersTouch || event.touches.length !== 1 ||
          event.touches[0].identifier !== layersTouch.id) return;
      const distance = event.touches[0].clientY - layersTouch.y;
      if (Math.abs(distance) <= 4 || !layersTouch.viewportHeight || !layersRoot) return;
      if (!layersTouch.moved) {
        const dx = event.touches[0].clientX - layersTouch.x;
        const inList = layersList?.contains(layersTouch.target);
        const canScroll = layersList && layersList.scrollTop + layersList.clientHeight < layersList.scrollHeight - 1;
        if (Math.abs(distance) <= Math.abs(dx) * 1.25 || !event.cancelable ||
            (inList && distance > 0 && layersList.scrollTop > 0) ||
            (inList && distance < 0 && canScroll)) {
          layersTouch = null;
          return;
        }
      }
      event.preventDefault();
      layersTouch.moved = true;
      body.setAttribute('data-mobile-layers-dragging', '');
      layersRoot.classList.add('dragging');
      if (!layersTouch.expanded && distance > 0) {
        layersRoot.style.setProperty('transform', 'translateY(' + Math.min(distance, layersTouch.viewportHeight) + 'px)');
      } else {
        const expandedTop = layersTouch.viewportHeight - layersTouch.tabHeight - parseFloat(globalThis.getComputedStyle(layersRoot).maxHeight);
        const top = Math.max(expandedTop, Math.min(layersTouch.compactTop, layersTouch.startTop + distance));
        const bottom = layersTouch.tabHeight;
        layersRoot.style.setProperty('height', String(layersTouch.viewportHeight - top - bottom) + 'px');
        layersRoot.style.setProperty('bottom', String(bottom) + 'px');
      }
      measureSheet();
    }, { passive: false });
    listenPanelTouch(layersRoot, layersHandle, 'touchend', (event) => {
      if (!layersTouch || event.touches.length) return;
      const touch = [...event.changedTouches].find(
        (item) => item.identifier === layersTouch.id,
      );
      const distance = touch ? touch.clientY - layersTouch.y : 0;
      const { expanded, moved } = layersTouch;
      layersTouch = null;
      if (!moved) {
        if (distance < -48) setLayersExpanded(true);
        else if (distance > 48) {
          if (expanded) setLayersExpanded(false);
          else {
            returnFocus = tabFor('layers') ?? returnFocus;
            setSheet(null);
          }
        }
        return;
      }
      if (!expanded && distance > 64) {
        closeLayers();
        return;
      }
      settleLayersDrag(expanded ? distance <= 48 : distance < -48);
    }, { passive: true });
    listenPanelTouch(layersRoot, layersHandle, 'touchcancel', () => {
      const expanded = layersTouch?.expanded;
      layersTouch = null;
      if (expanded !== undefined) settleLayersDrag(expanded);
    }, { passive: true });
  }
  if (layersClose) listen(layersClose, 'click', closeLayers);
  if (searchInput) {
    listen(searchInput, 'focus', () => setSearchOpen(true));
    listen(searchInput, 'click', () => setSearchOpen(true));
    listen(searchInput, 'input', updateSearchClear);
    listen(searchClear, 'mousedown', (event) => event.preventDefault());
    listen(searchClear, 'click', () => {
      searchInput.value = '';
      const InputEvent = documentRef.defaultView?.Event ?? Event;
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      searchInput.focus();
    });
  }
  listen(searchClose, 'click', () => setSearchOpen(false));
  listen(close, 'click', closeDetails);
  listenPanelTouch(details, handle, 'touchstart', (event) => {
    detailsTouch = null;
    if (event.touches.length !== 1 ||
        event.target?.closest?.('input, select, textarea, [contenteditable="true"], [role="slider"]')) return;
    detailsTouch = {
      id: event.touches[0].identifier,
      x: event.touches[0].clientX,
      target: event.target,
      claimed: false,
      y: event.touches[0].clientY,
      distance: 0,
    };
  }, { passive: true });
  listenPanelTouch(details, handle, 'touchmove', (event) => {
    if (!detailsTouch || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (touch.identifier !== detailsTouch.id) return;
    const dy = touch.clientY - detailsTouch.y;
    if (!detailsTouch.claimed) {
      const dx = touch.clientX - detailsTouch.x;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      let hasScroll = false;
      for (let node = detailsTouch.target; node && node !== details; node = node.parentElement)
        if (node.scrollTop > 0) hasScroll = true;
      if (dy <= Math.abs(dx) * 1.25 || !event.cancelable || hasScroll) {
        detailsTouch = null;
        return;
      }
      detailsTouch.claimed = true;
    }
    detailsTouch.distance = Math.max(0, dy);
    event.preventDefault();
    details.classList.add('dragging');
    details.style.setProperty('transform', `translateY(${detailsTouch.distance}px)`);
  }, { passive: false });
  listenPanelTouch(details, handle, 'touchend', (event) => {
    if (!detailsTouch || event.touches.length) return;
    const distance = detailsTouch.distance;
    detailsTouch = null;
    details.classList.remove('dragging');
    details.style.removeProperty('transform');
    if (distance > 64) closeDetails();
  }, { passive: true });
  listenPanelTouch(details, handle, 'touchcancel', () => {
    detailsTouch = null;
    details.classList.remove('dragging');
    details.style.removeProperty('transform');
  }, { passive: true });
  // Touch events let native scrolling continue until a downward pull at the
  // top is intentional. Pointer capture/touch-action:none would also seize
  // ordinary vertical scrolling inside the borrowed panels.
  const sheetRoot = (target, sheet) => {
    const roots =
      sheet === 'layers' || sheet === 'scenes'
        ? [element('left-panel-stack')]
        : sheet === 'more'
          ? [element('right-context-rail'), dock]
          : [element('right-context-rail')];
    return roots.find((root) => root?.contains(target));
  };
  const scrolled = (target, root) => {
    for (let node = target; node; node = node.parentElement) {
      if (node.scrollTop > 0) return true;
      if (node === root) break;
    }
    return false;
  };
  listen(
    documentRef,
    'touchstart',
    (event) => {
      swipe = null;
      const sheet = currentSheetOf(body);
      const target = event.target;
      if (
        !sheet ||
        sheet === 'layers' ||
        sheet === 'scenes' ||
        sheet === 'more' ||
        !body.classList.contains(MOBILE_SHELL_CLASS) ||
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        target?.closest?.(
          'button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"]',
        )
      )
        return;
      const root = sheetRoot(target, sheet);
      if (!root || scrolled(target, root)) return;
      const touch = event.touches[0];
      swipe = {
        sheet,
        target,
        root,
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        claimed: false,
      };
    },
    { passive: true },
  );
  listen(
    documentRef,
    'touchmove',
    (event) => {
      if (!swipe) return;
      const touch = event.touches[0];
      if (
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        touch.identifier !== swipe.id ||
        currentSheetOf(body) !== swipe.sheet ||
        scrolled(swipe.target, swipe.root)
      ) {
        swipe = null;
        return;
      }
      const dx = touch.clientX - swipe.x;
      const dy = touch.clientY - swipe.y;
      if (!swipe.claimed) {
        // Claim direction before the browser crosses its native scroll slop.
        // Android can make the next move non-cancelable after a ~9px first move.
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        if (dy <= Math.abs(dx) * 1.25 || !event.cancelable) {
          swipe = null;
          return;
        }
        swipe.claimed = true;
      }
      // Cancelling only the claimed pull leaves taps, sliders and normal scroll
      // native, and suppresses the synthetic click at the end of a dismissal.
      event.preventDefault();
    },
    { passive: false },
  );
  listen(
    documentRef,
    'touchend',
    (event) => {
      const pull = swipe;
      swipe = null;
      if (!pull?.claimed || event.touches.length) return;
      const touch = [...event.changedTouches].find(
        (item) => item.identifier === pull.id,
      );
      if (!touch || currentSheetOf(body) !== pull.sheet) return;
      const dx = Math.abs(touch.clientX - pull.x);
      const dy = touch.clientY - pull.y;
      if (dy < 64 || dy <= dx * 1.25) return;
      returnFocus = tabFor(pull.sheet) ?? returnFocus;
      setSheet(null);
    },
    { passive: true },
  );
  listen(
    documentRef,
    'touchcancel',
    () => {
      swipe = null;
    },
    { passive: true },
  );
  // Bubble phase, so fields cancelling an edit, lightboxes, viewers and tools
  // take Escape first; panels yield it to the sheet (PanelChrome), and an open
  // dialog keeps its own native close.
  listen(documentRef, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (body.getAttribute('data-mobile-search-open') !== null) {
      event.preventDefault();
      setSearchOpen(false);
      return;
    }
    if (body.getAttribute('data-mobile-details') !== null) {
      event.preventDefault();
      closeDetails();
      return;
    }
    const sheet = currentSheetOf(body);
    if (!sheet || documentRef.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (sheet === 'more') { settingsPanel?.dismiss(); return; }
    returnFocus = tabFor(sheet) ?? returnFocus;
    setSheet(null);
  });

  if (typeof MutationObserverImpl === 'function') {
    if (layersList) {
      const layersObserver = new MutationObserverImpl(updateLayersActiveCount);
      layersObserver.observe(layersList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      removers.push(() => layersObserver.disconnect());
    }
    const observer = new MutationObserverImpl(() => {
      if (currentSheetOf(body) && sheetBlocked(body)) setSheet(null);
      if (sheetBlocked(body)) {
        setSearchOpen(false);
        closeDetails();
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    removers.push(() => observer.disconnect());
  }

  return {
    setSheet,
    getSheet: () => currentSheetOf(body),
    showCity(name) {
      if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
      const label = localizePlaceName(name);
      showDetails(label, poiRow);
      searchInput.value = label;
      updateSearchClear();
    },
    showDestination(label) {
      if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
      setSearchOpen(false);
      closeDetails();
      searchInput.value = label;
      updateSearchClear();
    },
    /**
     * The collapsed state to share for a panel a sheet borrowed: its state
     * before the sheets, or the user's own change since. Undefined otherwise.
     */
    sharedCollapsed(panelId) {
      if (!borrowed?.before.has(panelId)) return undefined;
      const now = prefersCollapsed(panelId);
      return now !== borrowed.applied.get(panelId)
        ? now
        : borrowed.before.get(panelId);
    },
    destroy() {
      loadingClearance?.destroy();
      mapControls?.destroy();
      sheetPeek?.destroy();
      setSheet(null);
      settingsPanel?.destroy();
      setSearchOpen(false);
      closeDetails();
      placePois(false);
      placeSearch(false);
      placeClearLayers(false);
      for (const remove of removers.splice(0)) remove();
      body.classList.remove(MOBILE_SHELL_CLASS);
      body.removeAttribute('data-mobile-search-typing');
      body.removeAttribute('data-mobile-layers-expanded');
      body.removeAttribute('data-mobile-scenes-expanded');
      body.removeAttribute('data-mobile-scenes-dragging');
      body.removeAttribute('data-mobile-layer-filter');
      body.removeAttribute(MOBILE_SHEET_ATTR);
      body.style.removeProperty('--mobile-sheet-height');
      body.style.removeProperty('--mobile-sheet-cover');
      body.style.removeProperty('--mobile-details-height');
      body.style.removeProperty('--mobile-status-offset');
      if (viewport && viewportContent !== null)
        viewport.setAttribute('content', viewportContent);
      tabBar.remove();
      headerScrim.remove();
      footerScrim.remove();
      searchBar.remove();
      details.remove();
    },
  };
}
