import test from 'node:test';
import assert from 'node:assert/strict';
import { Save } from '../../src/game/progression.js';

const key = 'horizon-remade-save-v1';
const pack = ['shelby', 'gt3', 'fastback', 'f1', 'sf23', 'rb19'];
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
    { id: 'gt', paint: { color: '#abcdef', finish: 'matte' } },
    { id: 'gt3', paint: { color: '#fedcba', finish: 'pearl' } },
  ];
  Object.assign(old, { current: 1, credits: 123456, xp: 1444, level: 7, name: 'Driver', records: { speedTrap: 248 }, firstRun: false });
  stored.set(key, JSON.stringify(old));
  const save = new Save();
  for (const field of ['current', 'credits', 'xp', 'level', 'name', 'records', 'raceRecords', 'boards', 'stats', 'settings', 'firstRun']) assert.deepEqual(save.data[field], old[field]);
  assert.deepEqual(save.data.garage.slice(0, 2), old.garage);
  assert.equal(save.currentCar.id, 'gt3');
  assert.equal(save.data.garage.length, 7);
  save.write(true);
  const reloaded = new Save();
  assert.deepEqual(reloaded.data, save.data);
});

test('retired fictional cars leave the garage and the selection follows the driven car', () => {
  const old = new Save().defaults();
  old.garage = [
    { id: 'hatch', paint: { color: '#abcdef', finish: 'matte' } },
    { id: 'shelby', paint: { color: '#123456', finish: 'gloss' } },
    { id: 'rally', paint: { color: '#654321', finish: 'gloss' } },
  ];
  old.current = 1;
  stored.set(key, JSON.stringify(old));
  const save = new Save();
  assert.deepEqual(save.data.garage.map(car => car.id), ['shelby']);
  assert.equal(save.currentCar.id, 'shelby');
  assert.equal(save.currentCar.paint.color, '#123456');
  old.current = 0;
  stored.set(key, JSON.stringify(old));
  assert.equal(new Save().currentCar.id, 'shelby');
});

test('a car sold after the grant is not repeatedly granted on reload', () => {
  stored.clear();
  const save = new Save();
  save.data.garage = save.data.garage.filter(car => car.id !== 'fastback');
  save.write(true);
  assert.equal(new Save().owns('fastback'), false);
});

test('a save from before the F1 receives it once and keeps its selection', () => {
  const old = new Save().defaults();
  old.contentPacks = ['real-cars-1'];
  old.garage = old.garage.filter(car => car.id !== 'f1');
  old.current = 2;
  stored.set(key, JSON.stringify(old));
  const save = new Save();
  assert.equal(save.currentCar.id, old.garage[2].id);
  assert.equal(save.data.garage.filter(car => car.id === 'f1').length, 1);
  assert.deepEqual(save.data.contentPacks, ['real-cars-1', 'formula-1', 'modern-formula-2023']);
  save.write(true);
  assert.equal(new Save().data.garage.filter(car => car.id === 'f1').length, 1);
});


test('the classic F1 save becomes the modern McLaren without losing progress or selection', () => {
  const old = new Save().defaults();
  old.contentPacks = ['real-cars-1', 'formula-1'];
  old.garage = [{ id: 'gt', paint: { color: '#abcdef' } }, { id: 'f1', paint: { color: '#f4f4f2', finish: 'gloss' } }];
  Object.assign(old, { current: 1, credits: 765432, xp: 4321, records: { speedTrap: 302 }, raceRecords: { circuit: 89 } });
  stored.set(key, JSON.stringify(old));
  const save = new Save();
  assert.equal(save.currentCar.id, 'f1');
  assert.deepEqual(save.data.garage.slice(0, 2), old.garage);
  assert.deepEqual(save.data.garage.map(car => car.id), ['gt', 'f1', 'sf23', 'rb19']);
  for (const key of ['credits', 'xp', 'records', 'raceRecords']) assert.deepEqual(save.data[key], old[key]);
  save.write(true);
  assert.deepEqual(new Save().data, save.data);
  save.data.garage = save.data.garage.filter(car => car.id !== 'rb19');
  save.write(true);
  assert.equal(new Save().owns('rb19'), false);
});
