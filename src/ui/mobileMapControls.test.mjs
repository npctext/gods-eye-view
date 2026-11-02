import assert from 'node:assert/strict';
import test from 'node:test';
import { mapControlVisibility, sanitizeMapPins } from './mobileMapControls.js';

test('stored pins keep every available action and reject unknown actions and duplicates', () => {
  assert.deepEqual(sanitizeMapPins(['tilt', 'tilt', 'clear', 'zoom', 'share', 'globe', 'location']), ['tilt', 'zoom', 'share', 'globe', 'location']);
  assert.deepEqual(sanitizeMapPins({ zoom: true }), []);
  assert.deepEqual(sanitizeMapPins(null), []);
});

test('buttons disappear top first at the header and retrace exactly on downward drag', () => {
  const at = (top) => [0, 60, 112].map((offset) => mapControlVisibility(top + offset, 44, 72));
  assert.deepEqual(at(72), [1, 1, 1]);
  assert.deepEqual(at(28), [0, 1, 1]);
  assert.deepEqual(at(-32), [0, 0, 1]);
  assert.deepEqual(at(-84), [0, 0, 0]);
  assert.equal(mapControlVisibility(50, 44, 72), 0.5);
  const positions = [100, 80, 60, 40, 20, 0, -20, -40, -60, -80, -100];
  const upwards = positions.map(at);
  assert.deepEqual([...positions].reverse().map(at).reverse(), upwards);
  for (let i = 1; i < upwards.length; i++)
    for (let j = 0; j < 3; j++) assert.ok(upwards[i][j] <= upwards[i - 1][j]);
});
