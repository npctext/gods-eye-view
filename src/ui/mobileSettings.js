import { getLocale, t } from '../i18n/index.js';
import { LOCALES, LOCALE_NAMES } from '../i18n/locale.js';

const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', ru: 'Russian', 'zh-CN': 'Chinese (Simplified)', 'zh-Hant': 'Chinese (Traditional)' };

const CATEGORIES = [
  ['appearance', 'Appearance', 'palette'],
  ['map', 'Map & objects', 'public'],
  ['sound', 'Sound & voice', 'graphic_eq'],
  ['keys', 'API keys & services', 'key'],
  ['language', 'Language', 'language'],
];
const ICONS = {
  palette: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  public: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  graphic_eq: '<path d="M4 9v6m4-10v14m4-17v20m4-17v14m4-10v6"/>',
  key: '<circle cx="8" cy="9" r="4"/><path d="m11 12 9 9m-3-3 3-3m-6 0 3-3"/>',
  language: '<path d="M3 5h12M9 3v2m-4 0c0 5 3 8 8 10M13 5c0 6-4 10-10 12m11 4 4-10 4 10m-6-4h4"/>',
};

// Borrow the live controls, including their listeners; restore their exact
// locations before changing category, closing, or returning to desktop.
export function initMobileSettings({ documentRef, onClose, onCollapse, onLanguageSelect }) {
  const win = documentRef.defaultView;
  if (!win?.requestAnimationFrame) return null;
  const body = documentRef.body;
  const make = (tag, className, parent, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text) node.textContent = t(text);
    parent?.append(node);
    return node;
  };
  const backdrop = make('div', 'mobile-settings-backdrop', body);
  backdrop.hidden = true;
  const root = make('section', '', body);
  root.id = 'mobile-settings';
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'mobile-settings-title');
  const handle = make('div', 'mobile-details-handle', root);
  handle.setAttribute('aria-hidden', 'true');
  const pages = make('div', 'mobile-settings-pages', root);
  const makePage = (id) => {
    const page = make('div', 'mobile-settings-page', pages);
    const header = make('header', 'mobile-settings-header', page);
    const back = make('button', 'mobile-sheet-control mobile-sheet-back', header);
    back.type = 'button';
    back.setAttribute('aria-label', t('Back'));
    back.addEventListener('click', () => goBack());
    const title = make('h2', 'mobile-sheet-title', header, 'Settings');
    title.id = id;
    const close = make('button', 'mobile-sheet-control mobile-sheet-close', header);
    close.type = 'button';
    close.setAttribute('aria-label', t('Close'));
    make('span', 'mobile-sheet-close-icon', close).setAttribute('aria-hidden', 'true');
    close.addEventListener('click', () => dismiss());
    const content = make('div', 'mobile-settings-content', page);
    return { page, header, back, title, close, content };
  };
  const indexPage = makePage('mobile-settings-title');
  const detailPage = makePage('mobile-settings-detail-title');
  detailPage.page.classList.add('mobile-settings-detail');
  detailPage.page.hidden = true;
  let { header, back, title, close, content } = indexPage;
  let returning = null;
  let categoryTrigger = null;
  let borrowed = [];
  let closing = null;
  let category = null;
  let tool = false;
  const restore = () => {
    for (const { node, marker, hidden } of borrowed.reverse()) {
      marker.replaceWith(node);
      node.hidden = hidden;
    }
    borrowed = [];
  };
  const borrow = (node, parent = content, reveal = false) => {
    if (!node) return false;
    const marker = documentRef.createComment('mobile settings control');
    node.before(marker);
    borrowed.push({ node, marker, hidden: node.hidden });
    parent.append(node);
    if (reveal) node.hidden = false;
    return true;
  };
  const byId = (id) => documentRef.getElementById(id);
  const group = (id) => borrow(byId(id)?.closest('.pp-toggle-group'));
  const note = (text) => make('p', 'mobile-settings-note', content, text);
  let rowFeedback = null;
  const clearRowFeedback = () => {
    if (!rowFeedback) return;
    rowFeedback.ripple.style.opacity = '0';
    rowFeedback.animation.cancel();
    rowFeedback = null;
  };
  const bindRowAction = (button, action) => {
    const ripple = make('span', 'mobile-map-row-ripple', button);
    ripple.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', async (event) => {
      if (root.hidden || root.inert || closing !== null || returning !== null) return;
      clearRowFeedback();
      if (!event.detail || win.matchMedia('(prefers-reduced-motion: reduce)').matches) { action(); return; }
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left) * button.offsetWidth / rect.width;
      const y = (event.clientY - rect.top) * button.offsetHeight / rect.height;
      const radius = Math.hypot(Math.max(x, button.offsetWidth - x), Math.max(y, button.offsetHeight - y));
      const animation = ripple.animate([
        { clipPath: 'circle(0px at ' + x + 'px ' + y + 'px)' },
        { clipPath: 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)' },
      ], { duration: 120, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
      ripple.style.opacity = '1';
      const feedback = rowFeedback = { ripple, animation };
      try { await animation.finished; } catch { return; }
      // Let the completed row fill paint before opening the next screen.
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
      if (rowFeedback !== feedback) return;
      clearRowFeedback();
      if (!root.hidden && !root.inert && closing === null && returning === null) action();
    });
  };
  const row = (label, icon, action, value = '') => {
    const button = make('button', 'mobile-settings-row', content);
    button.type = 'button';
    if (icon) {
      const symbol = make('span', 'mobile-settings-icon', button);
      symbol.setAttribute('aria-hidden', 'true');
      symbol.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
    }
    make('span', 'mobile-settings-label', button, label);
    if (value) make('span', 'mobile-settings-value', button, value);
    make('span', 'mobile-settings-chevron', button, '›').setAttribute('aria-hidden', 'true');
    bindRowAction(button, action);
    return button;
  };
  function show(next = null, isTool = false) {
    if (returning !== null || closing !== null) return;
    clearRowFeedback();
    if (next && !category && !isTool) categoryTrigger = documentRef.activeElement;
    restore();
    category = next;
    tool = isTool;
    root.dataset.category = next || 'index';
    const detail = !!next && !tool;
    ({ header, back, title, close, content } = detail ? detailPage : indexPage);
    detailPage.page.hidden = !detail;
    indexPage.page.inert = detail;
    indexPage.page.setAttribute('aria-hidden', String(detail));
    root.setAttribute('aria-labelledby', title.id);
    back.hidden = !next;
    if (!next && content.childElementCount && indexPage.title.textContent === t('Settings')) return;
    content.replaceChildren();
    content.scrollTop = 0;
    title.textContent = t(CATEGORIES.find(([key]) => key === next)?.[1] || (next === 'draw' ? 'Draw' : next === 'import' ? 'Import' : 'Settings'));
    if (!next) {
      for (const [key, label, icon] of CATEGORIES)
        row(label, icon, () => show(key), key === 'language' ? LOCALE_NAMES[getLocale()] : '');
    } else if (next === 'appearance') {
      borrow(byId('style-buttons'));
      group('hud-toggle');
      borrow(byId('param-slider-panel'));
      for (const id of ['scope-toggle', 'celestial-toggle', 'bloom-toggle', 'sharpen-toggle']) group(id);
    } else if (next === 'map') {
      borrow(documentRef.querySelector('.map-source-section'));
      group('models3d-toggle');
      group('detection-toggle');
    } else if (next === 'sound') {
      borrow(byId('gev-voice-provider-field'));
      const voice = byId('gev-voice-settings-panel');
      if (voice) {
        const controls = make('div', 'mobile-settings-voice', content);
        for (const node of [...voice.children]) borrow(node, controls);
      } else note('Voice settings are unavailable in this session.');
      const radio = byId('radio-volume')?.closest('label');
      if (radio) {
        make('h3', 'mobile-settings-section', content, 'Radio volume');
        borrow(radio);
      }
      note('Microphone access is managed by your browser.');
    } else if (next === 'keys') {
      const keys = byId('key-setup');
      if (keys) borrow(keys, content, true);
      else note('API keys are managed on the server. Open the app on the local server to configure services.');
    } else if (next === 'language') {
      note('Changing language reloads the page.');
      for (const locale of LOCALES) {
        const selected = locale === getLocale();
        const option = make('button', 'mobile-settings-row mobile-language-row', content);
        option.type = 'button';
        option.dataset.locale = locale;
        option.setAttribute('aria-pressed', String(selected));
        const labels = make('span', 'mobile-language-labels', option);
        make('span', 'mobile-language-name', labels).textContent = LANGUAGE_NAMES[locale];
        make('span', 'mobile-language-code', labels).textContent = locale.toUpperCase();
        const check = make('span', 'mobile-language-check', option);
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
        bindRowAction(option, () => onLanguageSelect?.(locale));
      }
    } else if (next === 'draw') {
      group('draw-toggle');
      note('Choose a shape, then tap the map to draw.');
    } else if (next === 'import') {
      borrow(byId('geo-import-group'));
    }
    if (next) back.focus({ preventScroll: true });
  }
  const dismiss = () => {
    if (closing !== null || root.hidden) return;
    clearRowFeedback();
    root.classList.add('is-closing');
    const value = win.getComputedStyle(root).getPropertyValue('--mobile-sheet-animation-duration').trim() || '280ms';
    const duration = win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    closing = win.setTimeout(onClose, duration);
  };
  const goBack = () => {
    if (closing !== null || returning !== null) return;
    clearRowFeedback();
    if (tool || !category) { dismiss(); return; }
    detailPage.page.classList.add('is-leaving');
    const value = win.getComputedStyle(root).getPropertyValue('--mobile-settings-page-duration').trim() || '180ms';
    const duration = win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    returning = win.setTimeout(() => {
      returning = null;
      show();
      detailPage.page.classList.remove('is-leaving');
      detailPage.content.replaceChildren();
      if (categoryTrigger?.isConnected) categoryTrigger.focus({ preventScroll: true });
      else indexPage.close.focus({ preventScroll: true });
    }, duration);
  };
  backdrop.addEventListener('click', dismiss);
  // Keep provider setup's own delegated handlers, but use the sheet's Back.
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-key-setup-close]')) {
      event.stopImmediatePropagation();
      goBack();
    }
  }, true);
  root.addEventListener('change', (event) => {
    if (event.target.id !== 'gev-voice-provider') return;
    // The provider remount queries its original root for these live controls.
    restore();
    win.queueMicrotask(() => {
      if (!root.hidden && category === 'sound') {
        show('sound');
        byId('gev-voice-provider')?.focus();
      }
    });
  }, true);
  const escape = (event) => {
    if (root.hidden || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    goBack();
  };
  root.addEventListener('keydown', escape);
  let pull = null;
  let collapseOnClick = false;
  indexPage.header.style.touchAction = detailPage.header.style.touchAction = handle.style.touchAction = 'none';
  const start = (event) => {
    collapseOnClick = false;
    if (closing !== null || returning !== null || !event.isPrimary || event.button !== 0 ||
        event.target.closest('button, input, select, textarea, label, a, summary, [role], [contenteditable], [tabindex]')) return;
    if (!event.target.closest('.mobile-settings-header, .mobile-details-handle')) return;
    clearRowFeedback();
    root.style.animation = 'none';
    root.classList.add('is-dragging');
    root.setPointerCapture(event.pointerId);
    pull = { id: event.pointerId, x: event.clientX, y: event.clientY, delta: 0, moved: false };
  };
  root.addEventListener('pointerdown', start);
  root.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pull?.id) return;
    pull.moved ||= Math.hypot(event.clientX - pull.x, event.clientY - pull.y) > 4;
    pull.delta = Math.max(0, event.clientY - pull.y);
    root.style.transform = `translateY(${pull.delta}px)`;
  });
  const end = (event) => {
    if (event.pointerId !== pull?.id) return;
    const shouldClose = event.type === 'pointerup' && pull.delta > 64;
    const shouldCollapse = event.type === 'pointerup' && !pull.moved
      && Math.hypot(event.clientX - pull.x, event.clientY - pull.y) <= 4;
    pull = null;
    root.getBoundingClientRect();
    root.classList.remove('is-dragging');
    root.style.removeProperty('transform');
    if (shouldClose) dismiss();
    else if (shouldCollapse) collapseOnClick = true;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('click', (event) => {
    if (!collapseOnClick) return;
    collapseOnClick = false;
    event.preventDefault();
    event.stopPropagation();
    onCollapse?.();
  });
  return {
    show,
    dismiss,
    sync(open) {
      clearRowFeedback();
      win.clearTimeout(closing);
      win.clearTimeout(returning);
      returning = null;
      detailPage.page.classList.remove('is-leaving');
      closing = null;
      pull = null;
      collapseOnClick = false;
      root.classList.remove('is-closing', 'is-dragging');
      root.style.removeProperty('transform');
      root.style.removeProperty('animation');
      root.hidden = backdrop.hidden = !open;
      if (open) show();
      else {
        restore();
        indexPage.content.replaceChildren();
        detailPage.content.replaceChildren();
        categoryTrigger = null;
      }
    },
    destroy() {
      clearRowFeedback();
      win.clearTimeout(closing);
      win.clearTimeout(returning);
      restore();
      root.remove();
      backdrop.remove();
    },
  };
}
