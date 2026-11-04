import test from 'node:test';
import assert from 'node:assert/strict';
import { getSceneCategory } from './sceneCategories.js';
import { createDefaultProject, normalizeProject } from '../scenes/project.js';

const scene = (...layers) => ({ shots: layers.map(layers => ({ layers })) });

test('recognizes saved aviation, space, incident and urban layers', () => {
  for (const [layers, category] of [
    [{ flights: true }, 'AIR'],
    [{ military: { enabled: true }, 'local-adsb': true }, 'AIR'],
    [{ satellites: { enabled: true } }, 'SPACE'],
    [{ 'rocket-launches': true }, 'SPACE'],
    [{ earthquakes: true }, 'THREAT'],
    [{ 'bhote-koshi-locator': { enabled: true, params: { presentation: 'nepal-context' } } }, 'THREAT'],
    [{ 'local-firms': true, 'fire-perimeters': true }, 'THREAT'],
    [{ traffic: true, cctv: true }, 'URBAN'],
    [{ 'local-datacenters': true, transit: true }, 'URBAN'],
  ]) assert.equal(getSceneCategory(scene(layers)), category);
});

test('ignores disabled, unknown and non-boolean imported layer states', () => {
  assert.equal(getSceneCategory(scene({ flights: false, satellites: { enabled: false }, cctv: null, traffic: { enabled: 'false' }, unknown: true, 'weather-satellite': true })), null);
  assert.equal(getSceneCategory(), null);
  assert.equal(getSceneCategory({ shots: [{}] }), null);
});

test('every shot contributes at most one vote for each category', () => {
  assert.equal(getSceneCategory(scene({ flights: true, military: true, 'local-adsb': true }, { satellites: true }, { satellites: true })), 'SPACE');
});

test('ties and all-layer scenes have no arbitrary category', () => {
  assert.equal(getSceneCategory(scene({ flights: true, satellites: true, traffic: true })), null);
  assert.equal(getSceneCategory(scene({ flights: true, satellites: true, traffic: true, earthquakes: true })), null);
  assert.equal(getSceneCategory(scene({ flights: true }, { satellites: true })), null);
});

test('uses saved shot layers regardless of titles, duration or live map state', () => {
  const input = scene({ traffic: true }, { traffic: true }, { flights: true });
  input.title = 'Satellite mission';
  input.layers = { satellites: true };
  input.shots[2].durationSec = 300;
  const before = JSON.stringify(input);
  assert.equal(getSceneCategory(input), 'URBAN');
  assert.equal(JSON.stringify(input), before);
});

test('recomputes after capture, update, delete and a JSON import roundtrip', () => {
  const input = scene({ flights: true });
  assert.equal(getSceneCategory(input), 'AIR');
  input.shots.push({ layers: { satellites: true } });
  assert.equal(getSceneCategory(input), null);
  input.shots[0].layers = { satellites: { enabled: true } };
  assert.equal(getSceneCategory(JSON.parse(JSON.stringify(input))), 'SPACE');
  input.shots.splice(0);
  assert.equal(getSceneCategory(input), null);
});

test('the authored city preset stays urban after storage and title changes', () => {
  const project = normalizeProject(JSON.parse(JSON.stringify(createDefaultProject())));
  const city = project.scenes.find(item => item.id === 'city-overload');
  assert.ok(city?.shots.length);
  assert.equal(getSceneCategory(city), 'URBAN');
  assert.equal(getSceneCategory({ ...city, title: 'Перегрузка города' }), 'URBAN');
  assert.equal(getSceneCategory({ ...city, id: 'custom-city' }), null);
});
