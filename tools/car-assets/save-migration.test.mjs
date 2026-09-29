import test from 'node:test';
import assert from 'node:assert/strict';
import { Save } from '../../src/game/progression.js';

const key = 'horizon-remade-save-v1';
const pack = ['shelby', 'gt3', 'fastback'];
const stored = new Map();
globalThis.localStorage = {
  getItem: name => stored.get(name) ?? null,
  setItem: (name, value) => stored.set(name, value),
};

test('new drivers receive the new cars with the Ferrari still selected', () => {
  stored.clear();
  const save = new Save();
  assert.equal(save.currentCar.id, 'gt');
  for (const id of pack) assert.equal(save.data.garage.filter(car => car.id === id).length, 1);
});

test('existing progress and custom paint survive a one-time car grant', () => {
  const old = new Save().defaults();
  delete old.contentPacks;
  old.garage = [
    { id: 'hatch', paint: { color: '#abcdef', finish: 'matte' } },
    { id: 'gt3', paint: { color: '#fedcba', finish: 'pearl' } },
  ];
  Object.assign(old, { current: 1, credits: 123456, xp: 1444, level: 7, name: 'Driver', records: { speedTrap: 248 }, firstRun: false });
  stored.set(key, JSON.stringify(old));
  const save = new Save();
  for (const field of ['current', 'credits', 'xp', 'level', 'name', 'records', 'raceRecords', 'boards', 'stats', 'settings', 'firstRun']) assert.deepEqual(save.data[field], old[field]);
  assert.deepEqual(save.data.garage.slice(0, 2), old.garage);
  assert.equal(save.currentCar.id, 'gt3');
  assert.equal(save.data.garage.length, 4);
  save.write(true);
  const reloaded = new Save();
  assert.deepEqual(reloaded.data, save.data);
});

test('a car sold after the grant is not repeatedly granted on reload', () => {
  stored.clear();
  const save = new Save();
  save.data.garage = save.data.garage.filter(car => car.id !== 'fastback');
  save.write(true);
  assert.equal(new Save().owns('fastback'), false);
});
