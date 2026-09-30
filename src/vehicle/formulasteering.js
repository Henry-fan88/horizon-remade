// Supplemental race steering wheel for source artwork with an empty cockpit.
// Local +Z points at the driver, matching Vehicle.syncVisual's steering animation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildFormulaSteering(style) {
  const group = new THREE.Group(), steeringWheel = new THREE.Group();
  group.name = 'supplemental race steering wheel';
  group.position.fromArray(style.cockpit.formulaWheel);
  group.rotation.y = Math.PI;
  group.add(steeringWheel);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: .67, metalness: .15 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x090b0d, roughness: .95 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x152b28, emissive: 0x23423b, emissiveIntensity: .6, roughness: .25 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd52031, roughness: .4 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffc32a, roughness: .4 });
  const meshes = [];
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    steeringWheel.add(m); meshes.push(m); return m;
  };
  add(new THREE.BoxGeometry(.23, .105, .025), carbon, 0, -.012, 0);
  add(new THREE.BoxGeometry(.09, .054, .008), screen, 0, .005, .018);
  for (const side of [-1, 1]) {
    const grip = add(new THREE.CapsuleGeometry(.023, .065, 5, 10), rubber, side*.12, -.009, .009);
    grip.rotation.z = side*-.16;
    add(new THREE.BoxGeometry(.035, .095, .005), carbon, side*.093, -.01, -.03);
    for (let i=0; i<3; i++) add(new THREE.CylinderGeometry(.007,.007,.008,10).rotateX(Math.PI/2), i%2 ? yellow : red, side*(.068+i*.015), -.015 + i*.018, .023);
  }
  for (let i=0;i<8;i++) add(new THREE.SphereGeometry(.0035,6,4), i<5 ? yellow : red, (i-3.5)*.012,.039,.02);
  // Batch the small controls into five draws for AI cars as well as the player's car.
  const byMaterial = new Map();
  for (const mesh of meshes) {
    mesh.updateMatrix();
    mesh.geometry.applyMatrix4(mesh.matrix);
    if (!byMaterial.has(mesh.material)) byMaterial.set(mesh.material, []);
    byMaterial.get(mesh.material).push(mesh.geometry);
    steeringWheel.remove(mesh);
  }
  meshes.length = 0;
  for (const [material, geometries] of byMaterial) {
    const geometry = mergeGeometries(geometries);
    for (const original of geometries) original.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    steeringWheel.add(mesh); meshes.push(mesh);
  }
  return { group, steeringWheel, dispose() {
    for (const m of meshes) m.geometry.dispose();
    for (const m of [carbon,rubber,screen,red,yellow]) m.dispose();
  } };
}
