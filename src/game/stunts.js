// PR stunts: speed traps, speed zones, drift zones, danger signs (jumps). Signs show records.
import * as THREE from 'three';
import { clamp, formatNumber } from '../core/math.js';
import { EVENT_COLORS } from './events.js';
import { PALETTE } from '../config.js';

function starsFor(value, th) {
  let s = 0;
  for (const t of th) if (value >= t) s++;
  return s;
}

function starStr(n) {
  return '<b>' + '★'.repeat(n) + '</b>' + '★'.repeat(3 - n);
}

const TYPE_LABEL = { speed: 'SPEED TRAP', zone: 'SPEED ZONE', drift: 'DRIFT ZONE', jump: 'DANGER SIGN' };

function signTexture(stunt, record, units) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  const col = EVENT_COLORS[stunt.type] || PALETTE.cyan;
  g.fillStyle = '#10121a';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = col;
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#0b0b12';
  g.font = '800 italic 44px "Barlow Condensed", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(TYPE_LABEL[stunt.type], 24, 34);
  g.fillStyle = '#ffffff';
  g.font = '700 34px "Barlow Condensed", sans-serif';
  g.fillText(stunt.name.toUpperCase(), 24, 104);
  g.font = '600 26px "Barlow", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText('YOUR BEST', 24, 160);
  g.fillStyle = col;
  g.font = '800 italic 52px "Barlow Condensed", sans-serif';
  g.fillText(record ? formatValue(stunt, record.value, units) : '—', 24, 210);
  const s = record ? record.stars : 0;
  g.font = '40px sans-serif';
  for (let i = 0; i < 3; i++) {
    g.fillStyle = i < s ? PALETTE.yellow : 'rgba(255,255,255,0.2)';
    g.fillText('★', 330 + i * 52, 206);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function formatValue(stunt, v, units = 'kmh') {
  if (stunt.type === 'speed' || stunt.type === 'zone') return units === 'mph' ? `${Math.round(v * 0.621371)} MPH` : `${Math.round(v)} KM/H`;
  if (stunt.type === 'drift') return formatNumber(v) + ' PTS';
  if (stunt.type === 'jump') return units === 'mph' ? `${Math.round(v * 3.28084)} FT` : `${Math.round(v)} M`;
  return String(v);
}

export class StuntSystem {
  constructor(game, stunts) {
    this.game = game;
    this.stunts = stunts;
    this.group = new THREE.Group();
    this.group.name = 'stunts';
    this.active = null;
    this.prev = new THREE.Vector3();
    this.hasPrev = false;
    for (const st of stunts) this.buildSign(st);
    game.scene.add(this.group);
  }

  record(st) {
    return this.game.save?.data.records[st.id] || null;
  }

  buildSign(st) {
    const world = this.game.world;
    const g = new THREE.Group();
    // place the sign beside the road/start
    const side = st.width ? st.width / 2 + 5 : 8;
    const nx = -st.tz,
      nz = st.tx;
    const x = st.x + nx * side,
      z = st.z + nz * side;
    const y = world.height(x, z);
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(-nx, -nz);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.2, 0.25), new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.6, metalness: 0.5 }));
    post.position.y = 2.1;
    const post2 = post.clone();
    post.position.x = -1.6;
    post2.position.x = 1.6;
    const mat = new THREE.MeshStandardMaterial({ map: signTexture(st, this.record(st), this.game.settings.units), emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 });
    mat.emissiveMap = mat.map;
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 0.15), [new THREE.MeshStandardMaterial({ color: 0x111111 }), new THREE.MeshStandardMaterial({ color: 0x111111 }), new THREE.MeshStandardMaterial({ color: 0x111111 }), new THREE.MeshStandardMaterial({ color: 0x111111 }), mat, mat]);
    board.position.y = 4.4;
    board.castShadow = true;
    g.add(post, post2, board);
    st.sign = { group: g, mat };
    this.group.add(g);
    // stunt line across the road (for traps / zone starts)
    if (st.type !== 'jump') {
      const w = (st.width || 10) + 2;
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(EVENT_COLORS[st.type]).multiplyScalar(1.8), transparent: true, opacity: 0.6, depthWrite: false }));
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = -Math.atan2(st.tx, st.tz);
      line.position.set(st.x, world.height(st.x, st.z) + 0.12, st.z);
      line.renderOrder = 2;
      this.group.add(line);
    }
  }

  refreshSign(st) {
    const old = st.sign.mat.map;
    st.sign.mat.map = signTexture(st, this.record(st), this.game.settings.units);
    st.sign.mat.emissiveMap = st.sign.mat.map;
    st.sign.mat.needsUpdate = true;
    old.dispose();
  }

  finish(st, value) {
    const game = this.game;
    const stars = starsFor(value, st.stars);
    const rec = this.record(st);
    const isRecord = !rec || value > rec.value;
    if (isRecord) {
      game.save.data.records[st.id] = { value, stars: Math.max(stars, rec ? rec.stars : 0) };
      game.save.write();
      this.refreshSign(st);
    }
    game.hud.setStunt(`<div class="t">${TYPE_LABEL[st.type]}</div><div class="v">${formatValue(st, value, game.settings.units)}</div><div class="stars">${starStr(stars)}</div>`);
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => game.hud.setStunt(''), 3500);
    game.hud.toast(`${TYPE_LABEL[st.type]}${isRecord ? ' — NEW RECORD' : ''}`, `${st.name}: ${formatValue(st, value, game.settings.units)}`, isRecord ? 'gold' : 'cyan');
    game.audio.ui(stars > 0 ? 'star' : 'notify');
    game.onStuntFinished?.(st, value, stars, isRecord);
  }

  update(dt) {
    const game = this.game;
    if (game.race.running) {
      this.active = null;
      this.hasPrev = false;
      return;
    }
    const p = game.player.physics;
    const pos = p.pos;
    const kmh = p.speed * 3.6;
    if (!this.hasPrev || this.prev.distanceToSquared(pos) > 40 * 40) {
      // first frame or a teleport (fast travel / reset): don't count line crossings
      this.prev.copy(pos);
      this.hasPrev = true;
      this.active = null;
      return;
    }
    // line crossing tests
    for (const st of this.stunts) {
      if (st.type === 'jump') continue;
      const d0 = (this.prev.x - st.x) * st.tx + (this.prev.z - st.z) * st.tz;
      const d1 = (pos.x - st.x) * st.tx + (pos.z - st.z) * st.tz;
      const lat = Math.abs((pos.x - st.x) * -st.tz + (pos.z - st.z) * st.tx);
      if (lat > st.width / 2 + 5) continue;
      if ((d0 < 0 && d1 >= 0) || (d0 > 0 && d1 <= 0)) {
        if (st.type === 'speed') this.finish(st, kmh);
        else if (!this.active) this.begin(st, d1 >= 0 ? 1 : -1);
      }
    }
    // active zone
    const A = this.active;
    if (A) {
      const st = A.st;
      A.time += dt;
      const along = ((pos.x - st.x) * st.tx + (pos.z - st.z) * st.tz) * A.dir;
      const near = game.world.network.nearest(pos.x, pos.z, 60);
      const off = !near || near.road !== st.road;
      if (off) A.off += dt;
      else A.off = 0;
      if (st.type === 'zone') {
        A.dist = Math.max(A.dist, along);
        const avg = (A.dist / Math.max(0.01, A.time)) * 3.6;
        game.hud.setStunt(`<div class="t">SPEED ZONE</div><div class="v">${formatValue(st, avg, game.settings.units)}</div><div class="stars">${starStr(starsFor(avg, st.stars))}</div>`);
        if (A.roadS === undefined) A.roadS = 0;
        const rs = near && near.road === st.road ? Math.abs(near.s - st.s) : A.roadS;
        A.roadS = rs;
        if (rs >= st.len) {
          this.finish(st, (st.len / A.time) * 3.6);
          this.active = null;
        }
      } else if (st.type === 'drift') {
        const d = game.skills.drift;
        if (d.active) A.live = d.score;
        else if (A.live > 0) {
          A.score += A.live;
          A.live = 0;
        }
        const total = A.score + (d.active ? d.score : 0);
        game.hud.setStunt(`<div class="t">DRIFT ZONE</div><div class="v">${formatNumber(total)}</div><div class="stars">${starStr(starsFor(total, st.stars))}</div>`);
        const rs = near && near.road === st.road ? Math.abs(near.s - st.s) : 0;
        if (rs >= st.len) {
          this.finish(st, Math.round(total));
          this.active = null;
        }
      }
      if (this.active && (A.off > 3 || A.time > 90)) {
        game.hud.setStunt('');
        game.hud.toast(TYPE_LABEL[st.type] + ' FAILED', 'You left the zone', 'cyan', 2000);
        this.active = null;
      }
    }
    // danger signs: arm when heading for the lip, measure the jump
    for (const st of this.stunts) {
      if (st.type !== 'jump') continue;
      const dx = pos.x - st.lip.x,
        dz = pos.z - st.lip.z;
      const along = dx * st.tx + dz * st.tz;
      const lat = Math.abs(-dx * st.tz + dz * st.tx);
      if (along > -8 && along < 3 && lat < 8 && p.grounded === 0 && kmh > 40 && !this.jump) {
        this.jump = { st, x: pos.x, z: pos.z, t: 0 };
      }
    }
    if (this.jump) {
      this.jump.t += dt;
      if (p.grounded >= 2 && this.jump.t > 0.3) {
        const dist = Math.hypot(pos.x - this.jump.x, pos.z - this.jump.z);
        this.finish(this.jump.st, dist);
        this.jump = null;
      } else if (this.jump.t > 12) this.jump = null;
    }
    this.prev.copy(pos);
  }

  begin(st, dir) {
    this.active = { st, dir, time: 0, dist: 0, score: 0, live: 0, off: 0 };
    this.game.audio.ui('notify');
    this.game.hud.toast(TYPE_LABEL[st.type], st.name, st.type === 'drift' ? 'purple' : 'cyan', 1800);
  }

  // stunts count toward map markers
  markers() {
    return this.stunts.map((s) => ({ x: s.x, z: s.z, type: s.type }));
  }
}

export function clampStars(n) {
  return clamp(n, 0, 3);
}
