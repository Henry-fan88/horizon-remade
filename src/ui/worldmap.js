// Full-screen world map: pan/zoom, event icons, player, online players, GPS + fast travel.
import { WORLD, PALETTE } from '../config.js';
import { drawIcon } from './hud.js';
import { clamp, formatTime } from '../core/math.js';
import { formatValue } from '../game/stunts.js';
import { escapeHtml } from '../game/race.js';
import { districtDestinations, cityDestinations } from '../world/districts.js';

export class WorldMap {
  constructor(game, mapImages) {
    this.game = game;
    this.img = mapImages.sat;
    this.el = document.createElement('div');
    this.el.className = 'worldmap';
    this.el.innerHTML = `<canvas></canvas>
      <div class="wm-title">WORLD MAP</div>
      <div class="wm-legend">
        <span><i style="background:${PALETTE.pink}"></i>Races</span>
        <span><i style="background:${PALETTE.cyan}"></i>Speed traps & zones</span>
        <span><i style="background:#b05cff"></i>Drift zones</span>
        <span><i style="background:${PALETTE.orange}"></i>Danger signs & bonus boards</span>
        <span><i style="background:#48f0a0"></i>Online players</span>
      </div>
      <div class="wm-help"><kbd>DRAG</kbd> pan · <kbd>WHEEL</kbd> zoom · <kbd>CLICK</kbd> select · <kbd>M</kbd>/<kbd>ESC</kbd> close</div>
      <div class="wm-destinations"><label for="wm-district">EXPLORE THE ISLAND</label><select id="wm-district"><option value="">Choose an environment</option></select></div>
      <div class="wm-panel"></div>`;
    this.canvas = this.el.querySelector('canvas');
    this.panel = this.el.querySelector('.wm-panel');
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 1;
    this.cx = 0;
    this.cz = 0;
    this.open = false;
    this.selected = null;
    this.drag = null;
    const districtSelect = this.el.querySelector('#wm-district');
    this.destinations = [...districtDestinations(game.world.network),...cityDestinations(game.world.network)].map(d => ({ ...d, kind: 'district', type: 'viewpoint' }));
    for (const d of this.destinations) {
      const option = document.createElement('option'); option.value = d.id; option.textContent = `${d.label} · ${d.name}`;
      districtSelect.append(option);
    }
    districtSelect.addEventListener('change', () => {
      const destination = this.destinations.find(d => d.id === districtSelect.value);
      if (!destination) return;
      this.cx = destination.x; this.cz = destination.z; this.zoom = 3.1;
      this.select(destination); this.draw();
    });
    districtSelect.addEventListener('keydown', e => e.stopPropagation());
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false, cx: this.cx, cz: this.cz };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      const mpp = this.metresPerPixel();
      this.cx = this.drag.cx - dx * mpp;
      this.cz = this.drag.cz - dy * mpp;
    });
    c.addEventListener('pointerup', (e) => {
      if (this.drag && !this.drag.moved) this.click(e.clientX, e.clientY);
      this.drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.screenToWorld(e.clientX, e.clientY);
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0015), 0.8, 8);
        const after = this.screenToWorld(e.clientX, e.clientY);
        this.cx += before[0] - after[0];
        this.cz += before[1] - after[1];
      },
      { passive: false }
    );
  }

  metresPerPixel() {
    const S = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) || 800;
    return WORLD.size / (S * this.zoom);
  }

  screenToWorld(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    const mpp = this.metresPerPixel();
    return [this.cx + (sx - r.left - r.width / 2) * mpp, this.cz + (sy - r.top - r.height / 2) * mpp];
  }

  worldToScreen(x, z) {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    const mpp = this.metresPerPixel();
    return [w / 2 + (x - this.cx) / mpp, h / 2 + (z - this.cz) / mpp];
  }

  show() {
    const game = this.game;
    document.getElementById('ui').appendChild(this.el);
    this.open = true;
    const p = game.player.physics.pos;
    this.cx = p.x;
    this.cz = p.z;
    this.zoom = 1.6;
    this.selected = null;
    this.panel.classList.remove('on');
    this.el.querySelector('#wm-district').value = '';
    requestAnimationFrame(() => this.el.classList.add('in'));
  }

  hide() {
    this.open = false;
    this.el.classList.remove('in');
    setTimeout(() => this.el.remove(), 200);
  }

  items() {
    const game = this.game;
    const out = [];
    out.push(...this.destinations);
    for (const r of game.events.races) out.push({ kind: 'race', type: r.type === 'dirt' ? 'dirt' : r.type === 'drag' ? 'drag' : 'race', x: r.marker.x, z: r.marker.z, name: r.name, ref: r });
    for (const s of game.events.stunts) out.push({ kind: 'stunt', type: s.type, x: s.x, z: s.z, name: s.name, ref: s });
    out.push({ kind: 'festival', type: 'festival', x: game.festivalPos.x, z: game.festivalPos.z, name: 'Festival Site' });
    if (game.viewpoint) out.push({ kind: 'poi', type: 'viewpoint', x: game.viewpoint.x, z: game.viewpoint.z, name: 'Volcán Viewpoint' });
    return out;
  }

  click(sx, sy) {
    const items = this.items();
    let best = null,
      bd = 22 * 22;
    for (const it of items) {
      const [x, y] = this.worldToScreen(it.x, it.z);
      const r = this.canvas.getBoundingClientRect();
      const d = (x + r.left - sx) ** 2 + (y + r.top - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (best) this.select(best);
    else {
      const [x, z] = this.screenToWorld(sx, sy);
      this.select({ kind: 'waypoint', type: 'waypoint', x, z, name: 'Custom waypoint' });
    }
  }

  select(it) {
    const game = this.game;
    this.selected = it;
    game.audio.ui('move');
    let info = '';
    if (it.kind === 'race') {
      const r = it.ref;
      const rec = game.save.data.raceRecords[r.id];
      info = `<div class="k">${r.series.toUpperCase()}</div><div class="t">${escapeHtml(r.name)}</div><div class="s">${r.type.toUpperCase()} · ${(r.distance / 1000).toFixed(1)} km${r.laps > 1 ? ' · ' + r.laps + ' laps' : ''}</div><div class="s">${rec ? 'Best: ' + formatTime(rec.time) : 'Not completed'}</div>`;
    } else if (it.kind === 'stunt') {
      const s = it.ref;
      const rec = game.save.data.records[s.id];
      info = `<div class="k">PR STUNT</div><div class="t">${escapeHtml(s.name)}</div><div class="s">${rec ? 'Best: ' + formatValue(s, rec.value, game.settings.units) + ' ' + '★'.repeat(rec.stars) : 'No record yet'}</div>`;
    } else info = `<div class="k">${it.kind === 'district' ? escapeHtml(it.label.toUpperCase()) : 'LOCATION'}</div><div class="t">${escapeHtml(it.name)}</div>${it.description ? `<div class="s">${escapeHtml(it.description)}</div>` : ''}`;
    this.panel.innerHTML = `${info}<div class="a"></div>`;
    const a = this.panel.querySelector('.a');
    const btn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'btn small ' + cls;
      b.textContent = label;
      b.onclick = fn;
      a.appendChild(b);
    };
    btn('SET ROUTE', 'primary', () => {
      game.setRouteTo(it.x, it.z, it.name);
      game.closeMap();
    });
    btn('FAST TRAVEL', '', () => {
      game.closeMap();
      if (it.kind === 'race') game.startRace(it.ref, true);
      else if (it.kind === 'stunt') game.fastTravelTo(it.x - (it.ref.tx || 0) * 150, it.z - (it.ref.tz || 0) * 150, Math.atan2(it.ref.tx || 0, it.ref.tz || 1));
      else if (it.kind === 'festival') game.fastTravelFestival();
      else game.fastTravelTo(it.x, it.z, it.heading ?? game.player.physics.heading);
    });
    this.panel.classList.add('on');
  }

  update(dt, input) {
    if (!this.open) return;
    const game = this.game;
    const nav = input.menuNav();
    const mpp = this.metresPerPixel();
    const pan = 400 * mpp * dt * 60;
    if (input.key('left')) this.cx -= pan * 0.1;
    if (input.key('right')) this.cx += pan * 0.1;
    if (input.key('throttle')) this.cz -= pan * 0.1;
    if (input.key('brake')) this.cz += pan * 0.1;
    void nav;
    const gp = input.gamepad;
    if (gp) {
      this.cx += (gp.axes[0] || 0) * pan * 0.12;
      this.cz += (gp.axes[1] || 0) * pan * 0.12;
      if (gp.buttons[7]?.value > 0.2) this.zoom = clamp(this.zoom * (1 + dt * 1.5), 0.8, 8);
      if (gp.buttons[6]?.value > 0.2) this.zoom = clamp(this.zoom * (1 - dt * 1.5), 0.8, 8);
    }
    if (input.hit('accept') && !this.selected) {
      const r = this.canvas.getBoundingClientRect();
      this.click(r.left + r.width / 2, r.top + r.height / 2);
    }
    this.draw();
  }

  draw() {
    const c = this.canvas;
    const d = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth,
      H = c.clientHeight;
    if (c.width !== Math.floor(W * d) || c.height !== Math.floor(H * d)) {
      c.width = Math.floor(W * d);
      c.height = Math.floor(H * d);
    }
    const g = this.ctx;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = '#0e3b52';
    g.fillRect(0, 0, W, H);
    const mpp = this.metresPerPixel();
    const [x0, y0] = this.worldToScreen(-WORLD.size / 2, -WORLD.size / 2);
    const size = WORLD.size / mpp;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.img, x0, y0, size, size);
    // grid lines
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    const half = WORLD.size / 2;
    for (let k = -half; k <= half; k += 512) {
      const [ax, ay] = this.worldToScreen(k, -half),
        [bx, by] = this.worldToScreen(k, half);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      const [cx, cy] = this.worldToScreen(-half, k),
        [ex, ey] = this.worldToScreen(half, k);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(ex, ey);
      g.stroke();
    }
    const game = this.game;
    // GPS route
    if (game.gpsRoute) {
      g.strokeStyle = PALETTE.pink;
      g.lineWidth = 4;
      g.lineJoin = 'round';
      g.beginPath();
      game.gpsRoute.forEach(([x, z], i) => {
        const [sx, sy] = this.worldToScreen(x, z);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      });
      g.stroke();
    }
    // boards
    for (const b of game.boards || []) {
      if (!b.alive) continue;
      const [sx, sy] = this.worldToScreen(b.x, b.z);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      drawIcon(g, 'board', sx, sy, 0.9);
    }
    for (const it of this.items()) {
      const [sx, sy] = this.worldToScreen(it.x, it.z);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      drawIcon(g, it.type, sx, sy, this.selected === it ? 1.6 : 1.25);
      if (it.kind === 'district') {
        g.font = '600 13px Barlow, sans-serif'; g.textAlign = 'center';
        g.lineWidth = 4; g.strokeStyle = '#172321'; g.strokeText(it.name, sx, sy - 21);
        g.fillStyle = '#f1ead6'; g.fillText(it.name, sx, sy - 21);
      }
    }
    if (this.selected && this.selected.kind === 'waypoint') {
      const [sx, sy] = this.worldToScreen(this.selected.x, this.selected.z);
      g.fillStyle = PALETTE.pink;
      g.beginPath();
      g.arc(sx, sy, 7, 0, Math.PI * 2);
      g.fill();
    }
    // online players
    for (const o of game.net.mapPlayers()) {
      const [sx, sy] = this.worldToScreen(o.x, o.z);
      g.fillStyle = o.color;
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = '600 12px Barlow, sans-serif';
      g.textAlign = 'center';
      g.fillText(o.name, sx, sy - 12);
    }
    // player arrow
    const p = game.player.physics;
    const [px, py] = this.worldToScreen(p.pos.x, p.pos.z);
    g.save();
    g.translate(px, py);
    g.rotate(Math.atan2(Math.cos(p.heading), Math.sin(p.heading)) + Math.PI / 2);
    g.fillStyle = '#fff';
    g.strokeStyle = PALETTE.pink;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // crosshair
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(W / 2 - 10, H / 2);
    g.lineTo(W / 2 + 10, H / 2);
    g.moveTo(W / 2, H / 2 - 10);
    g.lineTo(W / 2, H / 2 + 10);
    g.stroke();
  }
}
