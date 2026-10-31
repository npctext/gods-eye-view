import { t } from '../i18n/index.js';

const time = (seconds) => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export function mountMobileScenePlayer(player, documentRef = globalThis.document) {
  if (!player || !documentRef?.createElement) return null;
  const root = documentRef.createElement('section');
  if (!root.querySelector) return null;
  root.id = 'mobile-scene-player';
  root.setAttribute('aria-label', t('Scene player'));
  root.innerHTML = `
    <button class="scene-player-close" type="button"><img src="/scene-player-close.svg" alt=""></button>
    <div class="scene-player-body">
      <div class="scene-player-transport">
        <button data-player-action="previous" type="button"><img src="/scene-player-previous.svg" alt="" width="16" height="16"></button>
        <button data-player-action="toggle" type="button"><img src="/scene-player-pause.svg" alt="" width="16" height="16"><span class="scene-player-play-icon" hidden>▶</span></button>
        <button data-player-action="next" type="button"><img src="/scene-player-next.svg" alt="" width="16" height="16"></button>
      </div>
      <div class="scene-player-timeline">
        <div class="scene-player-title"></div>
        <div class="scene-player-track"><div class="scene-player-segments"></div><img class="scene-player-playhead" src="/scene-player-playhead.svg" alt="" width="10" height="10"><input type="range" min="0" max="1000" step="1"></div>
        <div class="scene-player-meta"><span class="scene-player-time"></span><span class="scene-player-count"></span></div>
      </div>
    </div>`;
  const find = (selector) => root.querySelector(selector);
  const close = find('.scene-player-close');
  const previous = find('[data-player-action="previous"]');
  const toggle = find('[data-player-action="toggle"]');
  const next = find('[data-player-action="next"]');
  const slider = find('input');
  const title = find('.scene-player-title');
  const stamp = find('.scene-player-time');
  const count = find('.scene-player-count');
  const segments = find('.scene-player-segments');
  close.setAttribute('aria-label', t('Stop and close player'));
  previous.setAttribute('aria-label', t('Previous shot'));
  next.setAttribute('aria-label', t('Next shot'));
  slider.setAttribute('aria-label', t('Scene progress'));
  let snapshot = player.getState();
  let dragging = false;
  let wasPlaying = false;
  let segmentKey = '';
  const drawProgress = (progress) => {
    const shots = snapshot.shots;
    const index = Math.max(0, shots.findLastIndex((shot) => shot.start <= progress));
    const start = shots[index]?.start || 0;
    const end = shots[index + 1]?.start ?? 1;
    const position = index + Math.max(0, Math.min(1, (progress - start) / (end - start || 1)));
    const fraction = position / (shots.length || 1);
    if (!dragging) slider.value = String(fraction * 1000);
    root.style.setProperty('--scene-player-position', position);
    root.style.setProperty('--scene-player-progress', `${fraction * 100}%`);
    root.style.setProperty('--scene-player-gap-offset', index - fraction * (shots.length - 1));
    stamp.textContent = `${time(progress * snapshot.duration)} / ${time(snapshot.duration)}`;
  };
  const sliderProgress = () => {
    const shots = snapshot.shots;
    const position = Number(slider.value) / 1000 * shots.length;
    const index = Math.min(Math.floor(position), shots.length - 1);
    const start = shots[index]?.start || 0;
    return start + ((shots[index + 1]?.start ?? 1) - start) * (position - index);
  };
  const draw = (state) => {
    snapshot = state;
    root.classList.toggle('is-visible', state.visible);
    root.inert = !state.visible;
    root.setAttribute('aria-hidden', String(!state.visible));
    const busy = ['loading', 'seeking'].includes(state.status);
    root.setAttribute('aria-busy', String(busy));
    previous.disabled = busy || state.index <= 0;
    next.disabled = busy || state.index >= state.shots.length - 1;
    previous.classList.toggle('is-unavailable', state.index <= 0);
    next.classList.toggle('is-unavailable', state.index >= state.shots.length - 1);
    toggle.disabled = busy;
    slider.disabled = state.status === 'loading';
    const playing = state.status === 'playing';
    toggle.setAttribute('aria-label', t(playing ? 'Pause' : state.status === 'ended' ? 'Replay' : 'Play'));
    toggle.querySelector('img').hidden = !playing;
    toggle.querySelector('span').hidden = playing;
    title.textContent = state.status === 'error' ? t('Unable to play. Try again.')
      : busy ? t('Loading…') : state.shots[state.index]?.title || state.title || '';
    title.title = title.textContent;
    count.textContent = `${String(state.index + 1).padStart(2, '0')} / ${String(state.shots.length).padStart(2, '0')}`;
    if (!dragging) drawProgress(state.progress);
    slider.setAttribute('aria-valuetext', `${time(state.elapsed)} / ${time(state.duration)}`);
    const key = JSON.stringify(state.shots);
    if (key !== segmentKey) {
      segmentKey = key;
      root.style.setProperty('--scene-player-segment-count', state.shots.length || 1);
      segments.replaceChildren(...state.shots.map((shot, index) => {
        const segment = documentRef.createElement('span');
        segment.style.setProperty('--segment-index', index);
        return segment;
      }));
    }
  };
  const begin = () => {
    if (dragging) return;
    wasPlaying = snapshot.status === 'playing';
    dragging = true;
    player.pause();
  };
  const cancel = () => {
    if (!dragging) return;
    dragging = false;
    draw(snapshot);
    if (wasPlaying) player.toggle();
  };
  close.addEventListener('click', () => { dragging = false; player.close(); });
  previous.addEventListener('click', () => player.adjacent(-1));
  next.addEventListener('click', () => player.adjacent(1));
  toggle.addEventListener('click', () => player.toggle());
  slider.addEventListener('pointerdown', begin);
  slider.addEventListener('pointercancel', cancel);
  slider.addEventListener('input', () => {
    begin();
    drawProgress(sliderProgress());
  });
  slider.addEventListener('change', () => {
    const resume = dragging ? wasPlaying : snapshot.status === 'playing';
    dragging = false;
    void player.seek(sliderProgress(), resume);
  });
  slider.addEventListener('pointerup', () => queueMicrotask(cancel));
  const onInteraction = (event) => {
    if (!snapshot.visible || !documentRef.body.classList.contains('mobile-shell') || root.contains(event.target)) return;
    if (event.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    player.pause();
  };
  const onKey = (event) => {
    if (!event.defaultPrevented && event.key === 'Escape' && snapshot.visible &&
        !documentRef.body.matches('[data-mobile-sheet], [data-mobile-search-open], [data-mobile-details]') &&
        !documentRef.querySelector('dialog[open]')) player.close();
  };
  const onVisibility = () => { if (documentRef.hidden) player.pause(); };
  documentRef.addEventListener('keydown', onKey);
  documentRef.addEventListener('visibilitychange', onVisibility);
  const interactions = ['pointerdown', 'click', 'wheel', 'keydown'];
  for (const event of interactions) documentRef.addEventListener(event, onInteraction, { capture: true, passive: true });
  documentRef.body.append(root);
  const unsubscribe = player.subscribe(draw);
  return { destroy() {
    unsubscribe();
    documentRef.removeEventListener('keydown', onKey);
    documentRef.removeEventListener('visibilitychange', onVisibility);
    for (const event of interactions) documentRef.removeEventListener(event, onInteraction, true);
    root.remove();
  } };
}
