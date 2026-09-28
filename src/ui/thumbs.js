// Studio renders of cars for menus (separate small WebGL renderer, cached as data URLs).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCar } from '../vehicle/carmodel.js';

let renderer = null,
  scene = null,
  camera = null,
  envTex = null;
const cache = new Map();

function init() {
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(480, 270, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  envTex = pm.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffd0e8, 0.8);
  fill.position.set(-5, 2, -4);
  scene.add(fill);
  camera = new THREE.PerspectiveCamera(30, 480 / 270, 0.1, 100);
}

export function carThumb(spec, paint = {}) {
  const key = `${spec.id}|${paint.color || spec.color}|${paint.finish || 'gloss'}|${paint.rim || ''}`;
  if (cache.has(key)) return cache.get(key);
  if (!renderer) init();
  const car = buildCar(spec.style, { color: spec.color, ...paint });
  scene.add(car.group);
  const L = spec.style.L;
  camera.position.set(L * 0.95, L * 0.42, L * 1.2);
  camera.lookAt(0, spec.style.H * 0.42, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(car.group);
  car.dispose();
  car.paintMat.dispose();
  cache.set(key, url);
  return url;
}
