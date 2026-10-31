import { sampleCameraMove } from '../director/camera.js';

/** Own one authored camera animation and settle it immediately on cancellation or replacement. */
export function createCameraMotion({
  applyPose,
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
} = {}) {
  let active = null;
  let disposed = false;
  const cancel = () => active?.finish(false);
  return {
    get active() {
      return active !== null;
    },
    cancel,
    pause() {
      active?.pause();
    },
    resume() {
      active?.resume();
    },
    destroy() {
      disposed = true;
      cancel();
    },
    play(move, token, startProgress = 0) {
      cancel();
      if (disposed || token?.cancelled || token?.signal?.aborted)
        return Promise.resolve(false);
      if (!Number.isFinite(move.durationSec) || move.durationSec <= 0)
        throw new RangeError('Camera move duration must be positive');
      return new Promise((resolve, reject) => {
        const run = { handle: null, finish: null };
        let startedAt = now() - startProgress * move.durationSec * 1000;
        let pausedAt = null;
        run.pause = () => {
          if (pausedAt !== null) return;
          pausedAt = now();
          if (run.handle !== null) cancelFrame(run.handle);
          run.handle = null;
        };
        run.resume = () => {
          if (pausedAt === null || active !== run) return;
          startedAt += now() - pausedAt;
          pausedAt = null;
          tick();
        };
        const onAbort = () => run.finish(false);
        run.finish = (completed, error) => {
          if (active !== run) return;
          active = null;
          if (run.handle !== null) cancelFrame(run.handle);
          token?.signal?.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve(completed);
        };
        active = run;
        token?.signal?.addEventListener('abort', onAbort, { once: true });
        const tick = () => {
          if (active !== run) return;
          if (token?.paused) { run.pause(); return; }
          run.handle = null;
          if (disposed || token?.cancelled || token?.signal?.aborted) {
            run.finish(false);
            return;
          }
          try {
            const progress = Math.min(
              1,
              Math.max(0, (now() - startedAt) / (move.durationSec * 1000)),
            );
            if (applyPose(sampleCameraMove(move, progress)) === false) {
              run.finish(false);
              return;
            }
            // Applying a pose can synchronously transfer camera ownership.
            if (active !== run) return;
            if (progress >= 1) run.finish(true);
            else run.handle = requestFrame(tick);
          } catch (error) {
            run.finish(false, error);
          }
        };
        tick();
      });
    },
  };
}
