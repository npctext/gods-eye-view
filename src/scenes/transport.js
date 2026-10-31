import { displaySceneTitle, displayShotTitle } from './recipes.js';

/** One mobile playback session; all timing and camera work stays in the Director. */
export function createSceneTransport(director) {
  let state = { visible: false, status: 'idle', progress: 0, elapsed: 0, duration: 0, shots: [], index: 0 };
  let generation = 0;
  let disposed = false;
  let resumeRequested = false;
  const listeners = new Set();
  const read = () => {
    const scenes = director._project.scenes;
    const index = scenes.findIndex(({ id }) => id === state.sceneId);
    const nextScene = index >= 0 ? scenes.slice(index + 1).find((scene) => scene.shots.length) : null;
    return { ...state, nextSceneId: nextScene?.id || null, shots: state.shots.map((shot) => ({ ...shot })) };
  };
  const publish = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(read());
  };
  const unsubscribe = director.subscribeSceneClock((clock) => {
    if (!state.visible || clock.sceneId !== state.sceneId) return;
    publish({
      progress: clock.sceneProgress, elapsed: clock.sceneElapsedSec,
      duration: clock.sceneDurationSec, index: clock.shotIndex,
      ...(state.status === 'loading' && clock.running ? { status: 'playing' } : {}),
      ...(state.status === 'playing' && !clock.running ? { status: 'paused' } : {}),
      ...(state.status === 'paused' && clock.running ? { status: 'playing' } : {}),
    });
  });
  const play = (fromProgress = null) => {
    resumeRequested = true;
    const current = ++generation;
    publish({ status: 'loading', error: '' });
    const run = director.startScene(state.sceneId, { single: true, preview: false, fromProgress });
    Promise.resolve(run).then((result) => {
      if (disposed || current !== generation || !state.visible) return;
      if (!result?.started) publish({ status: 'error', error: result?.reason || 'run-failed' });
      else publish({ status: state.progress >= 0.999 ? 'ended' : 'paused' });
    }).catch(() => {
      if (!disposed && current === generation) publish({ status: 'error', error: 'run-failed' });
    });
  };
  const seek = async (progress, resume = state.status === 'playing') => {
    if (!state.visible || disposed) return false;
    resumeRequested = resume;
    const current = ++generation;
    publish({ status: 'seeking', error: '' });
    try {
      const ok = await director.seekScene(state.sceneId, Math.max(0, Math.min(1, progress)));
      if (disposed || current !== generation) return false;
      if (!ok) { publish({ status: 'error', error: 'seek-failed' }); return false; }
      publish({ status: state.progress >= 0.999 ? 'ended' : 'paused' });
      if (resumeRequested && state.progress < 0.999) play(state.progress);
      return true;
    } catch {
      if (!disposed && current === generation) publish({ status: 'error', error: 'seek-failed' });
      return false;
    }
  };
  const pause = () => {
    if (!state.visible || disposed) return false;
    resumeRequested = false;
    const paused = director.pauseScene();
    if (paused && state.status === 'loading') publish({ status: 'paused' });
    return paused;
  };
  const resume = () => {
    if (!state.visible || disposed) return false;
    resumeRequested = true;
    if (state.status === 'seeking') return true;
    if (director.resumeScene()) publish({ status: 'playing' });
    else if (!director._running) {
      if (state.status === 'ended') void seek(0, true);
      else play(state.progress);
    }
    return true;
  };
  const transport = {
    getState: read,
    subscribe(listener) { listeners.add(listener); listener(read()); return () => listeners.delete(listener); },
    async open(sceneId) {
      const scene = director._project.scenes.find(({ id }) => id === sceneId);
      if (disposed || !scene?.shots.length) return false;
      const current = ++generation;
      resumeRequested = true;
      director.stopScene();
      await director._waitForRunIdle();
      if (disposed || current !== generation) return false;
      const shots = scene.shots.map((shot) => ({
        id: shot.id, title: displayShotTitle(shot.title, shot, scene),
        start: director._sceneTimingForShot(scene, shot).startProgress,
      }));
      publish({ visible: true, sceneId, title: displaySceneTitle(scene), shots, index: 0,
        progress: 0, elapsed: 0, duration: director._sceneTimingForShot(scene, scene.shots[0]).totalSec });
      const shouldPlay = resumeRequested;
      play();
      if (!shouldPlay) pause();
      return true;
    },
    toggle() {
      if (!state.visible || ['loading', 'seeking'].includes(state.status)) return;
      if (state.status === 'playing') pause();
      else resume();
    },
    pause,
    resume,
    nextScene() {
      const id = read().nextSceneId;
      return id ? transport.open(id) : Promise.resolve(false);
    },
    seek,
    adjacent(direction) {
      const shot = state.shots[state.index + direction];
      if (shot) return seek(shot.start, state.status === 'playing');
    },
    close() {
      resumeRequested = false;
      generation++;
      publish({ visible: false, status: 'idle' });
      director.stopScene();
    },
    destroy() {
      disposed = true;
      generation++;
      unsubscribe();
      listeners.clear();
    },
  };
  return transport;
}
