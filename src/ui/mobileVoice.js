import { t } from '../i18n/index.js';

// Keep the provider's live waveform and controls in one DOM tree.
export function initMobileVoice({ documentRef, trigger, onReveal, readCommands }) {
  const win = documentRef.defaultView;
  if (!win?.MutationObserver || !win.requestAnimationFrame) return null;
  const body = documentRef.body;
  const commands = readCommands || (() => win.__gevVoiceCommands);
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
  const activity = make('span', 'mobile-voice-activity', trigger);
  const loading = make('span', 'mobile-status-icon mobile-voice-loading-icon', activity);
  loading.setAttribute('aria-hidden', 'true');
  loading.hidden = true;
  const waveform = make('span', 'mobile-voice-waveform', activity);
  waveform.setAttribute('aria-hidden', 'true');
  const waveformBars = Array.from({ length: 4 }, () => make('span', '', waveform));
  waveform.hidden = true;
  const panel = make('section', '', body);
  panel.id = 'mobile-voice-panel';
  panel.setAttribute('aria-label', t('Voice control'));
  const button = (action, icon, parent = panel) => {
    const node = make('button', 'mobile-voice-action', parent);
    node.type = 'button';
    node.dataset.voiceAction = action;
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    return node;
  };
  const mute = button('microphone', '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/><path class="mobile-voice-mute-slash" d="m3 3 18 18"/>');
  const retry = button('retry', '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>');
  const info = make('div', 'mobile-voice-info', panel);
  const preview = make('button', 'mobile-voice-summary', info);
  preview.type = 'button';
  preview.setAttribute('aria-label', t('View conversation'));
  const label = make('span', 'mobile-voice-status', preview);
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const chevron = make('span', 'mobile-voice-preview-icon', preview);
  chevron.setAttribute('aria-hidden', 'true');
  const slot = make('div', 'mobile-voice-meter', info);
  const interrupt = button('interrupt', '<path d="M8 5v14M16 5v14"/>');
  const end = button('end', '<rect x="6" y="6" width="12" height="12" rx="1"/>');
  const error = make('p', 'mobile-voice-error', panel);
  error.setAttribute('role', 'alert');
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attr = (node, name, value) => {
    if (value === null) node.removeAttribute(name);
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
  };
  const name = (node, value) => { attr(node, 'aria-label', t(value)); node.title = t(value); };
  name(retry, 'Retry');
  name(interrupt, 'Interrupt response');
  trigger.setAttribute('aria-controls', panel.id);
  let source = null;
  let marker = null;
  let observedPreview = null;
  let frame = 0;
  let activeBefore = false;
  let disposed = false;
  let meterSource = null;
  let meterBars = [];
  // Mirror the existing analyser; no extra audio capture or animation loop.
  const paintWaveform = () => {
    if (disposed) return;
    waveformBars.forEach((bar, index) => {
      const start = Math.floor(index * meterBars.length / waveformBars.length);
      const end = Math.floor((index + 1) * meterBars.length / waveformBars.length);
      let peak = 5;
      for (let bin = start; bin < end; bin++)
        peak = Math.max(peak, parseFloat(meterBars[bin].style.getPropertyValue('--audio-level')) || 5);
      const level = Math.min(34, peak) + 'px';
      if (bar.style.getPropertyValue('--audio-level') !== level) bar.style.setProperty('--audio-level', level);
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
    activeBefore = mobile && active;
    const visible = mobile && (active || failed);
    panel.classList.toggle('is-visible', visible);
    panel.inert = !visible;
    attr(panel, 'aria-hidden', !visible);
    attr(panel, 'data-state', shownState);
    attr(panel, 'data-microphone', muted ? 'muted' : 'active');
    attr(body, 'data-mobile-voice', mobile && (active || failed) ? shownState : null);
    attr(body, 'data-mobile-voice-visible', visible ? '' : null);
    trigger.disabled = !available;
    attr(trigger, 'aria-disabled', !available);
    attr(trigger, 'aria-pressed', active);
    attr(trigger, 'aria-busy', connecting);
    attr(trigger, 'data-voice-state', shownState);
    attr(trigger, 'data-microphone', muted ? 'muted' : 'active');
    activity.hidden = !mobile || !active || (!connecting && muted);
    loading.hidden = !mobile || !connecting;
    waveform.hidden = !mobile || !active || connecting || muted;
    bindMeter(waveform.hidden ? null : source?.querySelector('.gev-voice-visualizer'));
    name(trigger, connecting ? 'Cancel connection' : active ? 'End conversation' : failed ? 'Retry' : 'Start voice');
    const labels = {
      idle: 'Voice off', connecting: 'Connecting…', listening: 'Listening',
      speaking: 'Speaking', muted: 'Microphone muted', working: 'Working…', error: 'Voice unavailable',
    };
    text(label, t(labels[shownState]));
    mute.hidden = failed;
    mute.disabled = connecting || !active || typeof session?.adapter?.setMicrophoneEnabled !== 'function';
    attr(mute, 'aria-pressed', !muted && active && !connecting);
    name(mute, muted ? 'Unmute microphone' : 'Mute microphone');
    retry.hidden = !failed;
    interrupt.hidden = !speaking;
    interrupt.disabled = typeof session?.adapter?.interrupt !== 'function';
    name(end, connecting ? 'Cancel connection' : failed ? 'Close' : 'End conversation');
    preview.disabled = !owner?.voicePanel;
    attr(preview, 'aria-expanded', !!owner?.voicePanel?.snapshot().panelOpen);
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
      const top = nativePreview && !nativePreview.hidden && nativePreview.dataset.view === 'preview'
        ? Math.min(rect.top, nativePreview.getBoundingClientRect().top) : rect.top;
      const height = Math.ceil(rect.bottom - top) + 'px';
      if (body.style.getPropertyValue('--mobile-voice-height') !== height) {
        body.style.setProperty('--mobile-voice-height', height);
        documentRef.dispatchEvent(new win.CustomEvent('gev:mobile-voice-layout'));
      }
    }
    const watch = (node, options) => { if (node) observer.observe(node, { ...options, ...(options.attributes ? { attributeOldValue: true } : {}) }); };
    watch(body, { childList: true, attributes: true, attributeFilter: ['class', 'data-mobile-sheet', 'data-mobile-search-open', 'data-mobile-details', 'data-mobile-map-menu'] });
    watch(documentRef.getElementById('command-dock'), { childList: true });
    watch(slot, { childList: true });
    watch(source, { attributes: true, attributeFilter: ['data-status', 'data-speaker', 'data-microphone'] });
    watch(source?.querySelector('#gev-voice-error-detail'), { childList: true, characterData: true, subtree: true });
    watch(source?.querySelector('#gev-voice-panel'), { attributes: true, attributeFilter: ['hidden', 'data-view'] });
  }
  const start = () => {
    onReveal?.();
    const owner = commands();
    if (owner?.session && !owner.session.isActive()) owner.ui?.button?.click();
    sync();
  };
  const stop = () => {
    commands()?.voicePanel?.close();
    commands()?.session?.stop();
    trigger.focus({ preventScroll: true });
    sync();
  };
  const toggle = () => {
    if (commands()?.session?.isActive()) stop();
    else start();
  };
  trigger.addEventListener('click', toggle);
  mute.addEventListener('click', () => {
    commands()?.session?.setMicrophoneEnabled(source?.dataset.microphone === 'muted');
    sync();
  });
  retry.addEventListener('click', start);
  interrupt.addEventListener('click', () => { commands()?.session?.interrupt(); schedule(); });
  end.addEventListener('click', stop);
  preview.addEventListener('click', () => {
    const detail = commands()?.voicePanel;
    if (detail?.snapshot().panelOpen) detail.close();
    else detail?.select('preview');
    sync();
  });
  const resize = new win.ResizeObserver(schedule);
  resize.observe(panel);
  sync();
  return { destroy() {
    disposed = true;
    win.cancelAnimationFrame(frame);
    observer.disconnect();
    resize.disconnect();
    meterObserver.disconnect();
    trigger.removeEventListener('click', toggle);
    restore();
    headerWrap.replaceWith(headerIcon);
    activity.remove();
    body.removeAttribute('data-mobile-voice');
    body.removeAttribute('data-mobile-voice-visible');
    body.style.removeProperty('--mobile-voice-height');
    panel.remove();
  } };
}
