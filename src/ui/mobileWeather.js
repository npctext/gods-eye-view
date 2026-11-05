import { t, formatDate, formatNumber } from '../i18n/index.js';
import { weatherCodeLabel } from '../data/regionalModel.js';

// A point forecast shares Context's mobile sheet, without enabling map layers.
export function initMobileWeather({ documentRef, load }) {
  const body = documentRef.body;
  const rail = documentRef.getElementById('right-context-rail');
  const heading = documentRef.getElementById('mobile-context-handle')?.querySelector('.mobile-sheet-title');
  const handle = documentRef.getElementById('mobile-context-handle');
  const panel = documentRef.createElement('section');
  panel.id = 'mobile-weather';
  panel.setAttribute('aria-label', t('Weather'));
  rail?.append(panel);
  let point = null;
  let request = null;
  let disposed = false;
  const make = (tag, className, text, parent = panel) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };
  const value = (number, unit, digits = 0) => Number.isFinite(number)
    ? `${formatNumber(number, { maximumFractionDigits: digits })} ${unit}` : '—';
  const shortLabel = label => t(label === 'Temperature' ? 'Temp.' : label === 'Precipitation' ? 'Precip.' : label);
  const stamp = time => formatDate(new Date(time), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const render = (payload, loading = false) => {
    panel.replaceChildren();
    panel.setAttribute('aria-busy', String(loading));
    make('p', 'mobile-weather-location', `${Math.abs(point.latitude).toFixed(4)}° ${point.latitude < 0 ? 'S' : 'N'} · ${Math.abs(point.longitude).toFixed(4)}° ${point.longitude < 0 ? 'W' : 'E'}`);
    const weather = payload?.weather;
    const status = make('p', 'mobile-weather-status', t(loading ? 'Loading…' : weather ? weatherCodeLabel(weather.weatherCode) : 'Weather unavailable'));
    status.setAttribute('role', 'status');
    if (loading) {
      status.classList.add('is-loading');
      return;
    }
    if (weather) {
      const metrics = make('dl', 'mobile-weather-metrics');
      for (const [label, amount] of [
        ['Temperature', value(weather.temperatureC, '°C')],
        ['Wind', value(weather.windKph, t('km/h'))],
        ['Precipitation', value(weather.precipitationMm, t('mm'), 1)],
      ]) {
        const metric = make('div', 'mobile-weather-metric', undefined, metrics);
        make('dt', '', shortLabel(label), metric).setAttribute('aria-label', t(label));
        make('dd', '', amount, metric);
      }
      if (weather.observedAt) make('p', 'mobile-weather-meta', stamp(weather.observedAt) + ' UTC');
      if (payload.status === 'stale') make('p', 'mobile-weather-stale', t('Cached forecast · stale'));
      const forecast = (weather.forecast || []).filter(row => Date.parse(row.time) >= Math.floor(Date.now() / 3600000) * 3600000).filter((_, index) => index % 3 === 0);
      if (forecast.length) {
        make('h3', 'mobile-weather-heading', t('Forecast') + ' · UTC');
        const table = make('table', 'mobile-weather-forecast');
        const head = make('thead', '', undefined, table);
        const labels = make('tr', '', undefined, head);
        for (const label of ['Time', 'Temperature', 'Wind', 'Precipitation']) {
          const cell = make('th', '', shortLabel(label), labels);
          cell.setAttribute('scope', 'col');
          cell.setAttribute('aria-label', t(label));
        }
        const rows = make('tbody', '', undefined, table);
        for (const entry of forecast) {
          const row = make('tr', '', undefined, rows);
          const time = make('time', '', stamp(entry.time), make('td', '', undefined, row));
          time.dateTime = entry.time;
          make('td', '', value(entry.temperatureC, '°C'), row);
          make('td', '', value(entry.windKph, t('km/h')), row);
          make('td', '', value(entry.precipitationMm, t('mm'), 1), row);
        }
      }
      const credit = make('a', 'mobile-weather-credit', t('Weather data by Open-Meteo.com'));
      credit.href = 'https://open-meteo.com/';
      credit.target = '_blank';
      credit.rel = 'noopener';
    } else {
      const retry = make('button', 'mobile-weather-retry', t('Retry'));
      retry.type = 'button';
      retry.addEventListener('click', refresh);
    }
  };
  async function refresh() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    render(null, true);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await load(point, { signal: controller.signal });
      if (!disposed && request === controller) render(result);
    } catch {
      if (!disposed && request === controller) render(null);
    } finally {
      clearTimeout(timer);
      if (request === controller) request = null;
    }
  }
  function close() {
    request?.abort();
    request = null;
    body.removeAttribute('data-mobile-context-weather');
    if (heading) heading.textContent = t('Context');
    handle?.setAttribute('aria-label', t('Collapse') + ': ' + t('Context'));
  }
  return {
    open(view) {
      if (disposed || ![view?.latitude, view?.longitude].every(Number.isFinite)) return;
      point = { latitude: view.latitude, longitude: view.longitude };
      body.setAttribute('data-mobile-context-weather', '');
      if (heading) heading.textContent = t('Weather');
      handle?.setAttribute('aria-label', t('Collapse') + ': ' + t('Weather'));
      if (rail) rail.scrollTop = 0;
      panel.scrollTop = 0;
      void refresh();
    },
    close,
    destroy() { disposed = true; close(); panel.remove(); },
  };
}
