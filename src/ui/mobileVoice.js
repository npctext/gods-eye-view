import { t } from '../i18n/index.js';

// Keep the provider's live waveform and controls in one DOM tree.
export function initMobileVoice({ documentRef, trigger, onReveal, readCommands }) {
  const win = documentRef.defaultView;
  if (!win?.MutationObserver || !win.requestAnimationFrame) return null;
  const body = documentRef.body;
  const commands = readCommands || (() => win.__gevVoiceCommands);
  const sheetOpen = () => !!body.getAttribute('data-mobile-sheet') ||
    body.hasAttribute('data-mobile-search-open') ||
    documentRef.documentElement?.getAttribute('data-tab-transition') != null;
  const make = (tag, className, parent) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    parent?.append(node);
    return node;
  };
  const headerIcon = trigger.querySelector('.mobile-map-mic-icon');
  const headerWrap = make('span', 'mobile-map-icon mobile-voice-header-icon');
  headerIcon.before(headerWrap);
  headerWrap.append(headerIcon);
  make('span', 'mobile-voice-color-icon', headerWrap).setAttribute('aria-hidden', 'true');
  const panel = make('section', '', body);
  panel.id = 'mobile-voice-panel';
  panel.setAttribute('aria-label', t('Voice control'));
  const heading = make('header', 'mobile-voice-heading', panel);
  const info = make('div', 'mobile-voice-info', heading);
  const readout = make('div', 'mobile-voice-readout', info);
  const label = make('span', 'mobile-voice-status', readout);
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const activity = make('span', 'mobile-voice-activity', readout);
  const loading = make('span', 'mobile-status-icon mobile-voice-loading-icon', activity);
  loading.setAttribute('aria-hidden', 'true');
  loading.hidden = true;
  const waveform = make('span', 'mobile-voice-waveform', activity);
  waveform.setAttribute('aria-hidden', 'true');
  const waveformBars = Array.from({ length: 15 }, () => make('span', '', waveform));
  waveform.hidden = true;
  const button = (action, icon, parent = heading) => {
    const node = make('button', 'mobile-voice-action', parent);
    node.type = 'button';
    node.dataset.voiceAction = action;
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    return node;
  };
  const retry = button('retry', '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>');
  const retryLabel = make('span', 'mobile-voice-action-label', retry);
  const slot = make('div', 'mobile-voice-content', panel);
  slot.id = 'mobile-voice-content';
  const expand = make('button', 'mobile-voice-expand', panel);
  expand.type = 'button';
  expand.setAttribute('aria-controls', slot.id);
  expand.hidden = true;
  const end = make('button', 'mobile-sheet-control mobile-sheet-close', heading);
  end.type = 'button';
  end.dataset.voiceAction = 'end';
  make('span', 'mobile-sheet-close-icon', end).setAttribute('aria-hidden', 'true');
  const error = make('p', 'mobile-voice-error', panel);
  error.setAttribute('role', 'alert');
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attr = (node, name, value) => {
    if (value === null) node.removeAttribute(name);
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const name = (node, value) => { attr(node, 'aria-label', t(value)); node.title = t(value); };
  name(retry, 'Retry');
  trigger.setAttribute('aria-controls', panel.id);
  let source = null;
  let marker = null;
  let observedPreview = null;
  let frame = 0;
  let activeBefore = false;
  let opened = false;
  let expanded = false;
  let disposed = false;
  let meterSource = null;
  let meterBars = [];
  // Mirror the existing analyser; no extra audio capture or animation loop.
  const paintWaveform = () => {
    if (disposed) return;
    waveformBars.forEach((bar, index) => {
      const sourceBar = meterBars[index];
      const level = sourceBar?.style.getPropertyValue('--audio-level') || '5px';
      const opacity = sourceBar?.style.getPropertyValue('--audio-opacity') || '0.56';
      if (bar.style.getPropertyValue('--audio-level') !== level) bar.style.setProperty('--audio-level', level);
      if (bar.style.getPropertyValue('--audio-opacity') !== opacity) bar.style.setProperty('--audio-opacity', opacity);
    });
  };
  const meterObserver = new win.MutationObserver(paintWaveform);
  const bindMeter = (node) => {
    if (node === meterSource) return;
    meterObserver.disconnect();
    meterSource = node;
    meterBars = Array.from(node?.querySelectorAll('span') || []);
    paintWaveform();
    if (node) meterObserver.observe(node, { attributes: true, attributeFilter: ['style'], subtree: true });
  };
  const schedule = () => {
    if (!disposed && !frame) frame = win.requestAnimationFrame(sync);
  };
  const observer = new win.MutationObserver((records) => {
    if (records.some(record => record.type !== 'attributes' || record.oldValue !== record.target.getAttribute(record.attributeName))) schedule();
  });
  const restore = () => {
    if (marker?.isConnected && source?.isConnected) marker.replaceWith(source);
    else marker?.remove();
    marker = null;
  };
  function sync() {
    frame = 0;
    observer.disconnect();
    const mobile = body.classList.contains('mobile-shell');
    const next = documentRef.getElementById('gev-voice-control');
    if (next !== source) { restore(); source = next; }
    if (mobile && source && !marker) {
      marker = documentRef.createComment('mobile voice control');
      source.before(marker);
      slot.append(source);
    } else if (!mobile) restore();
    const owner = commands();
    const session = owner?.session;
    const available = !!source && owner?.ui?.root === source && !session?.disposed;
    const state = available ? session?.state || source.dataset.status || 'idle' : 'idle';
    const active = available && !['idle', 'error'].includes(state);
    const failed = state === 'error';
    const connecting = state === 'connecting';
    const speaking = active && !connecting && source?.dataset.speaker === 'ai';
    const muted = active && source?.dataset.microphone === 'muted';
    const shownState = failed ? 'error' : connecting ? 'connecting' : speaking ? 'speaking' : muted ? 'muted' : state === 'executing' ? 'working' : active ? 'listening' : 'idle';
    if (mobile && active && !activeBefore) {
      documentRef.dispatchEvent(new win.CustomEvent('gev:mobile-voice-start'));
    }
    if (activeBefore && available && state === 'idle') opened = false;
    activeBefore = mobile && active;
    const visible = mobile && opened && !sheetOpen();
    attr(panel, 'data-expanded', expanded ? '' : null);
    panel.classList.toggle('is-visible', visible);
    panel.inert = !visible;
    attr(panel, 'aria-hidden', !visible);
    attr(panel, 'data-state', shownState);
    attr(panel, 'data-microphone', muted ? 'muted' : 'active');
    attr(body, 'data-mobile-voice', mobile && (active || failed || visible) ? shownState : null);
    attr(body, 'data-mobile-voice-visible', visible ? '' : null);
    trigger.disabled = !available;
    attr(trigger, 'aria-disabled', !available);
    attr(trigger, 'aria-expanded', visible);
    attr(trigger, 'data-voice-active', active);
    attr(trigger, 'data-voice-state', shownState);
    activity.hidden = !visible || !active || (!connecting && muted && !speaking);
    loading.hidden = !visible || !connecting;
    waveform.hidden = !visible || !active || connecting || (muted && !speaking);
    bindMeter(waveform.hidden ? null : source?.querySelector('.gev-voice-visualizer'));
    name(trigger, visible ? 'Close voice panel' : active ? 'Voice active — open controls' : failed ? 'Voice error — open controls' : 'Start voice');
    const labels = {
      idle: 'Voice off', connecting: 'Connecting…', listening: 'Listening',
      speaking: 'Speaking', muted: 'Microphone muted', working: 'Working…', error: 'Voice unavailable',
    };
    text(label, t(labels[shownState]));
    end.hidden = !active && !failed;
    retry.hidden = !failed;
    text(retryLabel, t('Retry'));
    name(end, connecting ? 'Cancel connection' : failed ? 'Close' : 'End conversation');
    const detail = owner?.voicePanel;
    const presentation = detail?.snapshot();
    if (visible && active && presentation && (!presentation.panelOpen || presentation.view !== 'preview'))
      detail.select('preview', { automatic: true });
    slot.hidden = !active;
    expand.hidden = !visible || !active || (!expanded && slot.scrollHeight <= slot.clientHeight + 1);
    attr(expand, 'aria-expanded', expanded);
    text(expand, t(expanded ? 'Collapse panel' : 'Expand panel'));
    error.hidden = !failed;
    text(error, failed ? source?.querySelector('#gev-voice-error-detail')?.textContent || t('Voice could not be started.') : '');
    const nativePreview = source?.querySelector('#gev-voice-panel');
    if (nativePreview !== observedPreview) {
      if (observedPreview) resize.unobserve(observedPreview);
      observedPreview = nativePreview;
      if (observedPreview) resize.observe(observedPreview);
    }
    if (visible) {
      const rect = panel.getBoundingClientRect();
      const height = Math.ceil(rect.height) + 'px';
      if (body.style.getPropertyValue('--mobile-voice-height') !== height) {
        body.style.setProperty('--mobile-voice-height', height);
        documentRef.dispatchEvent(new win.CustomEvent('gev:mobile-voice-layout'));
      }
    }
    const watch = (node, options) => { if (node) observer.observe(node, { ...options, ...(options.attributes ? { attributeOldValue: true } : {}) }); };
    watch(body, { childList: true, attributes: true, attributeFilter: ['class', 'data-mobile-sheet', 'data-mobile-search-open', 'data-mobile-details', 'data-mobile-map-menu'] });
    watch(documentRef.documentElement, { attributes: true, attributeFilter: ['data-tab-transition'] });
    watch(documentRef.getElementById('command-dock'), { childList: true });
    watch(slot, { childList: true });
    watch(source, { attributes: true, attributeFilter: ['data-status', 'data-speaker', 'data-microphone'] });
    watch(source?.querySelector('#gev-voice-error-detail'), { childList: true, characterData: true, subtree: true });
    watch(source?.querySelector('#gev-voice-panel'), { attributes: true, attributeFilter: ['hidden', 'data-view'] });
  }
  const start = () => {
    opened = true;
    expanded = false;
    onReveal?.();
    const owner = commands();
    if (owner?.session && !owner.session.isActive()) owner.ui?.button?.click();
    sync();
  };
  const stop = (restoreFocus = true) => {
    opened = false;
    expanded = false;
    commands()?.voicePanel?.close();
    commands()?.session?.stop();
    if (restoreFocus) trigger.focus({ preventScroll: true });
    sync();
  };
  const toggle = () => {
    const reveal = !opened || sheetOpen();
    if (!reveal) { stop(); return; }
    expanded = false;
    if (reveal && commands()?.session?.state === 'idle') { start(); return; }
    opened = reveal;
    if (opened) onReveal?.();
    sync();
  };
  const onScenePlay = () => {
    if (body.classList.contains('mobile-shell') && (opened || commands()?.session?.isActive() || commands()?.session?.state === 'error'))
      stop(false);
  };
  documentRef.addEventListener('gev:mobile-scene-play', onScenePlay);
  expand.addEventListener('click', () => { expanded = !expanded; sync(); });
  trigger.addEventListener('click', toggle);
  retry.addEventListener('click', start);
  end.addEventListener('click', stop);
  const resize = new win.ResizeObserver(schedule);
  resize.observe(panel);
  sync();
  return { destroy() {
    disposed = true;
    win.cancelAnimationFrame(frame);
    observer.disconnect();
    resize.disconnect();
    meterObserver.disconnect();
    documentRef.removeEventListener('gev:mobile-scene-play', onScenePlay);
    trigger.removeEventListener('click', toggle);
    restore();
    headerWrap.replaceWith(headerIcon);
    body.removeAttribute('data-mobile-voice');
    body.removeAttribute('data-mobile-voice-visible');
    body.style.removeProperty('--mobile-voice-height');
    panel.remove();
  } };
}
