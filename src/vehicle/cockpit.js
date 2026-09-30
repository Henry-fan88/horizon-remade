// In-car (cockpit) view support: fitting a steering wheel's pivot, the cabin built for the
// classic Fastback (its model has no interior), and the interior render state of a car.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Fit a ring (steering-wheel rim) to vertex positions: centre, unit axis (the smallest
// principal direction, oriented towards `toward`), and mean radius.
export function fitRing(positions, toward = new THREE.Vector3(0, 0.3, -1)) {
  const n = positions.length / 3;
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) c.x += positions[i * 3], c.y += positions[i * 3 + 1], c.z += positions[i * 3 + 2];
  c.divideScalar(Math.max(1, n));
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] - c.x, y = positions[i * 3 + 1] - c.y, z = positions[i * 3 + 2] - c.z;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  // inverse power iteration: the ring's normal has the smallest spread
  const inv = new THREE.Matrix3().set(xx, xy, xz, xy, yy, yz, xz, yz, zz).invert();
  const axis = toward.clone().normalize();
  for (let k = 0; k < 40; k++) axis.applyMatrix3(inv).normalize();
  if (axis.dot(toward) < 0) axis.negate();
  // centre: middle of the extremes along two in-plane directions (robust to spokes)
  const u = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromArray(positions, i * 3).sub(c);
    const a = p.dot(u), b = p.dot(v);
    u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b);
  }
  const center = c.clone().addScaledVector(u, (u0 + u1) / 2).addScaledVector(v, (v0 + v1) / 2);
  return { center, axis, radius: (u1 - u0 + v1 - v0) / 4 };
}

// Frame whose +Z is the column axis (towards the driver) and +Y points up the rim.
export function steeringFrame(center, axis) {
  const z = axis.clone().normalize();
  const y = new THREE.Vector3(0, 1, 0).addScaledVector(z, -z.y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(center);
}

// ------------------------------------------------------------------ interior render state
// Seen from the driver's seat, the painted shell's inside faces must render (as dark trim,
// not paint) and the glass must be clear. Materials are per car, so this only touches the
// player's car. Programs are cached, so toggling costs one compile the first time.
export function installInsideShading(material, inside = 0x141517) {
  if (material.userData.insideShading) return;
  material.userData.insideShading = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const color = new THREE.Color(inside);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.insideColor = { value: color };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 insideColor;')
      .replace('#include <emissivemap_fragment>', `if ( !gl_FrontFacing ) { diffuseColor.rgb = insideColor; roughnessFactor = 0.82; metalnessFactor = 0.0; }
#include <emissivemap_fragment>`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  if ( !gl_FrontFacing ) material.clearcoat = 0.0;
#endif`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|inside`;
}

export function setInteriorView(car, on) {
  if (car.interiorView === on) return;
  car.interiorView = on;
  const seen = new Set();
  car.group.traverse((o) => {
    if (o.userData.cockpitOnly) o.visible = on;
    if (!o.isMesh || seen.has(o.material)) return;
    const m = o.material;
    seen.add(m);
    const role = m.userData.cabinRole;
    if (role === 'shell') {
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    } else if (role === 'glass') {
      m.userData.outside ??= { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      const o0 = m.userData.outside;
      m.transparent = on || o0.transparent;
      m.opacity = on ? Math.min(o0.opacity, 0.14) : o0.opacity;
      m.depthWrite = on ? false : o0.depthWrite;
      m.needsUpdate = true;
    }
  });
}

// ------------------------------------------------------------------ classic cabin
// The '67 Fastback model is an exterior shell with blacked-out windows, so its cabin is
// built here: twin-cowl dash with working gauges, deluxe woodgrain wheel, bucket seats,
// door cards, headliner, pillars, mirror and a floor shifter. Dimensions follow the shell
// (windshield base z 0.61 / y 0.93, header z 0.16 / y 1.27, door skins at x ±0.72).
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function dialTexture({ max, step, label, marks, red = null, small = false }) {
  return canvasTexture(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#0b0c0d';
    g.fillRect(0, 0, w, w);
    const grd = g.createRadialGradient(c, c, 10, c, c, c);
    grd.addColorStop(0, '#1b1d20');
    grd.addColorStop(1, '#050506');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    const ang = (t) => (-135 + 270 * t) * (Math.PI / 180) - Math.PI / 2;
    if (red !== null) {
      g.strokeStyle = '#c4201a';
      g.lineWidth = 12;
      g.beginPath();
      g.arc(c, c, c - 26, ang(red), ang(1));
      g.stroke();
    }
    g.strokeStyle = '#e9e4d6';
    g.fillStyle = '#e9e4d6';
    const n = Math.round(max / step);
    for (let i = 0; i <= n * 2; i++) {
      const t = i / (n * 2);
      const major = i % 2 === 0;
      const a = ang(t);
      g.lineWidth = major ? 5 : 2.5;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * (c - 18), c + Math.sin(a) * (c - 18));
      g.lineTo(c + Math.cos(a) * (c - (major ? 40 : 30)), c + Math.sin(a) * (c - (major ? 40 : 30)));
      g.stroke();
      if (major && marks) {
        g.font = `600 ${small ? 34 : 30}px "Barlow Condensed", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const txt = marks(i / 2);
        if (txt) g.fillText(txt, c + Math.cos(a) * (c - 64), c + Math.sin(a) * (c - 64));
      }
    }
    g.font = `600 ${small ? 30 : 22}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = '#b9b2a1';
    g.fillText(label, c, c + (small ? 56 : 66));
  });
}

function woodTexture() {
  return canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#5b2c12';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y = Math.random() * h;
      g.strokeStyle = `rgba(${30 + Math.random() * 40},${12 + Math.random() * 16},4,${0.25 + Math.random() * 0.35})`;
      g.lineWidth = 0.6 + Math.random() * 2.2;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (Math.random() - 0.5) * 2);
      g.stroke();
    }
  });
}

