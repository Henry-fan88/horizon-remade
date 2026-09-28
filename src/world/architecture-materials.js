// Small, repeatable surface maps authored locally for the built environment.
// Geometry supplies the construction detail; these maps add material-scale wear.
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

function surface(kind, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const rnd = mulberry32(seed);
  const pixels = ctx.createImageData(256, 256);
  const base = kind === 'wood' ? [122, 102, 77] : kind === 'tile' ? [153, 87, 60] : kind === 'fabric' ? [232, 231, 221] : [217, 214, 205];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    let variation = (rnd() - .5) * (kind === 'plaster' ? 26 : 13);
    if (kind === 'wood') variation += Math.sin(x * .43 + Math.sin(y * .021) * 1.8) * 8;
    if (kind === 'fabric') variation += (x % 3 === 0 ? -8 : 0) + (y % 3 === 0 ? -7 : 0);
    for (let c = 0; c < 3; c++) pixels.data[i + c] = base[c] + variation;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  if (kind === 'tile') {
    // Overlapping barrel tile courses; roughly 28 cm long at their roof UV scale.
    for (let row = -1; row < 8; row++) for (let col = -1; col < 16; col++) {
      const x = col * 18 + (row % 2) * 9, y = row * 36;
      const gradient = ctx.createLinearGradient(x, 0, x + 18, 0);
      gradient.addColorStop(0, 'rgba(42,20,12,.4)');
      gradient.addColorStop(.4, 'rgba(230,165,113,.3)');
      gradient.addColorStop(1, 'rgba(72,31,20,.25)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, 18, 36);
      ctx.strokeStyle = 'rgba(46,23,15,.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y + 35); ctx.quadraticCurveTo(x + 9, y + 39, x + 18, y + 35); ctx.stroke();
    }
  }
  if (kind === 'wood') {
    ctx.strokeStyle = 'rgba(25,22,16,.38)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 256; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const bump = map.clone();
  bump.colorSpace = THREE.NoColorSpace;
  return { map, bumpMap: bump };
}

export function makeArchitecturalMaterials() {
  const plaster = surface('plaster', 912);
  const fabric = surface('fabric', 418);
  const tile = surface('tile', 206);
  const timber = surface('wood', 531);
  return {
    plaster: new THREE.MeshStandardMaterial({ ...plaster, color: 0xffffff, roughness: .92, bumpScale: .012 }),
    fabric: new THREE.MeshStandardMaterial({ ...fabric, color: 0xf6f3e8, roughness: .93, bumpScale: .007, side: THREE.DoubleSide }),
    tile: new THREE.MeshStandardMaterial({ ...tile, color: 0xffffff, roughness: .87, bumpScale: .027 }),
    wood: new THREE.MeshStandardMaterial({ ...timber, color: 0xf5e8d1, roughness: .76, bumpScale: .018 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd3cebd, roughness: .79 }),
    stone: new THREE.MeshStandardMaterial({ ...plaster, color: 0x989484, roughness: .96, bumpScale: .035 }),
    aluminum: new THREE.MeshStandardMaterial({ color: 0x9dabae, roughness: .37, metalness: .82 }),
    charcoal: new THREE.MeshStandardMaterial({ color: 0x292d2e, roughness: .66, metalness: .35 }),
    glazing: new THREE.MeshPhysicalMaterial({ color: 0x263a43, roughness: .17, metalness: .45, clearcoat: .8, clearcoatRoughness: .12 }),
    warmGlass: new THREE.MeshStandardMaterial({ color: 0x4b4d44, roughness: .26, metalness: .28, emissive: 0xffc98b, emissiveIntensity: 0 }),
    shutter: new THREE.MeshStandardMaterial({ color: 0x526861, roughness: .83 }),
  };
}
