// Fixed category codes match the scene badges; they are not translated labels.
const LAYER_CATEGORIES = new Map([
  ...['flights', 'military', 'local-adsb'].map(id => [id, 'AIR']),
  ...['satellites', 'rocket-launches'].map(id => [id, 'SPACE']),
  ...['earthquakes', 'fire-perimeters', 'local-firms', 'weather-lightning', 'weather-cyclones', 'bhote-koshi-2026', 'bhote-koshi-locator'].map(id => [id, 'THREAT']),
  ...['traffic', 'cctv', 'street-level', 'transit', 'bikeshare', 'alpr', 'local-datacenters', 'local-dams'].map(id => [id, 'URBAN']),
]);

/** Prefer authored scene intent; otherwise each shot votes once per category. */
export function getSceneCategory(scene) {
  if (scene?.id === 'city-overload') return 'URBAN';
  const counts = new Map();
  for (const shot of scene?.shots || []) {
    const categories = new Set();
    for (const [id, state] of Object.entries(shot.layers || {})) {
      const category = LAYER_CATEGORIES.get(id);
      if (category && (state === true || state?.enabled === true)) categories.add(category);
    }
    for (const category of categories) counts.set(category, (counts.get(category) || 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return ranked.length && ranked[0][1] !== ranked[1]?.[1] ? ranked[0][0] : null;
}
