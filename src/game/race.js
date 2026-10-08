// Race manager: grid, countdown, progress/positions, laps, checkpoints, driving line, results.
import * as THREE from 'three';

const _dv = new THREE.Vector3();
import { clamp, formatTime } from '../core/math.js';
import { AIDriver, drivatarNames } from './ai.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { CARS, CAR_BY_ID } from '../vehicle/carspecs.js';
import { PAINTS } from '../vehicle/carspecs.js';
import { fogUniforms } from '../world/sky.js';

// Grid places (0 = pole) for `humans` players and `npcs` AI opponents: the players start
// together near the back, as a solo player always has (third from last).
export function gridSlots(humans, npcs) {
  const total = humans + npcs;
  const first = Math.min(total - humans, Math.max(0, total - humans - 2));
  const human = [],
    npc = [];
  for (let k = 0; k < total; k++) (k >= first && k < first + humans ? human : npc).push(k);
  return { human, npc };
}

// how much a racer still has to run, at the pace it has kept so far
const projectFinish = (A, r) => A.raceTime + (A.total - r.dist) / Math.max(8, (r.dist - (r.startDist ?? 0)) / Math.max(1, A.raceTime));

// ------------------------------------------------------------------ driving line
const lineVert = /* glsl */ `
attribute float aSpeed;
attribute float aS;
varying float vSpeed;
varying float vS;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vSpeed = aSpeed;
  vS = aS;
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const lineFrag = /* glsl */ `
uniform float uSpeed;
uniform float uPlayerS;
uniform float uLen;
uniform float uClosed;
uniform float uTime;
varying float vSpeed;
varying float vS;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float ds = vS - uPlayerS;
  if ( uClosed > 0.5 ) ds = mod( ds + uLen * 0.5, uLen ) - uLen * 0.5;
  float vis = smoothstep( 2.0, 8.0, ds ) * ( 1.0 - smoothstep( 110.0, 190.0, ds ) );
  if ( vis <= 0.0 ) discard;
  float diff = uSpeed - vSpeed;
  vec3 blue = vec3( 0.1, 0.55, 1.0 );
  vec3 yellow = vec3( 1.0, 0.82, 0.1 );
  vec3 red = vec3( 1.0, 0.12, 0.12 );
  vec3 col = diff < 0.0 ? mix( blue, yellow, smoothstep( -7.0, -1.0, diff ) ) : mix( yellow, red, smoothstep( 1.0, 6.0, diff ) );
  // chevrons pointing forward
  float u = abs( vUv.x - 0.5 ) * 2.0;
  float chev = fract( vUv.y - u * 0.35 );
  float a = smoothstep( 0.0, 0.08, chev ) * ( 1.0 - smoothstep( 0.45, 0.55, chev ) );
  a *= 1.0 - smoothstep( 0.85, 1.0, u );
  gl_FragColor = vec4( col * 1.6, a * vis * 0.85 );
  #include <fog_fragment>
}`;

function buildDrivingLine(route, profile, world) {
  const n = route.n;
  const rows = route.closed ? n + 1 : n;
  const pos = new Float32Array(rows * 2 * 3);
  const uv = new Float32Array(rows * 2 * 2);
  const sp = new Float32Array(rows * 2);
  const sa = new Float32Array(rows * 2);
  const hw = 0.55;
  for (let r = 0; r < rows; r++) {
    const i = r % n;
    const x = route.lx[i],
      z = route.lz[i];
    const nx = -route.tz[i],
      nz = route.tx[i];
    const s = r < n ? route.s[i] : route.length;
    for (let k = 0; k < 2; k++) {
      const o = k === 0 ? -hw : hw;
      const px = x + nx * o,
        pz = z + nz * o;
      const v = r * 2 + k;
      pos[v * 3] = px;
      pos[v * 3 + 1] = world.height(px, pz) + 0.1;
      pos[v * 3 + 2] = pz;
      uv[v * 2] = k;
      uv[v * 2 + 1] = s / 2.6;
      sp[v] = profile[i];
      sa[v] = s;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
  g.setAttribute('aS', new THREE.BufferAttribute(sa, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uSpeed: { value: 0 }, uPlayerS: { value: 0 }, uLen: { value: route.length }, uClosed: { value: route.closed ? 1 : 0 }, uTime: { value: 0 } },
    vertexShader: lineVert,
    fragmentShader: lineFrag,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -8,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

// ------------------------------------------------------------------ checkpoint gates
function makeGate(width, finish = false) {
  const g = new THREE.Group();
  const col = finish ? 0xffffff : 0x40d8ff;
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(finish ? 1.5 : 2.2), transparent: true, opacity: 0.75, depthWrite: false });
  const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 7, 10);
  for (const sd of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, mat);
    p.position.set(sd * (width / 2 + 1.5), 3.5, 0);
    g.add(p);
  }
  const barTex = finish ? checkerTexture() : null;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width + 3.5, finish ? 1.2 : 0.35, 0.2), finish ? new THREE.MeshBasicMaterial({ map: barTex }) : mat);
  bar.position.y = 7;
  g.add(bar);
  if (!finish) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(width + 3, 7), new THREE.MeshBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    glow.position.y = 3.5;
    g.add(glow);
  }
  return g;
}

let _checker = null;
function checkerTexture() {
  if (_checker) return _checker;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      g.fillRect(i * 16, j * 16, 16, 16);
    }
  _checker = new THREE.CanvasTexture(c);
  _checker.colorSpace = THREE.SRGBColorSpace;
  return _checker;
}

// ------------------------------------------------------------------ manager
export class RaceManager {
  constructor(game) {
    this.game = game;
    this.active = null;
  }

  get running() {
    return !!this.active;
  }

  // AI opponents for an event, from the player's performance class (single-seaters only
  // race each other). Online, the host sends this roster so every client has the same field.
  makeRoster(def) {
    const game = this.game;
    const spec = game.player.spec;
    const formula = !!spec.formula;
    const pool = CARS.filter((c) => !!c.formula === formula && (formula || Math.abs(c.pi - spec.pi) < 170));
    const base = Number(game.settings.aiSkill) || 0.93;
    return drivatarNames(def.ai, Math.floor(Math.random() * 1000)).map((name) => ({
      name,
      car: (pool.length ? pool[Math.floor(Math.random() * pool.length)] : spec).id,
      paint: PAINTS[Math.floor(Math.random() * PAINTS.length)],
      skill: clamp(base + (Math.random() - 0.5) * 0.06, 0.8, 1.05),
    }));
  }

  // An AI opponent's car and driver (roster entry o, opponent number i), placed by `place`.
  spawnOpponent(o, i, route, place) {
    const game = this.game;
    const v = new Vehicle(CAR_BY_ID[o.car] || game.player.spec, game.world, { color: o.paint });
    game.scene.add(v.root);
    place(v);
    const ai = new AIDriver(v, route, { skill: o.skill, lane: ((((i * 0.618) % 1) + 1) % 1 - 0.5) * 2, name: o.name });
    game.vehicles.push(v);
    return { v, ai, npc: i, name: o.name, isPlayer: false, dist: 0, hint: -1, lap: 0, lastS: 0, finished: false, time: 0 };
  }

  // Solo: this client's own opponents. Online (opts.online): the players on opts.grid and
  // the opponents of opts.npcs share the grid; only the member driving the opponents
  // (opts.authority) builds them here, everyone else draws them as the world streams them.
  start(def, opts = {}) {
    const game = this.game;
    this.cleanup();
    const route = def.route;
    const player = game.player;
    const racers = [];
    const online = !!opts.online;
    const roster = online ? opts.npcs || [] : this.makeRoster(def);
    const humans = online ? opts.grid.length : 1;
    const slots = gridSlots(humans, roster.length);
    const spot = (back, col) => {
      const pt = route.pointAt(back, 0, 0, {});
      const lat = def.type === 'drag' ? (col ? 3.2 : -3.2) : (col ? 1 : -1) * Math.min(3, pt.w / 2 - 1.8);
      return { x: pt.x - pt.tz * lat, z: pt.z + pt.tx * lat, h: Math.atan2(pt.tx, pt.tz), s: back };
    };
    // a car on this spot touches nothing static (front, middle and back of it)
    const clear = (p) => {
      const cw = game.collision;
      if (!cw) return true;
      const fx = Math.sin(p.h),
        fz = Math.cos(p.h);
      for (const k of [-1.6, 0, 1.6]) {
        const x = p.x + fx * k,
          z = p.z + fz * k;
        if (cw.clearance(x, z, game.world.height(x, z)) < 1.2) return false;
      }
      return true;
    };
    // Rows of two from the line backwards, 8.5 m apart; a row that would put a car on a
    // building, pole or wall moves further back until both its spots are clear.
    const rows = [];
    for (let row = 0, back = (def.closed ? 0 : 36) - 6; row * 2 < slots.human.length + slots.npc.length; row++, back -= 8.5) {
      for (let tries = 0; tries < 15 && !(clear(spot(back, 0)) && clear(spot(back, 1))); tries++) back -= 2;
      rows.push(back);
    }
    const gridPos = (k) => spot(rows[Math.floor(k / 2)], k % 2);
    const me = gridPos(slots.human[online ? Math.max(0, opts.grid.indexOf(game.net.id)) : 0]);
    player.place(me.x, me.z, me.h);
    racers.push({ v: player, name: game.save?.data.name || 'You', isPlayer: true, dist: me.s, hint: -1, lap: 0, lastS: me.s, finished: false, time: 0, checkpoints: 0 });
    if (!online || opts.authority)
      roster.forEach((o, i) => {
        const gp = gridPos(slots.npc[i]);
        const r = this.spawnOpponent(o, i, route, (v) => v.place(gp.x, gp.z, gp.h));
        r.dist = r.lastS = gp.s;
        racers.push(r);
      });
    // driving line + gates
    const profile = route.speedProfile(player.spec.grip, player.spec.topKmh / 3.6, 7.5);
    const line = buildDrivingLine(route, profile, game.world);
    line.visible = game.settings.drivingLine !== 'off';
    game.scene.add(line);
    const cpSpacing = 320;
    const nCp = Math.max(2, Math.round(route.length / cpSpacing));
    const checkpoints = [];
    for (let k = 1; k <= nCp; k++) {
      const s = def.closed ? (route.length * k) / nCp : 36 + ((route.length - 36) * k) / nCp;
      checkpoints.push(s);
    }
    const gates = [];
    for (let k = 0; k < 2; k++) {
      const gte = makeGate(10, false);
      game.scene.add(gte);
      gates.push(gte);
    }
    const finishGate = makeGate(12, true);
    game.scene.add(finishGate);
    const fs = def.closed ? 0 : route.length - 0.1;
    const fp = route.pointAt(fs, 0, 0, {});
    finishGate.position.set(fp.x, game.world.height(fp.x, fp.z), fp.z);
    finishGate.rotation.y = Math.atan2(fp.tx, fp.tz);
    const startS = def.closed ? 0 : 36;
    this.active = {
      def,
      route,
      racers,
      line,
      profile,
      gates,
      finishGate,
      checkpoints,
      state: 'intro',
      timer: online ? Math.max(0.5, (opts.startAt - game.net.serverNow()) / 1000 - 3) : 3.2,
      raceTime: 0,
      startS,
      total: def.closed ? route.length * def.laps : route.length - 1.5,
      nextCp: 0,
      wrongWay: 0,
      offTrack: 0,
      lastPlayerPos: 1,
      online,
      authority: online && !!opts.authority, // this client drives the shared opponents
      onlineStartAt: opts.startAt,
      gridSize: humans + roster.length,
      finishOrder: [],
      lapStart: 0,
      bestLap: Infinity,
    };
    for (const r of this.active.racers) {
      r.v.physics.frozen = true;
      r.startDist = r.dist;
    }
    game.gameCam.snap();
    game.hud.bigMessage(def.name, `${def.series} · ${def.laps > 1 ? def.laps + ' laps · ' : ''}${(def.distance / 1000).toFixed(1)} km`, 2800, 'medium');
    this.updateGates();
    return this.active;
  }

  updateGates() {
    const A = this.active;
    const game = this.game;
    for (let k = 0; k < A.gates.length; k++) {
      const ci = A.nextCp + k;
      const g = A.gates[k];
      if (ci >= A.checkpoints.length - (A.def.closed ? 0 : 1) || (A.def.closed && ci >= A.checkpoints.length)) {
        g.visible = false;
        continue;
      }
      let s = A.checkpoints[ci];
      if (A.def.closed && ci === A.checkpoints.length - 1) {
        g.visible = false;
        continue;
      }
      const p = A.route.pointAt(s, 0, 0, {});
      g.visible = true;
      g.position.set(p.x, game.world.height(p.x, p.z), p.z);
      g.rotation.y = Math.atan2(p.tx, p.tz);
      g.scale.set(Math.max(1, p.w / 10), 1, 1);
    }
  }

  // progress for a racer (monotonic distance incl. laps)
  progress(r) {
    const A = this.active;
    const route = A.route;
    const pr = route.project(r.v.physics.pos.x, r.v.physics.pos.z, r.hint);
    r.hint = pr.i;
    r.routeDist = pr.dist;
    let s = pr.s;
    if (A.def.closed) {
      // unwrap
      const L = route.length;
      const cur = r.dist;
      const base = Math.floor(cur / L) * L;
      let cand = base + s;
      if (cand - cur > L / 2) cand -= L;
      if (cur - cand > L / 2) cand += L;
      r.dist = cand;
    } else r.dist = s;
    return pr;
  }

  update(dt) {
    const A = this.active;
    if (!A) return;
    const game = this.game;
    const hud = game.hud;
    const player = A.racers.find((r) => r.isPlayer);
    A.line.material.uniforms.uSpeed.value = game.player.physics.speed;
    if (A.state === 'intro') {
      A.timer -= dt;
      this.revWhileFrozen(dt);
      if (A.timer <= 0) {
        A.state = 'countdown';
        A.timer = 3;
        A.lastCount = 4;
      }
    } else if (A.state === 'countdown') {
      A.timer -= dt;
      this.revWhileFrozen(dt);
      // the Autódromo's gantry lights come on one by one, then go out for the start
      if (A.def.venue === 'autodromo') game.props.circuit?.setLights(A.timer > 0 ? Math.min(5, Math.floor((3 - A.timer) * 5 / 2.6) + 1) : 0);
      const c = Math.ceil(A.timer);
      if (c !== A.lastCount && c > 0) {
        A.lastCount = c;
        hud.bigMessage(String(c), '', 900);
        game.audio.ui('count');
      }
      if (A.timer <= 0) {
        A.state = 'racing';
        hud.bigMessage('GO!', '', 900, 'pink');
        game.audio.ui('go');
        for (const r of A.racers) r.v.physics.frozen = false;
      }
    } else if (A.state === 'racing' || A.state === 'finishing') {
      A.raceTime += dt;
      // AI
      const others = A.others || (A.others = A.racers.map((r) => r.v));
      const pace = A.online ? this.playersProgress(player) : player.dist;
      for (const r of A.racers) {
        if (r.ai && !r.finished) {
          // rubber banding relative to the player (online: the players on average)
          const gap = r.dist - pace;
          r.ai.rubber = clamp(1 - gap / 900, 0.9, 1.08);
          r.ai.update(dt, { others, racing: true });
        } else if (r.ai && r.finished) {
          r.v.physics.input.throttle = 0;
          r.v.physics.input.brake = 0.4;
        }
      }
      // progress + finishing
      for (const r of A.racers) {
        if (r.finished) continue;
        this.progress(r);
        if (r.dist >= A.total) {
          r.finished = true;
          r.time = A.raceTime;
          A.finishOrder.push(r);
          if (r.isPlayer) this.playerFinished(r);
        }
      }
      // player checkpoints / laps / wrong way
      const pr = player;
      if (!pr.finished) {
        while (A.nextCp < A.checkpoints.length && this.lapLocal(pr.dist) >= A.checkpoints[A.nextCp] && this.lapIndex(pr.dist) === this.cpLap(pr)) {
          A.nextCp++;
          game.audio.ui('checkpoint');
          this.updateGates();
        }
        const lap = this.lapIndex(pr.dist);
        if (A.def.closed && lap > pr.lap && pr.dist > A.startS + 10) {
          const lapTime = A.raceTime - A.lapStart;
          A.bestLap = Math.min(A.bestLap, lapTime);
          A.lapStart = A.raceTime;
          pr.lap = lap;
          A.nextCp = 0;
          this.updateGates();
          if (lap < A.def.laps) hud.bigMessage(lap === A.def.laps - 1 ? 'FINAL LAP' : `LAP ${lap + 1}`, formatTime(lapTime), 1600, 'medium');
        }
        // wrong way / off track
        const fwdSpeed = game.player.physics.forwardSpeed;
        const tang = A.route.pointAt(pr.dist, 0, 0, {});
        const hx = Math.sin(game.player.physics.heading),
          hz = Math.cos(game.player.physics.heading);
        const facing = hx * tang.tx + hz * tang.tz;
        if (facing < -0.3 && fwdSpeed > 3) A.wrongWay += dt;
        else A.wrongWay = Math.max(0, A.wrongWay - dt * 2);
        if (pr.routeDist > 45) A.offTrack += dt;
        else A.offTrack = 0;
        if (A.wrongWay > 1.2) hud.setPrompt('<span class="ev-title">WRONG WAY</span>');
        else if (A.offTrack > 0.5) hud.setPrompt(`<span class="ev-title">RETURN TO THE TRACK</span> · auto reset in ${Math.max(0, Math.ceil(6 - A.offTrack))}`);
        else hud.setPrompt('');
        if (A.offTrack > 6) this.resetPlayerToTrack();
        // passes
        const pos = this.position(pr);
        if (pos < A.lastPlayerPos) game.skills.pass();
        A.lastPlayerPos = pos;
        // drafting: a car directly ahead within 15 m
        const pp = game.player.physics;
        game.drafting = A.racers.some((r) => {
          if (r.isPlayer) return false;
          const d = _dv.subVectors(r.v.physics.pos, pp.pos);
          const f = d.x * hx + d.z * hz;
          const l = Math.abs(d.x * hz - d.z * hx);
          return f > 3 && f < 15 && l < 1.8;
        });
      }
      if (A.state === 'finishing') {
        A.timer -= dt;
        if (A.online) {
          // wait for everyone (the world sends the results); keep driving any opponents
          // meanwhile. A lost connection ends it here after five minutes.
          if (A.timer < -300) {
            game.net.leaveRace();
            this.showResults();
          }
        } else if (A.timer <= 0 || A.racers.every((r) => r.finished)) this.showResults();
      }
      A.line.material.uniforms.uPlayerS.value = this.lapLocal(pr.dist);
    }
    // the standings panel is rebuilt as HTML: 12 times a second is plenty
    A.hudT = (A.hudT || 0) - dt;
    if (A.hudT <= 0 || A.state !== 'racing') {
      A.hudT = 1 / 12;
      this.updateHUD();
    }
  }

  // online: the players' average progress (this one live, the others as the world last said)
  playersProgress(player) {
    const members = this.game.net.standings?.members || [];
    let sum = player.dist,
      n = 1;
    for (const m of members)
      if (m.id !== this.game.net.id) {
        sum += m.d;
        n++;
      }
    return sum / n;
  }

  // the opponents' progress for the world's standings: [i, distance, lap, done, time, eta]
  opponentProgress() {
    const A = this.active;
    const out = [];
    for (const r of A.racers) if (r.npc != null) out.push([r.npc, Math.round(r.dist * 10) / 10, this.lapIndex(r.dist), r.finished ? 1 : 0, r.finished ? r.time : 0, r.finished ? null : Math.round(projectFinish(A, r) * 100) / 100]);
    return out;
  }

  // This client now drives the opponents (their driver left or went quiet): each car is
  // taken over where it is drawn now, with its race progress. cars: [{ npc, pos, quat,
  // vel, d, lap, done, time }]
  adoptOpponents(cars) {
    const A = this.active;
    if (!A || !A.online || A.authority) return;
    A.authority = true;
    const frozen = A.state === 'intro' || A.state === 'countdown';
    for (const c of cars) {
      const r = this.spawnOpponent(c.npc, c.npc.i, A.route, (v) => {
        v.place(c.pos.x, c.pos.z, Math.atan2(2 * (c.quat.x * c.quat.z + c.quat.w * c.quat.y), 1 - 2 * (c.quat.x ** 2 + c.quat.y ** 2)));
        v.physics.pos.copy(c.pos);
        v.physics.quat.copy(c.quat);
        v.physics.vel.copy(c.vel);
        v.saveState();
      });
      Object.assign(r, { dist: c.d || A.startS, lastS: c.d || A.startS, startDist: A.startS, lap: c.lap || 0, finished: !!c.done, time: c.time || 0 });
      r.v.physics.frozen = frozen;
      A.racers.push(r);
    }
    A.others = null;
  }

  // ... and hands them back (another member drives them now)
  releaseOpponents() {
    const A = this.active;
    if (!A || !A.authority) return;
    A.authority = false;
    const game = this.game;
    for (const r of [...A.racers])
      if (r.npc != null) {
        r.v.dispose();
        game.vehicles.splice(game.vehicles.indexOf(r.v), 1);
        A.racers.splice(A.racers.indexOf(r), 1);
      }
    A.others = null;
  }

  lapIndex(d) {
    const A = this.active;
    if (!A.def.closed) return 0;
    return Math.floor(d / A.route.length);
  }
  lapLocal(d) {
    const A = this.active;
    if (!A.def.closed) return d;
    const L = A.route.length;
    return ((d % L) + L) % L;
  }
  cpLap(r) {
    return this.lapIndex(r.dist);
  }

  revWhileFrozen(dt) {
    const game = this.game;
    const p = game.player.physics;
    const ctl = game.input.driving(dt);
    const target = p.spec.idle + ctl.throttle * (p.spec.redline * 0.85 - p.spec.idle);
    p.rpm += (target - p.rpm) * Math.min(1, dt * (ctl.throttle > 0.1 ? 6 : 3));
    p.throttleOut = ctl.throttle;
    for (const r of this.active.racers)
      if (r.ai) {
        const q = r.v.physics;
        q.rpm += (q.spec.idle + (0.35 + Math.sin(game.time * 3 + r.v.root.id) * 0.25) * q.spec.redline * 0.7 - q.rpm) * Math.min(1, dt * 4);
      }
  }

  position(r) {
    const A = this.active;
    const sorted = [...A.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
    return sorted.indexOf(r) + 1;
  }

  standings() {
    const A = this.active;
    return [...A.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
  }

  updateHUD() {
    const A = this.active;
    const game = this.game;
    const player = A.racers.find((r) => r.isPlayer);
    if (A.state === 'results') return;
    const pos = A.online ? game.net.racePosition() : this.position(player);
    const st = this.standings();
    const lapTxt = A.def.closed ? `<span><b>LAP</b>${Math.min(A.def.laps, player.lap + 1)}/${A.def.laps}</span>` : `<span><b>DIST</b>${(Math.max(0, A.total - player.dist) / 1000).toFixed(1)} km</span>`;
    const others = A.online ? game.net.raceStandings() : null;
    const list = st
      .slice(0, 8)
      .map((r, i) => `<div class="${r.isPlayer ? 'me' : ''}"><i>${i + 1}</i>${escapeHtml(r.name)}</div>`)
      .join('');
    const total = A.online ? game.net.raceTotal() || A.gridSize : A.racers.length;
    game.hud.setRaceInfo(
      `<div class="pos">${pos}<small>/${total}</small></div><div class="row">${lapTxt}<span><b>TIME</b>${formatTime(A.raceTime)}</span>${
        isFinite(A.bestLap) ? `<span><b>BEST LAP</b>${formatTime(A.bestLap)}</span>` : ''
      }</div><div class="standings">${others || list}</div>`
    );
  }

  resetPlayerToTrack() {
    const A = this.active;
    const game = this.game;
    const r = A.racers.find((x) => x.isPlayer);
    const p = A.route.pointAt(this.lapLocal(r.dist), 1, 0, {});
    game.player.place(p.x, p.z, Math.atan2(p.tx, p.tz));
    game.gameCam.snap();
    A.offTrack = 0;
    r.hint = -1;
  }

  playerFinished(r) {
    const A = this.active;
    const game = this.game;
    const pos = A.finishOrder.indexOf(r) + 1;
    A.playerPos = pos;
    A.state = 'finishing';
    A.timer = 6;
    game.hud.bigMessage(pos === 1 ? 'YOU WIN!' : `${ordinal(pos)} PLACE`, formatTime(r.time), 3200, pos === 1 ? 'pink' : '');
    game.audio.ui(pos === 1 ? 'levelup' : 'bank');
    game.hud.setPrompt('');
    if (A.online) game.net.raceProgress(this, true);
  }

  showResults() {
    const A = this.active;
    const game = this.game;
    A.state = 'results';
    // project finishing times for racers still on track
    for (const r of A.racers)
      if (!r.finished && r.dist > 10) {
        r.time = projectFinish(A, r);
        r.finished = true;
        r.projected = true;
      }
    const st = this.standings();
    const player = A.racers.find((r) => r.isPlayer);
    const pos = st.indexOf(player) + 1;
    game.hud.setRaceInfo('');
    game.onRaceFinished?.(A.def, pos, player.finished ? player.time : null, st, A);
  }

  cleanup() {
    const A = this.active;
    if (!A) return;
    const game = this.game;
    for (const r of A.racers) {
      if (!r.isPlayer) {
        r.v.dispose();
        game.vehicles.splice(game.vehicles.indexOf(r.v), 1);
      }
      r.v.physics.frozen = false;
    }
    game.scene.remove(A.line, A.finishGate, ...A.gates);
    A.line.geometry.dispose();
    game.props.circuit?.setLights(0);
    game.hud.setRaceInfo('');
    game.hud.setPrompt('');
    game.drafting = false;
    this.active = null;
  }
}

export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
