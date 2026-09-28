// In-game HUD: tachometer/speedometer, rotating minimap, skill chain, toasts, prompts.
import { clamp, formatNumber } from '../core/math.js';
import { WORLD, PALETTE } from '../config.js';

const DPR = () => Math.min(2, window.devicePixelRatio || 1);

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// ---------------------------------------------------------------- speedometer
export class Speedo {
  constructor(parent) {
    this.canvas = el('canvas', 'speedo', parent);
    this.size = 250;
    this.setup();
    this.rpmSmooth = 0;
    this.speedShown = 0;
  }
  setup() {
    const d = DPR();
    this.canvas.width = this.size * d;
    this.canvas.height = this.size * d;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  draw(speedKmh, rpm, maxRpm, redline, gear, units, shiftFlash, boost) {
    const g = this.ctx;
    const S = this.size;
    g.clearRect(0, 0, S, S);
    const cx = S / 2,
      cy = S / 2 + 6,
      R = S * 0.4;
    const a0 = Math.PI * 0.75,
      sweep = Math.PI * 1.5;
    const top = Math.ceil(maxRpm / 1000) * 1000;
    const toA = (r) => a0 + (clamp(r, 0, top) / top) * sweep;
    this.rpmSmooth += (rpm - this.rpmSmooth) * 0.35;
    // backdrop
    const bg = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.25);
    bg.addColorStop(0, 'rgba(8,8,14,0.55)');
    bg.addColorStop(0.75, 'rgba(8,8,14,0.35)');
    bg.addColorStop(1, 'rgba(8,8,14,0)');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(cx, cy, R * 1.25, 0, Math.PI * 2);
    g.fill();
    // base arc
    g.lineCap = 'butt';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(cx, cy, R, a0, a0 + sweep);
    g.stroke();
    // redline zone
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(255,40,70,0.85)';
    g.beginPath();
    g.arc(cx, cy, R - 3, toA(redline), a0 + sweep);
    g.stroke();
    // active rpm arc
    const hot = this.rpmSmooth > redline * 0.92;
    g.lineWidth = 9;
    g.shadowColor = hot ? PALETTE.pink : 'rgba(255,255,255,0.8)';
    g.shadowBlur = 12;
    const grd = g.createLinearGradient(cx - R, cy, cx + R, cy);
    grd.addColorStop(0, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, hot ? PALETTE.pink : '#ffffff');
    g.strokeStyle = grd;
    g.beginPath();
    g.arc(cx, cy, R - 12, a0, toA(this.rpmSmooth));
    g.stroke();
    g.shadowBlur = 0;
    // ticks + numbers
    g.fillStyle = '#fff';
    g.font = '600 italic 15px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let r = 0; r <= top; r += 500) {
      const a = toA(r);
      const major = r % 1000 === 0;
      const r0 = R + 2,
        r1 = R + (major ? 10 : 6);
      g.strokeStyle = r >= redline ? 'rgba(255,60,90,1)' : 'rgba(255,255,255,0.9)';
      g.lineWidth = major ? 2.5 : 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
      if (major) {
        const rn = R - 26;
        g.fillStyle = r >= redline ? '#ff4d6d' : 'rgba(255,255,255,0.85)';
        g.fillText(String(r / 1000), cx + Math.cos(a) * rn, cy + Math.sin(a) * rn);
      }
    }
    // needle
    const na = toA(this.rpmSmooth);
    g.strokeStyle = hot ? PALETTE.pink : '#ffffff';
    g.lineWidth = 3;
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(na) * (R - 38), cy + Math.sin(na) * (R - 38));
    g.lineTo(cx + Math.cos(na) * (R + 4), cy + Math.sin(na) * (R + 4));
    g.stroke();
    g.shadowBlur = 0;
    // speed
    const v = units === 'mph' ? speedKmh * 0.621371 : speedKmh;
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 10;
    g.font = '700 italic 64px "Barlow Condensed", sans-serif';
    g.fillText(String(Math.round(v)), cx, cy - 4);
    g.shadowBlur = 0;
    g.font = '600 13px "Barlow", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(units === 'mph' ? 'MPH' : 'KM/H', cx, cy + 30);
    // gear
    const gy = cy + R * 0.82;
    g.fillStyle = shiftFlash > 0 ? PALETTE.pink : 'rgba(255,255,255,0.12)';
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2;
    roundRect(g, cx - 19, gy - 19, 38, 38, 7);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    g.font = '700 italic 28px "Barlow Condensed", sans-serif';
    g.fillText(gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear), cx, gy + 1);
    if (boost !== undefined && boost >= 0) {
      // small turbo pressure arc
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.2)';
      g.beginPath();
      g.arc(cx, cy, R * 0.52, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      g.strokeStyle = PALETTE.cyan;
      g.beginPath();
      g.arc(cx, cy, R * 0.52, Math.PI * 1.15, Math.PI * (1.15 + 0.7 * clamp(boost, 0, 1)));
      g.stroke();
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------- icons
export function drawIcon(g, type, x, y, s = 1, color = null) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const col =
    color ||
    { race: PALETTE.pink, circuit: PALETTE.pink, sprint: PALETTE.pink, dirt: '#e0a040', drift: PALETTE.purple, speed: PALETTE.cyan, zone: PALETTE.cyan, jump: PALETTE.orange, festival: PALETTE.pink, board: PALETTE.orange, player: '#ffffff', online: '#48f0a0', viewpoint: '#ffffff', drag: PALETTE.yellow }[type] ||
    '#fff';
  g.fillStyle = 'rgba(10,10,16,0.85)';
  g.strokeStyle = col;
  g.lineWidth = 2;
  if (type === 'board') {
    g.fillStyle = col;
    g.fillRect(-4, -4, 8, 8);
    g.restore();
    return;
  }
  g.beginPath();
  g.arc(0, 0, 9, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = 1.6;
  switch (type) {
    case 'race':
    case 'circuit':
    case 'sprint':
    case 'dirt':
    case 'drag':
      // checkered flag
      g.beginPath();
      g.moveTo(-4, 6);
      g.lineTo(-4, -6);
      g.stroke();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) g.fillRect(-3 + i * 2.6, -6 + j * 2.6, 2.6, 2.6);
      g.strokeRect(-3, -6, 7.8, 5.2);
      break;
    case 'drift':
      g.beginPath();
      g.moveTo(-5, 5);
      g.bezierCurveTo(-5, -2, 5, 2, 5, -5);
      g.lineWidth = 2.4;
      g.stroke();
      break;
    case 'speed':
    case 'zone':
      g.beginPath();
      g.arc(0, 2, 5.5, Math.PI, 0);
      g.stroke();
      g.beginPath();
      g.moveTo(0, 2);
      g.lineTo(3.5, -2.5);
      g.stroke();
      break;
    case 'jump':
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(6, 5);
      g.lineTo(-6, 5);
      g.closePath();
      g.stroke();
      g.fillRect(-0.8, -2, 1.6, 4);
      break;
    case 'festival':
      g.beginPath();
      g.arc(0, 2, 5.5, Math.PI, 0);
      g.fill();
      g.fillRect(-7, 3, 14, 1.8);
      break;
    case 'viewpoint':
      g.beginPath();
      g.moveTo(-6, 4);
      g.lineTo(-1, -4);
      g.lineTo(2, 1);
      g.lineTo(4, -1);
      g.lineTo(7, 4);
      g.closePath();
      g.fill();
      break;
    default:
      g.beginPath();
      g.arc(0, 0, 3.5, 0, Math.PI * 2);
      g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- minimap
export class Minimap {
  constructor(parent, mapImages) {
    this.canvas = el('canvas', 'minimap', parent);
    this.size = 210;
    this.img = mapImages.dark;
    this.imgSize = mapImages.size;
    this.zoom = 560;
    const d = DPR();
    this.canvas.width = this.size * d;
    this.canvas.height = this.size * d;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }

  draw(player, heading, speedKmh, route, markers, others) {
    const g = this.ctx;
    const S = this.size;
    const c = S / 2;
    g.clearRect(0, 0, S, S);
    this.zoom += (clamp(480 + speedKmh * 1.8, 480, 1000) - this.zoom) * 0.03;
    const mPerPx = this.zoom / S;
    const pxScale = this.imgSize / WORLD.size; // image px per metre
    g.save();
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#10283a';
    g.fillRect(0, 0, S, S);
    g.translate(c, c);
    // rotate so heading points up
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(heading), Math.sin(heading));
    g.rotate(rot);
    const k = 1 / mPerPx / pxScale; // image px -> screen px
    g.scale(k, k);
    const ix = (player.x + WORLD.size / 2) * pxScale,
      iz = (player.z + WORLD.size / 2) * pxScale;
    g.globalAlpha = 0.96;
    g.drawImage(this.img, -ix, -iz);
    g.globalAlpha = 1;
    // route
    if (route && route.length > 1) {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,45,135,0.45)';
      g.lineWidth = 9 / k;
      g.beginPath();
      for (let i = 0; i < route.length; i++) {
        const X = (route[i][0] + WORLD.size / 2) * pxScale - ix,
          Y = (route[i][1] + WORLD.size / 2) * pxScale - iz;
        if (i === 0) g.moveTo(X, Y);
        else g.lineTo(X, Y);
      }
      g.stroke();
      g.strokeStyle = PALETTE.pink;
      g.lineWidth = 4.2 / k;
      g.stroke();
    }
    g.restore();
    // markers (drawn upright)
    const cosr = Math.cos(rot),
      sinr = Math.sin(rot);
    const place = (wx, wz) => {
      const dx = (wx - player.x) / mPerPx,
        dz = (wz - player.z) / mPerPx;
      return [c + dx * cosr - dz * sinr, c + dx * sinr + dz * cosr];
    };
    if (markers)
      for (const m of markers) {
        let [sx, sy] = place(m.x, m.z);
        const dx = sx - c,
          dy = sy - c;
        const d = Math.hypot(dx, dy);
        const lim = c - 14;
        if (d > lim) {
          if (!m.pin) continue;
          sx = c + (dx / d) * lim;
          sy = c + (dy / d) * lim;
        }
        drawIcon(g, m.type, sx, sy, m.big ? 1.15 : 0.9);
      }
    if (others)
      for (const o of others) {
        let [sx, sy] = place(o.x, o.z);
        const d = Math.hypot(sx - c, sy - c);
        if (d > c - 10) {
          sx = c + ((sx - c) / d) * (c - 10);
          sy = c + ((sy - c) / d) * (c - 10);
        }
        g.fillStyle = o.color || '#48f0a0';
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(sx, sy, o.ai ? 3.5 : 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    // player arrow
    g.save();
    g.translate(c, c);
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 6;
    g.fillStyle = '#fff';
    g.strokeStyle = PALETTE.pink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // north indicator on the rim
    const na = rot - Math.PI / 2;
    const nx = c + Math.cos(na) * (c - 12),
      ny = c + Math.sin(na) * (c - 12);
    g.fillStyle = 'rgba(10,10,16,0.85)';
    g.beginPath();
    g.arc(nx, ny, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '700 12px "Barlow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
    // rim
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.stroke();
  }
}

// ---------------------------------------------------------------- HUD container
export class HUD {
  constructor(root, mapImages) {
    this.root = el('div', 'hud', root);
    this.speedo = new Speedo(this.root);
    this.minimap = new Minimap(this.root, mapImages);
    this.chain = el('div', 'skill-chain', this.root);
    this.chainScore = el('div', 'chain-score', this.chain);
    this.chainMult = el('div', 'chain-mult', this.chain);
    this.chainSkill = el('div', 'chain-skill', this.chain);
    this.chainBar = el('div', 'chain-bar', this.chain, '<i></i>');
    this.toasts = el('div', 'toasts', this.root);
    this.prompt = el('div', 'prompt', this.root);
    this.center = el('div', 'center-msg', this.root);
    this.race = el('div', 'race-info', this.root);
    this.topRight = el('div', 'top-right', this.root);
    this.fps = el('div', 'fps', this.root);
    this.road = el('div', 'road-name', this.root);
    this.stunt = el('div', 'stunt-meter', this.root);
    this.visible = true;
    this.lastRoad = '';
    this.shiftFlash = 0;
  }

  show(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  update(dt, s) {
    if (!this.visible) return;
    this.shiftFlash = Math.max(0, this.shiftFlash - dt);
    this.speedo.draw(s.speedKmh, s.rpm, s.maxRpm, s.redline, s.gear, s.units, this.shiftFlash, s.boost);
    this.minimap.draw(s.pos, s.heading, s.speedKmh, s.route, s.markers, s.others);
    this.fps.textContent = s.showFps ? `${Math.round(s.fps)} FPS` : '';
  }

  setRoadName(name) {
    if (name === this.lastRoad) return;
    this.lastRoad = name;
    this.road.textContent = name || '';
    this.road.classList.remove('pop');
    void this.road.offsetWidth;
    if (name) this.road.classList.add('pop');
  }

  toast(title, sub = '', kind = 'info', ms = 3200) {
    const t = el('div', 'toast ' + kind, this.toasts);
    el('div', 'toast-title', t, title);
    if (sub) el('div', 'toast-sub', t, sub);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      t.classList.add('out');
      setTimeout(() => t.remove(), 500);
    }, ms);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  setPrompt(html) {
    if (this._prompt === html) return;
    this._prompt = html;
    this.prompt.innerHTML = html || '';
    this.prompt.classList.toggle('on', !!html);
  }

  bigMessage(text, sub = '', ms = 1600, cls = '') {
    this.center.innerHTML = `<div class="big ${cls}">${text}</div>${sub ? `<div class="big-sub">${sub}</div>` : ''}`;
    this.center.classList.remove('on');
    void this.center.offsetWidth;
    this.center.classList.add('on');
    clearTimeout(this._bigT);
    if (ms > 0) this._bigT = setTimeout(() => this.center.classList.remove('on'), ms);
  }

  clearBig() {
    this.center.classList.remove('on');
  }

  // skill chain display
  setChain(state) {
    if (!state || !state.active) {
      this.chain.classList.remove('on');
      return;
    }
    this.chain.classList.add('on');
    this.chainScore.textContent = formatNumber(state.total);
    this.chainMult.textContent = 'x' + state.mult;
    if (state.skillName !== this._skill) {
      this._skill = state.skillName;
      this.chainSkill.textContent = state.skillName;
      this.chainSkill.classList.remove('pop');
      void this.chainSkill.offsetWidth;
      this.chainSkill.classList.add('pop');
    }
    this.chainSkill.dataset.pts = state.skillPts ? '+' + formatNumber(state.skillPts) : '';
    this.chainBar.firstChild.style.width = `${clamp(state.timer, 0, 1) * 100}%`;
  }

  chainResult(text, pts, good) {
    const t = el('div', 'chain-result ' + (good ? 'good' : 'bad'), this.root);
    t.innerHTML = `<div>${text}</div>${pts !== null ? `<b>${good ? '+' : ''}${formatNumber(pts)}</b>` : ''}`;
    setTimeout(() => t.remove(), 2200);
  }

  setTopRight(html) {
    if (this._tr === html) return;
    this._tr = html;
    this.topRight.innerHTML = html;
  }

  setRaceInfo(html) {
    if (this._ri === html) return;
    this._ri = html;
    this.race.innerHTML = html || '';
    this.race.classList.toggle('on', !!html);
  }

  setStunt(html) {
    if (this._st === html) return;
    this._st = html;
    this.stunt.innerHTML = html || '';
    this.stunt.classList.toggle('on', !!html);
  }
}