// geometry helper: box between two points (a thin trim bar), oriented along a -> b
function barBetween(a, b, w, h, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d.length()), mat);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  return mesh;
}

// profile extruded across the car's width: pts are [z, y] pairs, x runs x0..x1
function extrudeAcross(pts, x0, x1, mat, bevel = 0.006) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = x1 - x0;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 });
  // shape (u, v) = (z, y); extrusion axis -> car x (x = x1 - ext), keeping a right-handed frame
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, x1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function buildClassicCabin(style) {
  const group = new THREE.Group();
  group.name = 'classic cabin';
  group.userData.cockpitOnly = true;
  group.visible = false;
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const vinyl = std(0x151516, 0.58);
  const vinylPleat = std(0x131314, 0.62);
  const carpet = std(0x0c0c0d, 1);
  const chrome = std(0xe0e2e4, 0.12, 1);
  const brushed = std(0xaeb3b8, 0.34, 0.9);
  const trim = std(0x1d1e20, 0.5, 0.1);
  const headliner = std(0x2a2a2c, 0.88);
  const mirror = std(0xc8ccd0, 0.04, 1);
  const wood = new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  const gaugeGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, transparent: true, opacity: 0.08, depthWrite: false });
  const needleMat = new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff4a10, emissiveIntensity: 0.6, roughness: 0.4 });
  const materials = [vinyl, vinylPleat, carpet, chrome, brushed, trim, headliner, mirror, wood, gaugeGlass, needleMat];
  const add = (mesh) => {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const X = 0.7; // inner half-width at the doors

  // floor, transmission tunnel and firewall
  add(new THREE.Mesh(new THREE.BoxGeometry(2 * X, 0.04, 1.75), carpet)).position.set(0, 0.24, -0.25);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 1.6), carpet)).position.set(0, 0.33, -0.2);
  add(extrudeAcross([[0.62, 0.25], [0.8, 0.26], [0.74, 0.62], [0.56, 0.64]], -X, X, carpet, 0));

  // dash: padded top meeting the windshield, face below, brushed insert on the passenger side
  add(extrudeAcross([[0.6, 0.945], [0.47, 0.962], [0.39, 0.96], [0.362, 0.95], [0.364, 0.935], [0.42, 0.935], [0.6, 0.935]], -X, X, vinyl, 0.008));
  add(extrudeAcross([[0.4, 0.935], [0.37, 0.66], [0.56, 0.63], [0.56, 0.935]], -X, X, trim, 0.004));
  const insert = add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, 0.01), brushed));
  insert.position.set(-0.36, 0.8, 0.379);
  insert.rotation.x = 0.12;
  // twin cowls over the instruments and the passenger side
  for (const [x, w] of [[0.36, 0.5], [-0.36, 0.44]]) {
    const cowl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, w, 20, 1, false, 0, Math.PI), vinyl));
    cowl.rotation.z = Math.PI / 2;
    cowl.position.set(x, 0.952, 0.385);
  }
  // instrument panel: two large and two small dials in chrome bezels, facing the driver
  // the face leans back a little, so the dials look up at the driver
  const faceAxis = new THREE.Vector3(0, 0.2, -0.98).normalize();
  const dials = [];
  const dial = (x, y, r, tex) => {
    const frame = steeringFrame(new THREE.Vector3(x, y, 0.364 + (y - 0.66) * 0.109), faceAxis);
    const g = new THREE.Group();
    g.applyMatrix4(frame);
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 });
    materials.push(faceMat);
    g.add(new THREE.Mesh(new THREE.CircleGeometry(r, 40), faceMat));
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.0055, 8, 40), chrome);
    bezel.position.z = 0.003;
    g.add(bezel);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.01, r + 0.004, 0.035, 32, 1, true), vinyl);
    cup.rotation.x = Math.PI / 2;
    cup.position.z = 0.012;
    g.add(cup);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r, 32), gaugeGlass);
    glass.position.z = 0.008;
    g.add(glass);
    const needle = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.0035, r * 0.82, 0.002), needleMat);
    bar.position.set(0, r * 0.36, 0.004);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12).rotateX(Math.PI / 2), trim);
    hub.position.z = 0.006;
    needle.add(bar, hub);
    g.add(needle);
    add(g);
    dials.push({ needle, faceMat });
    return needle;
  };
  const tach = dial(0.36 + 0.087, 0.866, 0.054, dialTexture({ max: 8, step: 1, label: 'RPM x1000', marks: (v) => String(v), red: 6 / 8 }));
  const speedo = dial(0.36 - 0.087, 0.866, 0.054, dialTexture({ max: 140, step: 20, label: 'MPH', marks: (v) => String(v * 20) }));
  const temp = dial(0.36 + 0.2, 0.872, 0.032, dialTexture({ max: 2, step: 1, label: 'TEMP', marks: (v) => ['C', '', 'H'][v], small: true }));
  const fuel = dial(0.36 - 0.2, 0.872, 0.032, dialTexture({ max: 2, step: 1, label: 'FUEL', marks: (v) => ['E', '', 'F'][v], small: true }));
  temp.rotation.z = THREE.MathUtils.degToRad(135 - 270 * 0.52);
  fuel.rotation.z = THREE.MathUtils.degToRad(135 - 270 * 0.78);
  // radio and heater controls in the centre
  const radio = add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.012), chrome));
  radio.position.set(0, 0.765, 0.377);
  radio.rotation.x = 0.12;
  for (const x of [-0.07, 0.07]) {
    const knob = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 16).rotateX(Math.PI / 2), trim));
    knob.position.set(x, 0.765, 0.368);
  }

  // steering column and the deluxe three-spoke woodgrain wheel
  const wheelAxis = new THREE.Vector3(0, 0.36, -0.93).normalize();
  const wheelCenter = new THREE.Vector3(0.36, 0.785, 0.14);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.34, 16), trim);
  column.position.copy(wheelCenter).addScaledVector(wheelAxis, -0.2);
  column.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wheelAxis);
  add(column);
  const mount = new THREE.Group();
  mount.applyMatrix4(steeringFrame(wheelCenter, wheelAxis));
  const steeringWheel = new THREE.Group();
  mount.add(steeringWheel);
  group.add(mount);
  const R = 0.19;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0155, 12, 72), wood);
  steeringWheel.add(rim);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(R - 0.045, 0.028, 0.006), brushed);
    spoke.position.set(Math.cos(a) * (R / 2 + 0.02), Math.sin(a) * (R / 2 + 0.02), -0.012);
    spoke.rotation.z = a;
    steeringWheel.add(spoke);
  }
  const horn = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.004, 6, 48), chrome);
  horn.position.z = 0.004;
  steeringWheel.add(horn);
  const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.035, 28).rotateX(Math.PI / 2), trim);
  hubMesh.position.z = -0.01;
  steeringWheel.add(hubMesh);
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), new THREE.MeshStandardMaterial({ color: 0xb8231d, roughness: 0.3, metalness: 0.5 }));
  materials.push(emblem.material);
  emblem.position.z = 0.009;
  steeringWheel.add(emblem);
  steeringWheel.traverse((o) => o.isMesh && (o.receiveShadow = true));

  // bucket seats (pleated vinyl), rear bench
  for (const sx of [0.36, -0.36]) {
    const cushion = add(new RoundedBoxGeometryMesh(0.5, 0.13, 0.52, 0.04, vinylPleat));
    cushion.position.set(sx, 0.47, -0.52);
    cushion.rotation.x = 0.06;
    const back = add(new RoundedBoxGeometryMesh(0.5, 0.62, 0.12, 0.05, vinylPleat));
    back.position.set(sx, 0.8, -0.82);
    back.rotation.x = -0.24;
  }
  const bench = add(new RoundedBoxGeometryMesh(1.3, 0.16, 0.45, 0.05, vinylPleat));
  bench.position.set(0, 0.46, -1.25);

  // door cards with armrest, handle and window crank
  for (const side of [1, -1]) {
    const card = add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.6, 1.1), vinyl));
    card.position.set(side * X, 0.6, 0.0);
    const sill = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 1.1), chrome));
    sill.position.set(side * (X - 0.01), 0.905, 0.0);
    const arm = add(new RoundedBoxGeometryMesh(0.07, 0.05, 0.36, 0.015, vinylPleat));
    arm.position.set(side * (X - 0.05), 0.68, -0.2);
    const handle = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.13), chrome));
    handle.position.set(side * (X - 0.03), 0.8, 0.25);
    const crank = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16).rotateZ(Math.PI / 2), chrome));
    crank.position.set(side * (X - 0.03), 0.62, 0.3);
    // A-pillar trim from the dash to the header
    add(barBetween(new THREE.Vector3(side * 0.69, 0.93, 0.6), new THREE.Vector3(side * 0.6, 1.265, 0.17), 0.045, 0.06, trim));
    // sun visor
    const visor = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.17), headliner));
    visor.position.set(side * 0.33, 1.255, 0.07);
    visor.rotation.x = 0.12;
  }

  // headliner: gently arched under the roof, header rail above the windshield
  const lining = new THREE.PlaneGeometry(1.26, 1.2, 12, 6);
  lining.rotateX(Math.PI / 2);
  const lp = lining.attributes.position;
  for (let i = 0; i < lp.count; i++) lp.setY(i, 1.282 - 0.07 * (lp.getX(i) / 0.63) ** 2);
  lining.computeVertexNormals();
  add(new THREE.Mesh(lining, headliner)).position.set(0, 0, -0.42);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.03, 0.06), trim)).position.set(0, 1.262, 0.16);

  // rear-view mirror on the header
  const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 8), chrome));
  stem.position.set(0, 1.235, 0.15);
  const mirrorBody = add(new RoundedBoxGeometryMesh(0.24, 0.065, 0.025, 0.01, trim));
  mirrorBody.position.set(0, 1.195, 0.14);
  mirrorBody.rotation.y = 0.12;
  const glassFace = add(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.052), mirror));
  glassFace.position.set(0.0015, 1.195, 0.126);
  glassFace.rotation.y = Math.PI + 0.12;

  // Hurst-style shifter on the tunnel
  const lever = add(barBetween(new THREE.Vector3(0.02, 0.42, 0.06), new THREE.Vector3(0.05, 0.64, -0.03), 0.014, 0.014, chrome));
  lever.castShadow = false;
  const ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), new THREE.MeshStandardMaterial({ color: 0xefeee8, roughness: 0.25 })));
  materials.push(ball.material);
  ball.position.set(0.05, 0.655, -0.035);
  const boot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, 0.06, 16), vinyl));
  boot.position.set(0.02, 0.44, 0.06);

  const mph = 1 / 1.609;
  return {
    group,
    steeringWheel,
    // needles: speed (mph) and rpm; instrument lighting at night
    update(kmh, rpm, lights) {
      speedo.rotation.z = THREE.MathUtils.degToRad(135 - 270 * Math.min(1, (Math.abs(kmh) * mph) / 140));
      tach.rotation.z = THREE.MathUtils.degToRad(135 - 270 * Math.min(1.02, rpm / 8000));
      const glow = lights ? 1.1 : 0.35;
      for (const d of dials) d.faceMat.emissiveIntensity = glow;
      needleMat.emissiveIntensity = lights ? 2.2 : 0.6;
    },
    dispose() {
      group.traverse((o) => o.isMesh && o.geometry.dispose());
      for (const m of materials) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

function RoundedBoxGeometryMesh(w, h, d, r, mat) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
}
