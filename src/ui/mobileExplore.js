import { t } from '../i18n/index.js';

const PROMOS = [
  ['bhote-koshi-nepal-scene', 'nepal-flood', true],
  ['flights-radar', 'global-flights'],
  ['orbital-watch', 'orbital-watch'],
  ['city-overload', 'city-overload'],
  ['omniscience-pullback', 'omniscience'],
];

const ICONS = {
  contacts: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.5"/><path d="m13.8 13.8 5 5"/>',
  cameras: '/icons/mobile-nav-cameras.svg',
  weather: '<path d="M7 16H5a4 4 0 1 1 1-7.9A5 5 0 0 1 16 10h1a3 3 0 0 1 0 6h-2M9 18l-1 3m5-3-1 3"/><path d="M17 2v2m4 2-1.4 1.4M22 11h-2M12.5 3.5l1 1"/>',
  radio: '<circle cx="12" cy="8" r="1.5"/><path d="m12 10-4 11m4-11 4 11M9.5 17h5M6.3 3a7 7 0 0 0 0 10M17.7 3a7 7 0 0 1 0 10M9 5.5a3.5 3.5 0 0 0 0 5M15 5.5a3.5 3.5 0 0 1 0 5"/>',
  places: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
};

// Presentation only: navigation and geocoding stay with the existing controllers.
export function initMobileExplore({ documentRef, searchBar, searchInput, cities, onNavigate, onQuickAction, onCurrentView, readView }) {
  const make = (tag, className, parent, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };
  const removers = [];
  const listen = (node, handler) => {
    node.addEventListener('click', handler);
    removers.push(() => node.removeEventListener('click', handler));
  };
  const icon = (name, parent) => {
    const node = make('span', 'mobile-explore-icon', parent);
    node.setAttribute('aria-hidden', 'true');
    if (ICONS[name].startsWith('/')) node.style.setProperty('--explore-icon', `url('${ICONS[name]}')`);
    else node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  };
  const button = (parent, className, label, handler) => {
    const node = make('button', className, parent, label);
    node.type = 'button';
    listen(node, handler);
    return node;
  };
  const header = make('div', 'mobile-explore-header', searchBar);
  const title = make('h1', 'mobile-explore-title', header, t('Explore'));
  title.id = 'mobile-explore-title';
  const content = make('div', 'mobile-explore-content', searchBar);
  let pressed = null;
  let pressTimer = null;
  const clearPress = () => { pressed?.removeAttribute('data-explore-pressed'); pressed = null; };
  const onPress = (event) => {
    clearTimeout(pressTimer);
    clearPress();
    pressed = event.target.closest?.('button');
    pressed?.setAttribute('data-explore-pressed', '');
  };
  const onRelease = () => { pressTimer = setTimeout(clearPress, 120); };
  for (const [type, handler] of [['pointerdown', onPress], ['pointerup', onRelease], ['pointercancel', clearPress], ['pointerleave', clearPress]]) {
    content.addEventListener(type, handler);
    removers.push(() => content.removeEventListener(type, handler));
  }
  const query = make('div', 'mobile-explore-query', content);
  query.hidden = true;
  make('p', 'mobile-explore-caption', query, t('Search for a place, address or coordinates.'));
  const submit = button(query, 'mobile-explore-submit', t('Search on map'), () => {
    if (!searchInput?.value.trim()) return;
    const KeyEvent = documentRef.defaultView?.KeyboardEvent ?? globalThis.KeyboardEvent;
    searchInput.dispatchEvent(new KeyEvent('keydown', { key: 'Enter', bubbles: true }));
    searchInput.blur();
  });
  const browse = make('div', 'mobile-explore-browse', content);
  const promo = make('section', 'mobile-explore-promo-section', browse);
  const promoHeading = make('div', 'mobile-explore-promo-heading', promo);
  make('h2', 'mobile-explore-heading', promoHeading, t('World events')).id = 'mobile-explore-events-title';
  const viewAll = button(promoHeading, 'mobile-explore-promo-all', t('View all'), () => onNavigate('scenes'));
  make('span', 'mobile-explore-chevron', viewAll, '›').setAttribute('aria-hidden', 'true');
  const promoHost = make('div', 'mobile-explore-promo-host', promo);
  const promoStrip = make('div', 'mobile-explore-promo-strip', promoHost);
  promoStrip.setAttribute('role', 'group');
  promoStrip.setAttribute('aria-labelledby', 'mobile-explore-events-title');
  const promoCards = PROMOS.map(([id, artwork, archive]) => {
    const card = button(promoStrip, 'mobile-explore-promo', undefined, () => onNavigate('scenes', id));
    card.dataset.exploreScene = id;
    card.hidden = true;
    const image = make('img', 'mobile-explore-promo-image', card);
    image.src = '/images/world-events/' + artwork + '.webp';
    image.alt = '';
    image.width = 720;
    image.height = 480;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = false;
    if (archive) make('span', 'mobile-explore-promo-archive', card, t('Archive'));
    const caption = make('span', 'mobile-explore-promo-caption', card);
    const name = make('strong', 'mobile-explore-promo-name', caption);
    make('span', 'mobile-explore-chevron', caption, '›').setAttribute('aria-hidden', 'true');
    return { id, card, name };
  });

  const area = make('section', 'mobile-explore-section', browse);
  make('h2', 'mobile-explore-heading', area, t('Current map view'));
  let currentView = null;
  const areaCard = button(area, 'mobile-explore-area', undefined, () => onCurrentView?.(currentView));
  icon('places', areaCard);
  const areaInfo = make('span', 'mobile-explore-area-info', areaCard);
  const coordinates = make('span', 'mobile-explore-coordinates', areaInfo);
  const active = make('span', 'mobile-explore-meta', areaInfo);
  make('span', 'mobile-explore-chevron', areaCard, '›').setAttribute('aria-hidden', 'true');

  const quickHost = make('div', 'mobile-explore-quick-host', area);
  const quickActions = make('div', 'mobile-explore-quick-actions', quickHost);
  quickActions.setAttribute('role', 'group');
  quickActions.setAttribute('aria-label', t('Current map view'));
  for (const [action, label] of [['contacts', t('CONTACTS')], ['cameras', t('Cameras')], ['weather', t('Weather')]]) {
    const item = button(quickActions, 'mobile-explore-quick-action', undefined, () => onQuickAction?.(action, currentView));
    item.dataset.exploreAction = action;
    icon(action, item);
    make('span', 'mobile-explore-quick-label', item, label);
  }

  const radio = make('section', 'mobile-explore-section', browse);
  const radioCard = button(radio, 'mobile-explore-radio', undefined, () => onQuickAction?.('radio', currentView));
  radioCard.dataset.exploreAction = 'radio';
  icon('radio', radioCard);
  const radioLabel = make('span', 'mobile-explore-radio-label', radioCard);
  make('span', '', radioLabel, t('Radio'));
  const radioMeta = make('span', 'mobile-explore-meta mobile-explore-radio-meta', radioLabel);
  const radioStation = make('span', 'mobile-explore-radio-station', radioMeta);
  radioStation.hidden = true;
  const radioStatus = make('span', 'mobile-explore-radio-status', radioMeta, t('Radio off'));
  make('span', 'mobile-explore-chevron', radioCard, '›').setAttribute('aria-hidden', 'true');

  const places = make('section', 'mobile-explore-section', browse);
  make('h2', 'mobile-explore-heading', places, t('Quick locations'));
  const citiesHost = make('div', 'mobile-explore-cities', places);
  const citiesHome = cities?.parentElement;
  const citiesNext = cities?.nextSibling;

  const placeholder = searchInput?.getAttribute('placeholder');
  const enterHint = searchInput?.getAttribute('enterkeyhint');
  const setMobile = (mobile) => {
    const parent = mobile ? citiesHost : citiesHome;
    if (cities && parent && cities.parentElement !== parent) {
      if (mobile) parent.append(cities);
      else parent.insertBefore(cities, citiesNext);
    }
    if (!searchInput) return;
    for (const [name, value] of [
      ['placeholder', mobile ? t('Search places or coordinates') : placeholder],
      ['enterkeyhint', mobile ? 'search' : enterHint],
    ]) {
      if (value === null) searchInput.removeAttribute(name);
      else searchInput.setAttribute(name, value);
    }
  };
  const updateQuery = () => {
    const hasQuery = Boolean(searchInput?.value?.trim());
    query.hidden = !hasQuery;
    browse.hidden = hasQuery;
    submit.disabled = searchInput?.classList.contains('searching') ?? false;
    submit.textContent = t(submit.disabled ? 'Searching…' : 'Search on map');
  };
  const Observer = documentRef.defaultView?.MutationObserver;
  const observer = searchInput && Observer ? new Observer(updateQuery) : null;
  observer?.observe(searchInput, { attributes: true, attributeFilter: ['class'] });
  return {
    header, content, citiesHost, promoHost, promoStrip, quickHost, quickActions, setMobile, updateQuery,
    updateRadio(state) {
      const enabled = Boolean(state?.enabled);
      const name = enabled ? state.selected?.name || '' : '';
      radioStation.textContent = name;
      radioStation.hidden = !name;
      radioStation.title = name;
      const playing = state?.voiceDucked ? t('Muted for voice') : state?.voiceRestoring ? t('Restoring volume…') : t('Playing');
      const labels = { playing, paused: t('Paused'), loading: t('Connecting…'), buffering: t('Buffering…'), error: t('Playback error') };
      radioStatus.textContent = !enabled ? t('Radio off') : labels[state.audioState] ||
        (state.error ? t('Stations unavailable') : state.loading ? t('Loading stations…') : t('Ready'));
    },
    refresh() {
      const scenes = new Map(Array.from(documentRef.getElementById('scene-select')?.options || [], option => [option.value, option.textContent]));
      for (const { id, card, name } of promoCards) {
        card.hidden = !scenes.has(id);
        name.textContent = scenes.get(id) || '';
      }
      promo.hidden = promoCards.every(({ card }) => card.hidden);
      promoStrip.scrollLeft = 0;
      const view = readView?.() || {};
      currentView = { ...view };
      const { latitude, longitude } = view;
      areaCard.disabled = !Number.isFinite(latitude) || !Number.isFinite(longitude);
      quickActions.querySelector('[data-explore-action="weather"]').disabled = areaCard.disabled;
      coordinates.textContent = Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? 'S' : 'N'} · ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? 'W' : 'E'}`
        : t('No ground in view');
      active.textContent = t('Active layers: {count}', { count: view.activeLayers ?? 0 });
      content.scrollTop = 0;
      updateQuery();
    },
    destroy() {
      clearTimeout(pressTimer);
      observer?.disconnect();
      for (const remove of removers) remove();
      setMobile(false);
      header.remove();
      content.remove();
    },
  };
}
