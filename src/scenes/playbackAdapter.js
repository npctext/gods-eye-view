/** Connect the portable Director runner to the existing scene presentation. */
import { t } from '../i18n/index.js';
import { displaySceneTitle, displayShotTitle } from './recipes.js';

export function createScenePlaybackAdapter(director, defaultShotDurationSec, resumeState = null) {
  let timing;
  let travel;
  const resumed = (shot) => resumeState?.shot.id === shot.id ? resumeState : null;
  return {
    async releaseScene(scene, token) {
      const released = await director._releaseSceneLayers(scene, token);
      if (!token || released) director._loadedSceneId = null;
      return released;
    },
    selectShot({ scene, shot, index, total }) {
      director._selectedSceneId = scene.id;
      director._selectedShotId = shot.id;
      director._renderSceneSelect();
      director._renderShotList();
      director._updateStatus(
        t('Running {index}/{total}: {scene} / {shot}', {
          index: index + 1,
          total,
          scene: displaySceneTitle(scene),
          shot: displayShotTitle(shot.title, shot, scene),
        }),
      );
      director._logEvent('shot_start', {
        sceneId: scene.id,
        shotId: shot.id,
        title: shot.title,
        index,
      });
    },
    applyVisual({ shot, token }) {
      return director.styleManager.applyVisualState(
        director._visualStateForShot(shot),
        { isCurrent: () => !token.cancelled && !token.signal?.aborted },
      );
    },
    async applyLayers({ scene, shot, token }) {
      director._setSceneMediaPlayback(scene, shot, token);
      const result = await director._applyLayerStates(
        director._layerStatesForShot(scene, shot, {
          sceneSeek: resumed(shot) ? { ...resumed(shot), running: true } : null,
          cameraSettled: (resumed(shot)?.cameraProgress ?? 0) >= 1,
        }),
        token,
      );
      if (
        !token.cancelled &&
        !result.refused.length &&
        !(await director._applyDataPacks(scene, shot, token))
      )
        throw new Error('Data packs unavailable');
      return result;
    },
    travel({ scene, shot, token }) {
      director._loadedSceneId = scene.id;
      const duration = shot.durationSec || defaultShotDurationSec;
      const seek = resumed(shot);
      timing = director._clock.startScene(scene, shot, token, seek?.shotElapsedSec || 0);
      if (seek?.cameraProgress >= 1) { travel = null; return; }
      travel = director._beginShotTravel(scene, shot, duration * (1 - (seek?.cameraProgress || 0)));
      const flight = director._flyShotCamera(scene, shot, duration, token, seek?.cameraProgress || 0);
      director._publishShotTravel(scene, shot, travel);
      return flight;
    },
    settle({ scene, shot, token }) {
      director._settleShotLayerStates(scene, shot, token, travel, resumed(shot) ? { ...resumed(shot), running: true } : null);
    },
    hold({ scene, shot, token }) {
      return director._holdShot(scene, shot, token, resumed(shot)?.holdElapsedSec || 0);
    },
    completeShot({ scene, shot, index }) {
      director._clock.stopSceneTimer();
      director._publishSceneClock(scene, shot, timing.endElapsedSec, {
        running: true,
      });
      director._logEvent('shot_end', {
        sceneId: scene.id,
        shotId: shot.id,
        index,
      });
    },
    complete() {
      director._setProgress(1);
      director._updateStatus(t('Scene run complete'));
      director._logEvent('scene_run_complete', {});
    },
  };
}
