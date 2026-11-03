import { msg, t } from '../i18n/index.js';
import { disposeSplitFlap } from '../splitFlap.js';

// Borrow the existing controls so the layer controllers keep owning their state.
export function initMobileCameras({ documentRef, onClose, onCollapse, onCoverageChange, onRetryFrame, onConfigureKey }) {
  const win = documentRef.defaultView;
  const byId = (id) => documentRef.getElementById(id);
  const root = byId('right-context-rail');
  const cctv = byId('cctv-panel');
  const street = byId('street-level-panel');
  if (!win?.MutationObserver || !root || !cctv || !street) return null;
  const make = (tag, className, parent, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text) node.textContent = t(text);
    parent?.append(node);
    return node;
  };
  const button = (className, parent, text) => {
    const node = make('button', className, parent, text);
    node.type = 'button';
    return node;
  };
  const chrome = make('div', '', root);
  chrome.id = 'mobile-cameras-chrome';
  root.prepend(chrome);
  const header = make('header', 'mobile-cameras-header', chrome);
  const collapse = button('mobile-cameras-collapse', header);
  collapse.setAttribute('aria-label', t('Collapse cameras'));
  make('span', 'mobile-details-handle', collapse).setAttribute('aria-hidden', 'true');
  make('span', 'mobile-sheet-title', collapse, msg('CAMERAS'));
  const close = button('mobile-sheet-control mobile-sheet-close', header);
  close.setAttribute('aria-label', t('Close'));
  make('span', 'mobile-sheet-close-icon', close).setAttribute('aria-hidden', 'true');
  const tabs = make('div', 'mobile-camera-segments mobile-cameras-tabs', chrome);
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', t('Camera type'));
  const tabButtons = ['cctv', 'street'].map((value) => {
    const node = button('', tabs, value === 'cctv' ? msg('CCTV') : msg('Street Level'));
    node.id = `mobile-camera-tab-${value}`;
    node.dataset.cameraTab = value;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', value === 'cctv' ? cctv.id : street.id);
    return node;
  });
  let mounted = false;
  let open = false;
  let selected = 'cctv';
  let closing = null;
  let borrowed = [];
  let created = [];
  let attributes = [];
  let drag = null;
  let suppressClick = false;
  let coverageButtons = [];
  let caption, captionText, expand, retry, keyAction;
  const select = byId('cctv-camera-select');
  const frame = byId('cctv-frame-wrap');
  const source = byId('cctv-source-badge');
  const coverage = byId('cctv-coverage-btn');
  const status = byId('sl-status');
  const error = byId('sl-error');
  const meta = byId('sl-coverage-meta');
  const remember = (node, name, value) => {
    attributes.push([node, name, node.getAttribute(name)]);
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  };
  const borrow = (node, parent) => {
    const marker = documentRef.createComment('mobile camera control');
    node.before(marker);
    borrowed.push([node, marker]);
    parent.append(node);
    return node;
  };
  const section = (className, parent, tag = 'div') => {
    const node = make(tag, className, parent);
    created.push(node);
    return node;
  };
  const relabel = (node, text) => {
    const original = node.textContent;
    remember(node, 'data-i18n', null);
    node.textContent = t(text);
    return () => { node.textContent = original; };
  };
  let restoreLabels = [];
  const duration = () => {
    const value = win.getComputedStyle(root).getPropertyValue('--mobile-sheet-animation-duration').trim();
    return win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(value || '280ms') * (value.endsWith('s') && !value.endsWith('ms') ? 1000 : 1);
  };
  const expanded = () => documentRef.fullscreenElement === frame || frame.matches(':popover-open');
  const shrink = () => {
    if (documentRef.fullscreenElement === frame) void documentRef.exitFullscreen()?.catch(() => {});
    if (frame.matches(':popover-open')) frame.hidePopover();
    frame.removeAttribute('popover');
  };
  const syncExpanded = () => {
    if (!expand) return;
    expand.setAttribute('aria-pressed', String(expanded()));
    expand.setAttribute('aria-label', t(expanded() ? 'Shrink' : 'Expand'));
  };
  const changeTab = (value) => {
    if (!['cctv', 'street'].includes(value)) return;
    selected = value;
    shrink();
    root.dataset.cameraTab = value;
    for (const node of tabButtons) {
      const active = node.dataset.cameraTab === value;
      node.setAttribute('aria-selected', String(active));
      node.tabIndex = active ? 0 : -1;
    }
    cctv.hidden = !open || value !== 'cctv';
    street.hidden = !open || value !== 'street';
    // Street imagery viewers already listen for a resize when their host appears.
    if (open && value === 'street') win.dispatchEvent(new win.Event('resize'));
  };
  const render = () => {
    if (!mounted) return;
    const state = cctv.dataset.cameraState;
    const ready = frame.classList.contains('has-frame') || !byId('cctv-video').hidden;
    const failed = source.dataset.frameState === 'error';
    const message = state === 'off' ? msg('Enable CCTV to browse cameras') : state === 'loading' ? msg('Loading cameras…') : state === 'empty' ? msg('No cameras available') : failed ? msg('Camera frame unavailable') : source.dataset.frameState === 'loading' ? msg('Loading camera frame…') : msg('Select a camera to preview');
    const text = t(message);
    if (captionText.textContent !== text) {
      disposeSplitFlap(captionText);
      captionText.textContent = text;
    }
    caption.dataset.loading = String(state === 'loading' || source.dataset.frameState === 'loading');
    caption.dataset.error = String(failed);
    caption.hidden = ready;
    retry.hidden = !failed || state === 'off';
    expand.disabled = !ready;
    source.hidden = state === 'off' || state === 'empty' || state === 'loading';
    for (const node of coverageButtons) {
      const checked = node.dataset.coverageMode === coverage.dataset.mode;
      node.setAttribute('aria-checked', String(checked));
      node.tabIndex = checked ? 0 : -1;
      node.disabled = coverage.disabled;
    }
    keyAction.hidden = !status.classList.contains('is-warn');
    meta.hidden = !error.hidden && byId('sl-error-text').textContent.trim() === meta.textContent.trim();
    syncExpanded();
  };
  const observer = new win.MutationObserver(render);
  const mount = () => {
    if (mounted) return;
    mounted = true;
    for (const [pane, name] of [[cctv, 'cctv'], [street, 'street']]) {
      remember(pane, 'hidden', pane.hidden ? '' : null);
      remember(pane, 'role', 'tabpanel');
      remember(pane, 'aria-labelledby', `mobile-camera-tab-${name}`);
      pane.classList.add('mobile-camera-pane', 'mobile-cameras-scroll');
    }
    const body = cctv.querySelector('.cyber-panel-body');
    const main = section('mobile-camera-main', body);
    body.prepend(main);
    borrow(byId('cctv-enable-btn'), main);
    const field = make('label', 'mobile-camera-field', main, msg('Camera'));
    field.htmlFor = select.id;
    borrow(select, field);
    borrow(frame, main);
    caption = section('mobile-camera-placeholder', frame, 'p');
    captionText = make('span', 'mobile-camera-placeholder-text', caption);
    retry = section('mobile-camera-retry', main, 'button');
    retry.type = 'button';
    retry.textContent = t('Retry frame');
    retry.addEventListener('click', onRetryFrame);
    remember(source, 'hidden', source.hidden ? '' : null);
    borrow(source, main);
    expand = section('mobile-camera-expand', frame, 'button');
    expand.type = 'button';
    expand.hidden = !frame.requestFullscreen && !frame.showPopover;
    expand.setAttribute('aria-label', t('Expand'));
    const expandIcon = make('span', '', expand);
    expandIcon.setAttribute('aria-hidden', 'true');
    expandIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
    remember(frame, 'popover', null);
    const openPopover = () => { frame.setAttribute('popover', 'manual'); frame.showPopover?.(); };
    expand.addEventListener('click', async () => {
      if (expanded()) { shrink(); return; }
      try {
        if (frame.requestFullscreen) await frame.requestFullscreen();
        else openPopover();
      } catch {
        if (mounted && open && selected === 'cctv') openPopover();
      }
      if (!mounted || !open || selected !== 'cctv') shrink();
      syncExpanded();
    });
    const navigation = make('div', 'mobile-camera-navigation', main);
    for (const id of ['cctv-prev-btn', 'cctv-focus-btn', 'cctv-next-btn']) borrow(byId(id), navigation);
    for (const [id, label] of [['cctv-prev-btn', msg('Previous camera')], ['cctv-next-btn', msg('Next camera')]]) {
      remember(byId(id), 'aria-label', t(label));
      remember(byId(id), 'title', t(label));
    }
    restoreLabels.push(relabel(byId('cctv-focus-btn'), msg('Show on map')));
    restoreLabels.push(relabel(byId('cctv-nearest-btn'), msg('Find nearest camera')));
    borrow(byId('cctv-nearest-btn'), main);
    const options = section('mobile-camera-options', body);
    for (const id of ['cctv-auto-hop-btn', 'cctv-projection-btn']) borrow(byId(id), options);
    const coverageField = make('div', 'mobile-camera-field', options, msg('Coverage'));
    const modes = make('div', 'mobile-camera-segments', coverageField);
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', t('Coverage'));
    coverageButtons = [['off', msg('Off')], ['on', msg('Wireframe')], ['viewshed', msg('Viewshed')]].map(([mode, label]) => {
      const node = button('', modes, label);
      node.dataset.coverageMode = mode;
      node.setAttribute('role', 'radio');
      node.addEventListener('click', () => onCoverageChange?.(mode));
      return node;
    });
    modes.addEventListener('keydown', (event) => {
      const index = coverageButtons.indexOf(event.target);
      const next = keyboardIndex(event.key, index, coverageButtons.length);
      if (next === null || coverageButtons[next].disabled) return;
      event.preventDefault();
      coverageButtons[next].focus();
      coverageButtons[next].click();
    });
    const calibration = section('mobile-camera-details', body, 'details');
    const summary = make('summary', '', calibration);
    make('span', '', summary, msg('Calibration'));
    borrow(byId('cctv-quality-chip'), summary);
    borrow(cctv.querySelector('.cctv-calibration-block'), calibration);
    const information = section('mobile-camera-details', body, 'details');
    make('summary', '', information, msg('Camera details'));
    borrow(byId('cctv-meta'), information);
    borrow(byId('cctv-summary'), information);
    const streetBody = byId('sl-body');
    const enable = section('mobile-camera-street-enable', streetBody);
    streetBody.prepend(enable);
    make('span', '', enable, msg('Street Level'));
    borrow(status, enable);
    borrow(byId('sl-viewer-wrap'), streetBody);
    borrow(street.querySelector('.sl-meta-row'), streetBody);
    keyAction = section('mobile-camera-key-action', error, 'button');
    keyAction.type = 'button';
    keyAction.textContent = t('Configure key');
    keyAction.addEventListener('click', onConfigureKey);
    remember(meta, 'hidden', meta.hidden ? '' : null);
    for (const node of [cctv, coverage, select, source, frame, byId('cctv-video'), status, error, meta]) {
      observer.observe(node, {
        attributes: true,
        attributeFilter: ['class', 'disabled', 'data-mode', 'data-camera-state', 'data-frame-state'],
        childList: node === select || node === status || node === meta,
      });
    }
    changeTab(selected);
    render();
  };
  const unmount = () => {
    if (!mounted) return;
    observer.disconnect();
    shrink();
    mounted = false;
    disposeSplitFlap(captionText);
    for (const [node, marker] of borrowed.reverse()) marker.replaceWith(node);
    for (const node of created) node.remove();
    for (const [node, name, value] of attributes.reverse()) {
      if (value === null) node.removeAttribute(name);
      else node.setAttribute(name, value);
    }
    for (const restore of restoreLabels) restore();
    for (const pane of [cctv, street]) pane.classList.remove('mobile-camera-pane', 'mobile-cameras-scroll');
    borrowed = []; created = []; attributes = []; restoreLabels = [];
    delete root.dataset.cameraTab;
  };
  const resetClosing = () => {
    win.clearTimeout(closing);
    closing = null;
    drag = null;
    root.classList.remove('mobile-cameras-dragging');
    root.style.removeProperty('transform');
  };
  const dismiss = () => {
    if (!open || closing !== null) return;
    root.style.transform = 'translateY(110%)';
    closing = win.setTimeout(() => { resetClosing(); onClose(); }, duration());
  };
  close.addEventListener('click', dismiss);
  collapse.addEventListener('click', () => { if (!suppressClick) onCollapse(); });
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-camera-tab]');
    if (tab) changeTab(tab.dataset.cameraTab);
  });
  tabs.addEventListener('keydown', (event) => {
    const next = keyboardIndex(event.key, tabButtons.indexOf(event.target), 2);
    if (next === null) return;
    event.preventDefault();
    tabButtons[next].focus();
    changeTab(tabButtons[next].dataset.cameraTab);
  });
  collapse.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || closing !== null) return;
    suppressClick = false;
    drag = { id: event.pointerId, y: event.clientY, distance: 0 };
    collapse.setPointerCapture(event.pointerId);
  });
  collapse.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.distance = event.clientY - drag.y;
    if (Math.abs(drag.distance) < 6) return;
    suppressClick = true;
    root.classList.add('mobile-cameras-dragging');
    root.style.transform = `translateY(${Math.max(0, drag.distance)}px)`;
  });
  const release = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const distance = drag.distance;
    resetClosing();
    if (event.type === 'pointerup' && distance > 64) dismiss();
    win.setTimeout(() => { suppressClick = false; }, 0);
  };
  collapse.addEventListener('pointerup', release);
  collapse.addEventListener('pointercancel', release);
  const focusMap = () => { if (mounted && open && !byId('cctv-focus-btn').disabled) onCollapse(); };
  byId('cctv-focus-btn').addEventListener('click', focusMap);
  const escapePreview = (event) => {
    if (event.key !== 'Escape' || !expanded()) return;
    event.preventDefault();
    event.stopPropagation();
    shrink();
  };
  documentRef.addEventListener('keydown', escapePreview, true);
  documentRef.addEventListener('fullscreenchange', syncExpanded);
  frame.addEventListener('toggle', syncExpanded);
  return {
    dismiss,
    setMobile(value) { if (value) mount(); else { resetClosing(); unmount(); } },
    sync(value) {
      open = value;
      resetClosing();
      if (mounted) changeTab(selected);
    },
    destroy() {
      resetClosing();
      unmount();
      chrome.remove();
      byId('cctv-focus-btn').removeEventListener('click', focusMap);
      documentRef.removeEventListener('keydown', escapePreview, true);
      documentRef.removeEventListener('fullscreenchange', syncExpanded);
      frame.removeEventListener('toggle', syncExpanded);
    },
  };
}

function keyboardIndex(key, index, count) {
  if (index < 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index + count - 1) % count;
  return null;
}
