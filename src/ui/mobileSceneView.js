import { t } from '../i18n/index.js';
import { createSceneTapFeedback } from './mobileSceneFeedback.js';
import { getSceneCategory } from './sceneCategories.js';

const SCENE_ICONS = new Map([
  ['bhote-koshi-nepal-scene', 'waves'],
  ['flights-radar', 'flight'],
  ['orbital-watch', 'satellite'],
  ['thermal-threats', 'thermal'],
  ['city-overload', 'city'],
  ['omniscience-pullback', 'overview'],
]);

export function mountMobileSceneView(controls) {
  const panel = controls.elements.panel;
  const inner = panel?.querySelector?.('.scene-panel-inner');
  if (!inner || typeof document === 'undefined') return null;
  const root = document.createElement('div');
  root.className = 'mobile-scene-view';
  inner.prepend(root);
  const tapFeedback = createSceneTapFeedback(root, panel);
  let view = 'catalog';
  let menuReturnView = 'detail';
  let tappedShot = null;
  let tappedSceneId = null;
  let shotMenuId = null;
  let transition = null;
  let viewGeneration = 0;
  let destroyed = false;
  let renderedKey = null;
  const scrollPositions = new Map();
  const button = (label, action, className = '', immediate = false) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `mobile-scene-button ${className}`;
    element.textContent = label;
    element.addEventListener('click', (event) => tapFeedback.run(event, action, immediate));
    return element;
  };
  const text = (tag, value, className = '') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  };
  const show = (next, sceneId) => {
    if (transition || next === view) return;
    const generation = ++viewGeneration;
    const update = () => {
      if (destroyed || generation !== viewGeneration) return;
      if (document.body.hasAttribute('data-mobile-scenes-lowered'))
        panel.dispatchEvent(new Event('mobile-scene-expand'));
      if (sceneId) tappedSceneId = sceneId;
      view = next;
      render();
    };
    if (!document.startViewTransition ||
        document.body.dataset.mobileSheet !== 'scenes' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update();
      return;
    }
    document.documentElement.setAttribute('data-scene-transition', '');
    transition = document.startViewTransition(update);
    transition.finished.catch(() => {}).finally(() => {
      document.documentElement.removeAttribute('data-scene-transition');
      transition = null;
    });
  };
  const tile = (label, action, icon, className = '', immediate = false) => {
    const element = button('', action, `mobile-scene-tile ${className}`, immediate);
    const symbol = document.createElement('span');
    symbol.className = 'mobile-scene-tile-icon';
    symbol.style.setProperty('--tile-icon', `url('${icon.startsWith('/') ? icon : `/scene-action-${icon}.svg`}')`);
    symbol.setAttribute('aria-hidden', 'true');
    element.append(symbol, text('span', label));
    return element;
  };
  const updatePlayback = () => {
    if (view !== 'playing') return;
    const state = controls.read();
    const progress = root.querySelector('progress');
    if (progress) progress.value = state.progress || 0;
    const runtime = root.querySelector('.mobile-scene-meta');
    if (runtime) runtime.textContent = state.runtime || state.scenes.find((item) => item.id === state.selectedSceneId)?.title || '';
  };
  const render = () => {
    tapFeedback.reset();
    if (renderedKey) scrollPositions.set(renderedKey, {
      content: root.querySelector('.mobile-scene-content')?.scrollTop || 0,
      editor: inner.scrollTop,
    });
    const state = controls.read();
    const scene = state.scenes.find((item) => item.id === state.selectedSceneId);
    if (!scene && view !== 'catalog') view = 'catalog';
    if (state.running && view !== 'edit' && view !== 'catalog') view = 'playing';
    if (!state.running && view === 'playing') view = 'detail';
    panel.dataset.mobileSceneView = view;
    root.replaceChildren();
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'mobile-details-handle';
    handle.dataset.mobileSceneHandle = '';
    handle.setAttribute('aria-label', t('Expand or collapse scenes'));
    handle.addEventListener('click', () => panel.dispatchEvent(new Event('mobile-scene-expand')));
    root.append(handle);
    const header = document.createElement('div');
    header.className = 'mobile-details-header mobile-sheet-header';
    if (view !== 'catalog') {
      const back = button('', () => show(view === 'menu' ? menuReturnView : ['detail', 'playing'].includes(view) ? 'catalog' : 'detail'), 'mobile-scene-back mobile-sheet-control mobile-sheet-back');
      back.setAttribute('aria-label', t('Back'));
      const backIcon = document.createElement('img');
      backIcon.src = '/arrow-back.svg';
      backIcon.alt = '';
      backIcon.className = 'mobile-scene-back-icon';
      back.append(backIcon);
      header.append(back);
    }
    const heading = text('h2', view === 'catalog' ? t('SCENES') : scene?.title || t('SCENES'), 'mobile-sheet-title');
    if (view === 'catalog') {
      const group = document.createElement('div');
      group.className = 'mobile-sheet-heading';
      group.append(heading, text('span', String(state.scenes.length), 'mobile-sheet-count'));
      header.append(group);
    } else header.append(heading);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mobile-details-close mobile-sheet-control mobile-sheet-close';
    close.setAttribute('aria-label', t('Close'));
    const closeIcon = document.createElement('span');
    closeIcon.className = 'mobile-sheet-close-icon';
    closeIcon.setAttribute('aria-hidden', 'true');
    close.append(closeIcon);
    close.addEventListener('click', () => panel.dispatchEvent(new Event('mobile-scene-close')));
    header.append(close);
    root.append(header);
    const divider = document.createElement('div');
    divider.className = 'mobile-details-divider';
    root.append(divider);
    const content = document.createElement('div');
    content.className = 'mobile-scene-content';
    root.append(content);
    if (view === 'catalog') {
      const actions = document.createElement('div');
      actions.className = 'mobile-scene-actions mobile-scene-catalog-actions';
      const importButton = button('', () => controls.elements.file?.click(), 'mobile-scene-import', true);
      const importIcon = document.createElement('img');
      importIcon.src = '/icons/mobile-tactical-icons/import.svg';
      importIcon.alt = '';
      importButton.append(importIcon, text('span', t('Import')));
      const newButton = button('', () => controls.createScene(), 'mobile-scene-new');
      const newIcon = document.createElement('span');
      newIcon.className = 'mobile-scene-new-icon';
      newIcon.setAttribute('aria-hidden', 'true');
      newIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M12 4v16M4 12h16"/></svg>';
      newButton.append(newIcon, text('span', t('New')));
      actions.append(importButton, newButton);
      content.append(actions);
      const list = document.createElement('div');
      list.className = 'mobile-scene-list';
      for (const [index, item] of state.scenes.entries()) {
        const card = document.createElement('div');
        const active = tappedSceneId === item.id;
        card.className = `mobile-scene-card${active ? ' is-active' : ''}`;
        const number = text('span', '#' + String(index).padStart(2, '0'), 'mobile-scene-card-number');
        number.setAttribute('aria-hidden', 'true');
        const open = button('', () => {
          tappedShot = null;
          controls.run('selectScene', item.id);
          show('detail', item.id);
        }, 'mobile-scene-card-open');
        open.setAttribute('aria-current', String(active));
        const symbol = document.createElement('span');
        symbol.className = 'mobile-scene-card-symbol';
        const icon = document.createElement('img');
        const sceneIcon = SCENE_ICONS.get(item.id) || 'generic';
        icon.src = `/scene-${sceneIcon}${active ? '-active' : ''}.svg`;
        icon.alt = '';
        symbol.append(icon);
        const details = document.createElement('span');
        details.className = 'mobile-scene-card-details';
        details.append(text('strong', item.title, 'mobile-scene-card-title'));
        if (item.location) details.append(text('span', item.location, 'mobile-scene-card-location'));
        const metadata = document.createElement('span');
        metadata.className = 'mobile-scene-card-metadata';
        const category = getSceneCategory(item);
        if (category) {
          const badge = text('span', category, 'mobile-scene-category');
          badge.dataset.category = category;
          metadata.append(badge);
        }
        metadata.append(text('span', `${item.shots.length} ${t('shots')}`, 'mobile-scene-shot-count'));
        if (item.createdAt && Number.isFinite(Date.parse(item.createdAt))) {
          const separator = document.createElement('img');
          separator.src = '/scene-separator.svg';
          separator.alt = '';
          metadata.append(separator, text('span', new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })));
        }
        details.append(metadata);
        open.append(symbol, details);
        const more = button('', () => {
          tappedShot = null;
          controls.run('selectScene', item.id);
          menuReturnView = 'catalog';
          show('menu', item.id);
        }, 'mobile-scene-card-more');
        more.setAttribute('aria-label', `${t('Scene options')}: ${item.title}`);
        const moreIcon = document.createElement('img');
        moreIcon.src = active ? '/scene-ellipsis-active.svg' : '/scene-ellipsis.svg';
        moreIcon.alt = '';
        more.append(moreIcon);
        card.append(number, open, more);
        list.append(card);
      }
      content.append(list);
    } else if (view === 'detail') {
      const meta = document.createElement('div');
      meta.className = 'mobile-scene-meta-row';
      const more = button('', () => {
        menuReturnView = 'detail';
        show('menu');
      }, 'mobile-scene-meta-more');
      more.setAttribute('aria-label', t('Scene options'));
      const moreIcon = document.createElement('img');
      moreIcon.src = '/scene-ellipsis.svg';
      moreIcon.alt = '';
      more.append(moreIcon);
      meta.append(text('p', `${scene.shots.length} ${t('shots')}`, 'mobile-scene-meta'), more);
      content.append(meta);
      const start = button(`▶ ${t('Start')}`, async () => {
        if (!controls.player) return controls.run('startSingle', scene.id);
        start.disabled = true;
        if (await controls.player.open(scene.id)) panel.dispatchEvent(new Event('mobile-scene-close'));
        else start.disabled = false;
      }, 'mobile-scene-primary');
      start.disabled = !scene.shots.length;
      content.append(start);
      content.append(text('h3', t('Shots')));
      const list = document.createElement('div');
      list.className = 'mobile-scene-list';
      scene.shots.forEach((shot, index) => {
        const card = button('', () => {
          tappedShot = { sceneId: scene.id, shotId: shot.id };
          controls.run('selectShot', shot.id);
          controls.run('load', scene.id, shot.id);
          panel.dispatchEvent(new Event('mobile-scene-shot-selected'));
        }, 'mobile-scene-shot');
        card.setAttribute('aria-current', tappedShot?.sceneId === scene.id && tappedShot?.shotId === shot.id && shot.id === state.selectedShotId ? 'true' : 'false');
        const chevron = document.createElement('img');
        chevron.className = 'mobile-scene-shot-chevron';
        chevron.src = '/shot-chevron-right.svg';
        chevron.alt = '';
        card.append(
          text('span', String(index + 1).padStart(2, '0'), 'mobile-scene-shot-number'),
          text('span', shot.displayTitle || shot.title, 'mobile-scene-shot-title'),
          chevron,
        );
        list.append(card);
      });
      content.append(list);
    } else if (view === 'menu') {
      const actions = document.createElement('div');
      actions.className = 'mobile-scene-tile-grid';
      actions.append(tile(t('Edit details'), () => show('edit'), 'edit'));
      actions.append(tile(t('Share scene'), () => controls.actions.share?.(), 'share'));
      actions.append(tile(t('Export presets'), () => controls.run('export'), 'export', '', true));
      const log = tile(t('Run log'), () => controls.run('download'), 'log', '', true);
      log.disabled = !state.hasRun;
      actions.append(log);
      const advanced = tile(t('Advanced'), () => controls.run('editDetails'), 'settings');
      advanced.disabled = !scene.shots.length;
      actions.append(advanced);
      actions.append(tile(t('Delete'), () => controls.deleteSelectedScene(), 'delete', 'mobile-scene-danger'));
      content.append(actions);
    } else if (view === 'edit') {
      content.append(text('h3', t('Scene name')));
      content.append(text('p', scene.title, 'mobile-scene-editor-name'));
      const sceneActions = document.createElement('div');
      sceneActions.className = 'mobile-scene-tile-grid mobile-scene-editor-actions';
      sceneActions.append(tile(t('Rename scene'), () => {
        const title = window.prompt(t('Scene name'), scene.title);
        if (title?.trim()) controls.run('renameScene', title);
      }, 'edit'));
      sceneActions.append(tile(t('Add shot'), () => controls.run('capture'), 'add'));
      content.append(sceneActions);
      content.append(text('p', t('Save the current map view as a new shot.'), 'mobile-scene-editor-hint'));
      content.append(text('h3', `${t('Shots')} · ${scene.shots.length}`));
      const list = document.createElement('div');
      list.className = 'mobile-scene-list';
      if (!scene.shots.length) list.append(text('p', t('No shots yet. Add a shot to save the current map view.'), 'mobile-scene-editor-hint'));
      scene.shots.forEach((shot, index) => {
        const row = document.createElement('div');
        row.className = 'mobile-scene-editor-shot';
        const open = button('', () => {
          tappedShot = { sceneId: scene.id, shotId: shot.id };
          controls.run('selectShot', shot.id);
          controls.run('load', scene.id, shot.id);
        }, 'mobile-scene-editor-shot-open');
        open.setAttribute('aria-current', String(tappedShot?.sceneId === scene.id && tappedShot?.shotId === shot.id));
        const details = document.createElement('span');
        details.className = 'mobile-scene-card-details';
        details.append(text('span', shot.displayTitle || shot.title, 'mobile-scene-shot-title'));
        details.append(text('span', `${t('Move')} ${shot.durationSec}s · ${t('Hold')} ${shot.holdSec}s`, 'mobile-scene-editor-hint'));
        open.append(text('span', String(index + 1).padStart(2, '0'), 'mobile-scene-shot-number'), details);
        const more = button('⋯', () => {
          shotMenuId = shotMenuId === shot.id ? null : shot.id;
          render();
        }, 'mobile-scene-editor-shot-more');
        more.setAttribute('aria-label', `${t('Shot options')}: ${shot.displayTitle || shot.title}`);
        more.setAttribute('aria-expanded', String(shotMenuId === shot.id));
        row.append(open, more);
        list.append(row);
        if (shotMenuId === shot.id) {
          const actions = document.createElement('div');
          actions.className = 'mobile-scene-editor-shot-actions';
          actions.append(button(t('Rename'), () => {
            const title = window.prompt(t('Shot name'), shot.displayTitle || shot.title);
            if (title?.trim()) controls.run('renameShot', scene.id, shot.id, title.trim());
          }));
          const replace = button(t('Update'), () => {
            if (!window.confirm(t('Replace this shot with the current map view?'))) return;
            controls.run('selectShot', shot.id);
            controls.run('update');
          });
          replace.setAttribute('aria-label', t('Replace with current map view'));
          actions.append(replace);
          actions.append(button(t('Delete'), () => controls.deleteShot(scene.id, shot.id), 'mobile-scene-danger'));
          list.append(actions);
        }
      });
      content.append(list);
    } else if (view === 'playing') {
      content.append(text('p', state.runtime || scene.title, 'mobile-scene-meta'));
      const progress = document.createElement('progress');
      progress.max = 1;
      progress.value = state.progress || 0;
      const actions = document.createElement('div');
      actions.className = 'mobile-scene-tile-grid mobile-scene-editor-actions mobile-scene-playback-actions';
      actions.append(tile(t('Stop'), () => {
        if (controls.player?.getState().visible) controls.player.close();
        else controls.run('stop', t('Stopped'));
      }, 'stop', 'mobile-scene-stop'));
      actions.append(tile(t('Play'), () => {
        if (controls.player?.getState().visible) {
          if (!controls.player.resume()) return;
        } else controls.run('startSingle', scene.id);
        panel.dispatchEvent(new Event('mobile-scene-close'));
      }, 'play', 'mobile-scene-resume'));
      content.append(progress, actions);
    }
    renderedKey = view === 'catalog' ? view : `${view}:${scene?.id}`;
    const savedScroll = scrollPositions.get(renderedKey);
    content.scrollTop = savedScroll?.content || 0;
    inner.scrollTop = savedScroll?.editor || 0;
  };
  const resetSelection = () => {
    viewGeneration += 1;
    transition?.skipTransition();
    transition = null;
    document.documentElement.removeAttribute('data-scene-transition');
    view = 'catalog';
    menuReturnView = 'detail';
    tappedSceneId = null;
    tappedShot = null;
    shotMenuId = null;
    renderedKey = null;
    scrollPositions.clear();
    render();
  };
  const openScene = (event) => {
    const sceneId = event.detail?.sceneId;
    if (!controls.read().scenes.some((scene) => scene.id === sceneId)) return;
    tappedShot = null;
    tappedSceneId = sceneId;
    controls.run('selectScene', sceneId);
    show('detail', sceneId);
  };
  panel.addEventListener('mobile-scene-open', openScene);
  panel.addEventListener('mobile-scenes-closed', resetSelection);
  render();
  return { render, updatePlayback, destroy: () => {
    destroyed = true;
    tapFeedback.destroy();
    panel.removeEventListener('mobile-scene-open', openScene);
    panel.removeEventListener('mobile-scenes-closed', resetSelection);
    transition?.skipTransition();
    document.documentElement.removeAttribute('data-scene-transition');
    root.remove();
  } };
}
