// Menus: title, name entry, festival pause menu (tabs), results, wheelspin, dialogs.
import { GAME_TITLE, GAME_SUBTITLE, GAME_TAGLINE, FESTIVAL_NAME, PALETTE, WORLD_SETTINGS } from '../config.js';
import { CARS, CAR_BY_ID, PAINTS, RIM_COLORS } from '../vehicle/carspecs.js';
import { carThumb } from './thumbs.js';
import { formatNumber, formatTime, mulberry32 } from '../core/math.js';
import { formatValue } from '../game/stunts.js';
import { escapeHtml, ordinal } from '../game/race.js';
import { CAMERA_MODES } from '../game/camera.js';

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function piBadge(spec) {
  const c = spec.cls;
  return h('span', { class: 'pi-badge' }, h('b', { style: `background:${c.color}` }, c.id), h('i', {}, String(spec.pi)));
}

function statBar(label, v) {
  return h('div', { class: 'stat' }, h('span', {}, label), h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(4, Math.min(100, v * 10))}%` })), h('em', {}, v.toFixed(1)));
}

function modelCredit() {
  return h('span', { class: 'model-credit' },
    h('a', { href: `${import.meta.env.BASE_URL}models/credits.html`, target: '_blank', rel: 'noopener noreferrer' }, '3D model credits · CC BY 4.0'));
}

export class Menus {
  constructor(game) {
    this.game = game;
    this.root = h('div', { class: 'menus' });
    document.getElementById('ui').appendChild(this.root);
    this.layer = null;
    this.tab = 'festival';
  }

  get open() {
    return !!this.layer;
  }

  close() {
    if (this.layer) {
      const l = this.layer;
      l.classList.add('closing');
      setTimeout(() => l.remove(), 250);
    }
    this.layer = null;
    this.onClose?.();
    this.onClose = null;
  }

  mount(el) {
    if (this.layer) this.layer.remove();
    this.layer = el;
    this.root.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add('in');
      this.focusFirst();
    });
  }

  // ------------------------------------------------------------ focus navigation
  focusables() {
    if (!this.layer) return [];
    return [...this.layer.querySelectorAll('.focusable:not([disabled])')].filter((e) => e.offsetParent !== null);
  }

  focusFirst() {
    const f = this.focusables();
    const pref = this.layer?.querySelector('.focusable.primary') || f[0];
    pref?.focus({ preventScroll: !!this.layer?.querySelector('.controls') });
  }

  navigate(dx, dy) {
    const list = this.focusables();
    if (!list.length) return;
    const cur = document.activeElement;
    if (!list.includes(cur)) {
      list[0].focus();
      return;
    }
    const r0 = cur.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null,
      bestScore = Infinity;
    for (const e of list) {
      if (e === cur) continue;
      const r = e.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const vx = c.x - c0.x,
        vy = c.y - c0.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const score = along + perp * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      this.game.audio.ui('move');
    }
  }

  handleInput(input) {
    if (!this.layer) return;
    const nav = input.menuNav();
    if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'range') {
      if (input.hit('pause')) this.back();
      return;
    }
    if (nav.x || nav.y) this.navigate(nav.x, nav.y);
    if (input.padHit('accept')) document.activeElement?.click();
    if (input.hit('back') || input.hit('pause') || input.padHit('back')) this.back();
    if (this.layer?.dataset.tabs && (input.padHit('shiftUp') || input.padHit('shiftDown'))) {
      const tabs = JSON.parse(this.layer.dataset.tabs);
      const i = tabs.indexOf(this.tab);
      const ni = (i + (input.padHit('shiftUp') ? 1 : -1) + tabs.length) % tabs.length;
      this.openPause(tabs[ni]);
    }
  }

  back() {
    if (!this.layer) return;
    if (this.layer.dataset.noback) return;
    this.game.audio.ui('back');
    const fn = this.backAction;
    this.backAction = null;
    if (fn) fn();
    else this.close();
  }

  // ------------------------------------------------------------ title
  showTitle(onStart) {
    const el = h(
      'div',
      { class: 'screen title-screen', 'data-noback': '1' },
      h(
        'div',
        { class: 'title-logo' },
        h('div', { class: 'logo-sun' }),
        h('div', { class: 'logo-word' }, GAME_TITLE),
        h('div', { class: 'logo-sub' }, GAME_SUBTITLE),
        h('div', { class: 'title-tag' }, GAME_TAGLINE)
      ),
      h('button', { class: 'press-start focusable primary', onclick: () => onStart() }, h('span', {}, 'PRESS '), h('kbd', {}, 'ENTER'), h('span', {}, ' OR CLICK TO START')),
      h('div', { class: 'title-foot' }, h('span', {}, 'A fan-made festival racer'), modelCredit(), h('span', { class: 'net-status' }, ''))
    );
    this.mount(el);
    this.titleEl = el;
  }

  askName(defaultName, onDone) {
    const input = h('input', { class: 'name-input focusable primary', maxlength: '16', value: defaultName, spellcheck: 'false' });
    const done = () => {
      const n = input.value.replace(/[^\w .\-]/g, '').trim().slice(0, 16) || defaultName;
      this.game.input.textFocus = false;
      onDone(n);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done();
    });
    input.addEventListener('focus', () => (this.game.input.textFocus = true));
    input.addEventListener('blur', () => (this.game.input.textFocus = false));
    const el = h(
      'div',
      { class: 'screen dialog-screen', 'data-noback': '1' },
      h(
        'div',
        { class: 'dialog wide' },
        h('div', { class: 'dialog-kicker' }, `WELCOME TO THE ${FESTIVAL_NAME.toUpperCase()}`),
        h('div', { class: 'dialog-title' }, 'What should we call you?'),
        h('p', {}, 'This is your driver name. Other players see it above your car when you play online.'),
        input,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary focusable', onclick: done }, "LET'S GO"))
      )
    );
    this.mount(el);
    setTimeout(() => input.focus(), 60);
  }

  // ------------------------------------------------------------ pause menu
  openPause(tab = this.tab) {
    this.tab = tab;
    const game = this.game;
    const tabs = [
      ['festival', 'FESTIVAL'],
      ['events', 'EVENTS'],
      ['garage', 'MY CARS'],
      ['autoshow', 'AUTOSHOW'],
      ['online', 'ONLINE'],
      ['settings', 'SETTINGS'],
    ];
    const d = game.save.data;
    const lp = game.progression.levelProgress();
    const header = h(
      'div',
      { class: 'menu-header' },
      h('div', { class: 'menu-brand' }, h('b', {}, GAME_TITLE), ' ', GAME_SUBTITLE),
      h(
        'div',
        { class: 'menu-tabs' },
        tabs.map(([id, label]) =>
          h(
            'button',
            {
              class: 'tab focusable' + (id === tab ? ' active' : ''),
              onclick: () => {
                game.audio.ui('select');
                this.openPause(id);
              },
            },
            label
          )
        )
      ),
      h(
        'div',
        { class: 'menu-profile' },
        h('div', { class: 'pname' }, escapeHtml(d.name || 'Driver')),
        h('div', { class: 'plevel' }, `LEVEL ${lp.level}`, h('div', { class: 'xpbar' }, h('i', { style: `width:${Math.round(lp.frac * 100)}%` }))),
        h('div', { class: 'pcr' }, `${formatNumber(d.credits)} CR`)
      )
    );
    const body = h('div', { class: 'menu-body' });
    const el = h('div', { class: 'screen menu', 'data-tabs': JSON.stringify(tabs.map((t) => t[0])) }, header, body, h('div', { class: 'menu-foot' }, h('span', {}, h('kbd', {}, 'ESC'), ' Back'), h('span', {}, h('kbd', {}, '↑↓←→'), ' Navigate'), h('span', {}, h('kbd', {}, 'ENTER'), ' Select'), modelCredit()));
    this[`tab_${tab}`](body);
    this.backAction = null;
    this.mount(el);
    this.onClose = () => game.onMenuClosed?.();
  }

  tab_festival(body) {
    const game = this.game;
    const d = game.save.data;
    const car = CAR_BY_ID[game.save.currentCar.id];
    const tile = (title, sub, cls, fn, primary = false) =>
      h('button', { class: `tile focusable ${cls}${primary ? ' primary' : ''}`, onclick: fn }, h('div', { class: 'tile-title' }, title), h('div', { class: 'tile-sub' }, sub));
    body.append(
      h(
        'div',
        { class: 'tiles' },
        tile('RESUME', game.race.running ? 'Back to the race' : 'Back to free roam', 'big pink', () => this.close(), true),
        game.race.running ? tile('RESTART RACE', 'Start this event again', 'orange', () => game.restartRace()) : null,
        game.race.running ? tile('QUIT RACE', 'Return to free roam', 'dark', () => game.quitRace()) : null,
        tile(`WHEELSPIN`, d.wheelspins > 0 ? `${d.wheelspins} spin${d.wheelspins > 1 ? 's' : ''} available` : 'Level up to earn spins', 'purple' + (d.wheelspins > 0 ? ' glow' : ''), () => this.openWheelspin()),
        tile('WORLD MAP', 'Set a route · fast travel', 'cyan', () => {
          this.close();
          game.openMap();
        }),
        tile('FESTIVAL SITE', 'Fast travel to the festival', 'dark', () => {
          this.close();
          game.fastTravelFestival();
        }),
        h(
          'div',
          { class: 'tile car-tile' },
          h('img', { src: carThumb(car, game.save.currentCar.paint) }),
          h('div', { class: 'tile-title' }, car.name),
          h('div', { class: 'tile-sub' }, piBadge(car), ` ${car.year} · ${car.drive} · ${Math.round(car.powerKW * 1.341)} HP`)
        ),
        h(
          'div',
          { class: 'tile stats-tile' },
          h('div', { class: 'tile-title' }, 'FESTIVAL STATS'),
          h('div', { class: 'kv' }, ...[
            ['Races won', d.stats.racesWon],
            ['Races finished', d.stats.racesDone],
            ['Top speed', `${Math.round(d.stats.topSpeed)} km/h`],
            ['Distance', `${(d.stats.distance / 1000).toFixed(1)} km`],
            ['Skill points', formatNumber(d.stats.skillPts)],
            ['Bonus boards', `${d.boards.length} / ${game.boardsTotal || 0}`],
          ].map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, String(v)))))
        ),
        tile('CONTROLS', 'Keyboard, mouse & gamepad', 'dark', () => this.openControls()),
        tile('QUIT TO TITLE', 'Save and return to the title screen', 'dark', () => game.quitToTitle())
      )
    );
  }

  tab_events(body) {
    const game = this.game;
    const list = h('div', { class: 'event-list' });
    const races = game.events.races;
    list.append(h('div', { class: 'list-head' }, 'RACES'));
    for (const r of races) {
      const rec = game.save.data.raceRecords[r.id];
      list.append(
        h(
          'div',
          { class: 'event-row' },
          h('div', { class: 'ev-icon', style: `--c:${r.type === 'dirt' ? '#e0a040' : r.type === 'drag' ? PALETTE.yellow : PALETTE.pink}` }, r.type === 'circuit' ? '◯' : r.type === 'drag' ? '⇥' : '➤'),
          h('div', { class: 'ev-main' }, h('div', { class: 'ev-name' }, r.name), h('div', { class: 'ev-sub' }, `${r.series} · ${r.type.toUpperCase()} · ${(r.distance / 1000).toFixed(1)} km${r.laps > 1 ? ` · ${r.laps} laps` : ''}`)),
          h('div', { class: 'ev-rec' }, rec ? `BEST ${formatTime(rec.time)} · ${ordinal(rec.pos)}` : 'NOT COMPLETED'),
          h('button', { class: 'btn small focusable', onclick: () => (this.close(), game.setRouteTo(r.marker.x, r.marker.z, r.name)) }, 'SET ROUTE'),
          h('button', { class: 'btn small primary focusable', onclick: () => (this.close(), game.startRace(r, true)) }, 'START')
        )
      );
    }
    list.append(h('div', { class: 'list-head' }, 'PR STUNTS'));
    for (const s of game.events.stunts) {
      const rec = game.save.data.records[s.id];
      const label = { speed: 'SPEED TRAP', zone: 'SPEED ZONE', drift: 'DRIFT ZONE', jump: 'DANGER SIGN' }[s.type];
      list.append(
        h(
          'div',
          { class: 'event-row' },
          h('div', { class: 'ev-icon', style: `--c:${s.type === 'drift' ? '#b05cff' : s.type === 'jump' ? PALETTE.orange : PALETTE.cyan}` }, s.type === 'jump' ? '▲' : s.type === 'drift' ? '∿' : '◔'),
          h('div', { class: 'ev-main' }, h('div', { class: 'ev-name' }, s.name), h('div', { class: 'ev-sub' }, label)),
          h('div', { class: 'ev-rec' }, rec ? `${formatValue(s, rec.value, game.settings.units)} ${'★'.repeat(rec.stars)}` : 'NO RECORD'),
          h('button', { class: 'btn small focusable', onclick: () => (this.close(), game.setRouteTo(s.x, s.z, s.name)) }, 'SET ROUTE'),
          h('button', { class: 'btn small primary focusable', onclick: () => (this.close(), game.fastTravelTo(s.x - s.tx * 150, s.z - s.tz * 150, Math.atan2(s.tx, s.tz))) }, 'TRAVEL')
        )
      );
    }
    body.append(list);
  }

  tab_garage(body) {
    const game = this.game;
    const d = game.save.data;
    const grid = h('div', { class: 'car-grid' });
    d.garage.forEach((g, i) => {
      const spec = CAR_BY_ID[g.id];
      grid.append(
        h(
          'button',
          {
            class: 'car-card focusable' + (i === d.current ? ' current primary' : ''),
            onclick: () => {
              game.audio.ui('select');
              this.openCarDetail(i);
            },
          },
          h('img', { src: carThumb(spec, g.paint), loading: 'lazy' }),
          h('div', { class: 'cc-name' }, spec.name),
          h('div', { class: 'cc-sub' }, piBadge(spec), i === d.current ? h('span', { class: 'cc-tag' }, 'DRIVING') : null)
        )
      );
    });
    body.append(grid);
  }

  openCarDetail(index) {
    const game = this.game;
    const d = game.save.data;
    const g = d.garage[index];
    const spec = CAR_BY_ID[g.id];
    const img = h('img', { class: 'detail-img', src: carThumb(spec, g.paint) });
    const refresh = () => (img.src = carThumb(spec, g.paint));
    const swatches = h(
      'div',
      { class: 'swatches' },
      PAINTS.map((c) =>
        h('button', {
          class: 'swatch focusable' + (g.paint.color === c ? ' on' : ''),
          style: `background:${c}`,
          onclick: (e) => {
            g.paint.color = c;
            game.save.write();
            [...swatches.children].forEach((x) => x.classList.remove('on'));
            e.currentTarget.classList.add('on');
            refresh();
            if (index === d.current) game.applyPaint();
          },
        })
      )
    );
    const finishes = h(
      'div',
      { class: 'chips' },
      ['gloss', 'matte', 'pearl', 'chrome'].map((f) =>
        h(
          'button',
          {
            class: 'chip focusable' + ((g.paint.finish || 'gloss') === f ? ' on' : ''),
            onclick: (e) => {
              g.paint.finish = f;
              game.save.write();
              [...finishes.children].forEach((x) => x.classList.remove('on'));
              e.currentTarget.classList.add('on');
              refresh();
              if (index === d.current) game.applyPaint();
            },
          },
          f.toUpperCase()
        )
      )
    );
    const rims = h(
      'div',
      { class: 'swatches small' },
      RIM_COLORS.map((c) =>
        h('button', {
          class: 'swatch focusable' + (g.paint.rim === c ? ' on' : ''),
          style: `background:${c}`,
          onclick: (e) => {
            g.paint.rim = c;
            game.save.write();
            [...rims.children].forEach((x) => x.classList.remove('on'));
            e.currentTarget.classList.add('on');
            refresh();
            if (index === d.current) game.applyPaint();
          },
        })
      )
    );
    const s = spec.stats;
    const el = h(
      'div',
      { class: 'screen menu detail' },
      h(
        'div',
        { class: 'detail-wrap' },
        h(
          'div',
          { class: 'detail-left' },
          h('div', { class: 'detail-kicker' }, `${spec.year} · ${spec.make.toUpperCase()}`),
          h('div', { class: 'detail-title' }, spec.model),
          img,
          h('div', { class: 'detail-specs' }, `${Math.round(spec.powerKW * 1.341)} HP · ${spec.mass} KG · ${spec.drive} · ${spec.topKmh} KM/H · 0-100 ${spec.zeroTo100 ? spec.zeroTo100.toFixed(1) + 's' : '—'}${spec.zeroTo200 ? ` · 0-200 ${spec.zeroTo200.toFixed(1)}s` : ''}`)
        ),
        h(
          'div',
          { class: 'detail-right' },
          h('div', { class: 'pi-row' }, piBadge(spec)),
          statBar('SPEED', s.speed),
          statBar('HANDLING', s.handling),
          statBar('ACCELERATION', s.acceleration),
          statBar('LAUNCH', s.launch),
          statBar('BRAKING', s.braking),
          statBar('OFFROAD', s.offroad),
          // race liveries are painted into the model's texture and stay as authored
          ...(spec.style.livery
            ? [h('div', { class: 'sec-title' }, 'LIVERY'), h('div', { class: 'detail-specs' }, `Original ${spec.year} race livery`)]
            : [h('div', { class: 'sec-title' }, 'PAINT'), swatches, h('div', { class: 'sec-title' }, 'FINISH'), finishes, h('div', { class: 'sec-title' }, 'RIMS'), rims]),
          h(
            'div',
            { class: 'dialog-actions' },
            index === d.current
              ? h('button', { class: 'btn focusable', disabled: '' }, 'CURRENTLY DRIVING')
              : h(
                  'button',
                  {
                    class: 'btn primary focusable',
                    onclick: () => {
                      game.switchCar(index);
                      this.close();
                    },
                  },
                  'DRIVE THIS CAR'
                ),
            h('button', { class: 'btn focusable', onclick: () => this.openPause('garage') }, 'BACK')
          )
        )
      )
    );
    this.mount(el);
    this.backAction = () => this.openPause('garage');
  }

  tab_autoshow(body) {
    const game = this.game;
    const d = game.save.data;
    const grid = h('div', { class: 'car-grid' });
    for (const spec of [...CARS].sort((a, b) => a.pi - b.pi)) {
      const owned = game.save.owns(spec.id);
      const can = d.credits >= spec.price;
      grid.append(
        h(
          'div',
          { class: 'car-card shop' },
          h('img', { src: carThumb(spec), loading: 'lazy' }),
          h('div', { class: 'cc-name' }, spec.name),
          h('div', { class: 'cc-sub' }, piBadge(spec), h('span', { class: 'price' + (can ? '' : ' no') }, `${formatNumber(spec.price)} CR`)),
          h(
            'button',
            {
              class: 'btn small focusable' + (can ? ' primary' : ''),
              ...(can ? {} : { disabled: '' }),
              onclick: () => this.confirm(`Buy the ${spec.name}?`, `${formatNumber(spec.price)} CR will be deducted.${owned ? ' You already own one — this adds another copy.' : ''}`, 'BUY', () => {
                if (game.progression.buyCar(spec.id)) {
                  game.audio.ui('levelup');
                  game.hud.toast('CAR PURCHASED', spec.name, 'gold');
                  this.openPause('garage');
                } else this.openPause('autoshow');
              }, () => this.openPause('autoshow')),
            },
            owned ? 'OWNED · BUY AGAIN' : 'BUY'
          )
        )
      );
    }
    body.append(grid);
  }

  tab_online(body) {
    const game = this.game;
    const net = game.net;
    const st = net.status();
    const chatLog = h('div', { class: 'chat-log' }, net.chatLog.slice(-30).map((m) => h('div', { class: 'chat-line' }, h('b', {}, escapeHtml(m.name) + ': '), escapeHtml(m.m))));
    const chatInput = h('input', { class: 'chat-input focusable', maxlength: '120', placeholder: 'Say something to your world…' });
    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && chatInput.value.trim()) {
        net.chat(chatInput.value.trim());
        chatInput.value = '';
        setTimeout(() => this.openPause('online'), 150);
      }
    });
    chatInput.addEventListener('focus', () => (game.input.textFocus = true));
    chatInput.addEventListener('blur', () => (game.input.textFocus = false));
    const raceOpts = game.events.races.filter((r) => r.type !== 'drag').map((r) => h('option', { value: r.id }, r.name));
    const raceSel = h('select', { class: 'focusable' }, raceOpts);
    body.append(
      h(
        'div',
        { class: 'online-wrap' },
        h(
          'div',
          { class: 'online-left' },
          h('div', { class: 'sec-title' }, 'CONNECTION'),
          h('div', { class: 'online-status ' + st.state }, st.label),
          st.state === 'outdated'
            ? h('button', { class: 'btn primary focusable', onclick: () => location.reload() }, 'RELOAD')
            : st.state !== 'connected'
              ? h('button', { class: 'btn primary focusable', onclick: () => (net.connect(), setTimeout(() => this.openPause('online'), 1200)) }, 'CONNECT')
              : h('button', { class: 'btn focusable', onclick: () => (net.disconnect(), this.openPause('online')) }, 'GO OFFLINE'),
          h('div', { class: 'sec-title' }, `WORLD PLAYERS (${st.players.length + (st.state === 'connected' ? 1 : 0)})`),
          h('div', { class: 'player-list' }, st.state === 'connected' ? h('div', { class: 'me' }, `● ${escapeHtml(game.save.data.name)} (you)`) : null, st.players.map((p) => h('div', {}, h('i', { style: `color:${p.paint}` }, '● '), escapeHtml(p.name), h('span', {}, ` · ${CAR_BY_ID[p.car]?.name || p.car}`)))),
          h('div', { class: 'sec-title' }, 'HORIZON OPEN — ONLINE RACE'),
          h('p', { class: 'muted' }, 'Start a race lobby. Everyone in your world gets 20 seconds to join, then you all race together.'),
          h('div', { class: 'row' }, raceSel, h('button', { class: 'btn primary focusable', ...(st.state === 'connected' ? {} : { disabled: '' }), onclick: () => (net.createRace(raceSel.value), this.close()) }, 'CREATE LOBBY'))
        ),
        h('div', { class: 'online-right' }, h('div', { class: 'sec-title' }, 'WORLD CHAT'), chatLog, chatInput)
      )
    );
    setTimeout(() => (chatLog.scrollTop = chatLog.scrollHeight), 0);
  }

  tab_settings(body) {
    const game = this.game;
    const s = game.settings;
    const set = (k, v) => {
      s[k] = v;
      game.applySettings(k);
    };
    // world settings (time of day, day length) are shared by everyone when online
    const shared = game.net.state === 'connected';
    const select = (label, key, options) => {
      const world = WORLD_SETTINGS.includes(key);
      const current = world ? game.worldSetting(key) : s[key];
      return h(
        'label',
        { class: 'setting' },
        h('span', {}, world && shared ? `${label} · whole world` : label),
        h(
          'select',
          {
            class: 'focusable',
            onchange: (e) => {
              const v = e.target.value;
              const value = v !== '' && !isNaN(Number(v)) ? Number(v) : v;
              if (world) game.changeWorldSetting(key, value);
              else set(key, value);
            },
          },
          options.map(([v, t]) => h('option', { value: v, ...(String(current) === String(v) ? { selected: '' } : {}) }, t))
        )
      );
    };
    const toggle = (label, key) =>
      h(
        'label',
        { class: 'setting' },
        h('span', {}, label),
        h('button', {
          class: 'toggle focusable' + (s[key] ? ' on' : ''),
          onclick: (e) => {
            set(key, !s[key]);
            e.currentTarget.classList.toggle('on', s[key]);
          },
        })
      );
    const range = (label, key) =>
      h(
        'label',
        { class: 'setting' },
        h('span', {}, label),
        h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]), class: 'focusable', oninput: (e) => set(key, Number(e.target.value)) })
      );
    const nameInput = h('input', { class: 'focusable', value: game.save.data.name, maxlength: '16' });
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    nameInput.addEventListener('focus', () => (game.input.textFocus = true));
    nameInput.addEventListener('blur', () => {
      game.input.textFocus = false;
      const n = nameInput.value.replace(/[^\w .\-]/g, '').trim().slice(0, 16);
      if (n) {
        game.save.data.name = n;
        game.save.write();
        game.net.rename(n);
      }
    });
    body.append(
      h(
        'div',
        { class: 'settings-grid' },
        h(
          'div',
          { class: 'settings-col' },
          h('div', { class: 'sec-title' }, 'VIDEO'),
          select('Graphics quality', 'quality', [
            ['auto', `Auto (${game.qualityName ? game.autoQuality || game.qualityName() : 'high'})`],
            ['low', 'Low'],
            ['medium', 'Medium'],
            ['high', 'High'],
            ['ultra', 'Ultra'],
          ]),
          select('Time of day', 'timeOfDay', [
            ['dynamic', 'Dynamic day/night'],
            ['morning', 'Morning'],
            ['noon', 'Midday'],
            ['golden', 'Golden hour'],
            ['sunset', 'Sunset'],
            ['night', 'Night'],
          ]),
          select('Day length', 'dayLength', [
            [20, '20 minutes'],
            [40, '40 minutes'],
            [60, '1 hour'],
            [120, '2 hours'],
          ]),
          toggle('Dynamic resolution', 'dynamicRes'),
          toggle('Motion blur', 'motionBlur'),
          toggle('Show FPS', 'showFps'),
          h('div', { class: 'sec-title' }, 'AUDIO'),
          range('Master volume', 'masterVolume'),
          range('Engine volume', 'engineVolume'),
          range('Effects volume', 'sfxVolume'),
          range('Radio volume', 'musicVolume'),
          toggle('Horizon Pulse radio', 'radio')
        ),
        h(
          'div',
          { class: 'settings-col' },
          h('div', { class: 'sec-title' }, 'DRIVING'),
          select('Speed units', 'units', [
            ['kmh', 'KM/H'],
            ['mph', 'MPH'],
          ]),
          select('Transmission', 'transmission', [
            ['auto', 'Automatic'],
            ['manual', 'Manual (Q/E)'],
          ]),
          select('Driving line', 'drivingLine', [
            ['off', 'Off'],
            ['race', 'Races only'],
          ]),
          select('Default camera', 'camera', CAMERA_MODES.map((m, i) => [i, m])),
          select('Drivatar difficulty', 'aiSkill', [
            [0.84, 'Average'],
            [0.9, 'Above average'],
            [0.95, 'Highly skilled'],
            [1.0, 'Expert'],
            [1.04, 'Unbeatable'],
          ]),
          select('Steering assist', 'steeringAssist', [
            ['off', 'Off (raw)'],
            ['normal', 'Normal'],
            ['full', 'Full'],
          ]),
          toggle('Stability control', 'stability'),
          toggle('Traction control', 'tractionControl'),
          toggle('ABS brakes', 'abs'),
          select('Damage', 'damage', [
            ['off', 'Off'],
            ['cosmetic', 'Cosmetic'],
            ['simulation', 'Simulation'],
          ]),
          toggle('Traffic & pedestrians', 'traffic'),
          h('div', { class: 'sec-title' }, 'PROFILE'),
          h('label', { class: 'setting' }, h('span', {}, 'Driver name'), nameInput),
          h(
            'label',
            { class: 'setting' },
            h('span', {}, 'Save data'),
            h(
              'button',
              {
                class: 'btn small focusable',
                onclick: () =>
                  this.confirm('Reset all progress?', 'Your cars, credits, levels and records will be wiped.', 'RESET', () => {
                    game.save.reset();
                    location.reload();
                  }, () => this.openPause('settings')),
              },
              'RESET PROGRESS'
            )
          )
        )
      )
    );
  }

  openControls() {
    const rows = [
      ['Accelerate', 'W / ↑', 'RT'],
      ['Brake / Reverse', 'S / ↓', 'LT'],
      ['Steer', 'A D / ← →', 'Left stick'],
      ['Handbrake', 'Space', 'A'],
      ['Shift up / down (manual)', 'E / Q', 'RB / LB'],
      ['Change camera', 'C', 'Y'],
      ['Look around (all cameras)', 'Left mouse button + drag', '—'],
      ['Look back', 'B', 'Right stick click'],
      ['Rewind', 'R (hold)', 'X (hold)'],
      ['Reset car to road', 'T', 'Right stick button'],
      ['Start event / confirm', 'Enter', 'A'],
      ['World map', 'M', 'View'],
      ['Pause menu', 'Esc', 'Menu'],
      ['Horn', 'H', 'Left stick click'],
      ['Radio on/off', 'N', '—'],
      ['Join online race', 'J', '—'],
      ['Chat (online)', 'Y', '—'],
    ];
    const el = h(
      'div',
      { class: 'screen menu' },
      h(
        'div',
        { class: 'dialog wide controls' },
        h('div', { class: 'dialog-title' }, 'CONTROLS'),
        h('table', { class: 'controls-table' }, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Keyboard / Mouse'), h('th', {}, 'Gamepad')), rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))),
        h('p', { class: 'muted' }, 'Drag with the left mouse button to look around in any camera. Chase views orbit around your car; hood, bumper and cockpit views look from their usual positions. After three seconds idle, the camera returns to its normal driving view.'),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary focusable', onclick: () => this.openPause('festival') }, 'BACK'))
      )
    );
    this.mount(el);
    this.backAction = () => this.openPause('festival');
  }

  confirm(title, text, okLabel, onOk, onCancel) {
    const el = h(
      'div',
      { class: 'screen dialog-screen' },
      h(
        'div',
        { class: 'dialog' },
        h('div', { class: 'dialog-title' }, title),
        h('p', {}, text),
        h(
          'div',
          { class: 'dialog-actions' },
          h('button', { class: 'btn primary focusable', onclick: () => (this.game.audio.ui('select'), onOk()) }, okLabel),
          h('button', { class: 'btn focusable', onclick: () => (onCancel ? onCancel() : this.close()) }, 'CANCEL')
        )
      )
    );
    this.mount(el);
    this.backAction = onCancel || null;
  }

  // ------------------------------------------------------------ event start prompt
  eventIntro(def, onStart, onCancel) {
    const game = this.game;
    const rec = game.save.data.raceRecords[def.id];
    const el = h(
      'div',
      { class: 'screen dialog-screen' },
      h(
        'div',
        { class: 'dialog event-card' },
        h('div', { class: 'dialog-kicker' }, def.series.toUpperCase()),
        h('div', { class: 'dialog-title' }, def.name),
        h('p', {}, def.desc),
        h(
          'div',
          { class: 'kv' },
          h('div', {}, h('span', {}, 'Type'), h('b', {}, def.type.toUpperCase())),
          h('div', {}, h('span', {}, 'Distance'), h('b', {}, `${(def.distance / 1000).toFixed(1)} km`)),
          h('div', {}, h('span', {}, 'Laps'), h('b', {}, String(def.laps))),
          h('div', {}, h('span', {}, 'Opponents'), h('b', {}, String(def.ai))),
          h('div', {}, h('span', {}, 'Your best'), h('b', {}, rec ? `${formatTime(rec.time)} (${ordinal(rec.pos)})` : '—'))
        ),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary focusable', onclick: onStart }, 'START RACE'), h('button', { class: 'btn focusable', onclick: onCancel }, 'CANCEL'))
      )
    );
    this.mount(el);
    this.backAction = onCancel;
  }

  // ------------------------------------------------------------ race results
  showResults(def, pos, time, standings, rewards, onContinue) {
    const rows = standings.map((r, i) =>
      h(
        'tr',
        { class: r.isPlayer ? 'me' : '' },
        h('td', {}, String(i + 1)),
        h('td', {}, escapeHtml(r.name)),
        h('td', {}, r.v?.spec?.name || r.car || ''),
        h('td', {}, r.finished || r.time ? formatTime(r.time) : 'DNF')
      )
    );
    const el = h(
      'div',
      { class: 'screen menu results', 'data-noback': '1' },
      h(
        'div',
        { class: 'results-wrap' },
        h('div', { class: 'results-kicker' }, def.name.toUpperCase()),
        h('div', { class: 'results-pos' + (pos === 1 ? ' win' : '') }, pos ? ordinal(pos) : 'DNF'),
        h('div', { class: 'results-time' }, time ? formatTime(time) : ''),
        h('table', { class: 'results-table' }, h('tr', {}, h('th', {}, 'POS'), h('th', {}, 'DRIVER'), h('th', {}, 'CAR'), h('th', {}, 'TIME')), rows),
        h('div', { class: 'rewards' }, h('div', {}, h('span', {}, 'CREDITS'), h('b', {}, `+${formatNumber(rewards.credits)} CR`)), h('div', {}, h('span', {}, 'XP'), h('b', {}, `+${formatNumber(rewards.xp)}`))),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary focusable', onclick: onContinue }, 'CONTINUE'), rewards.retry ? h('button', { class: 'btn focusable', onclick: rewards.retry }, 'RESTART') : null)
      )
    );
    this.mount(el);
  }

  // ------------------------------------------------------------ wheelspin
  openWheelspin() {
    const game = this.game;
    const d = game.save.data;
    if (d.wheelspins <= 0) {
      game.hud.toast('NO WHEELSPINS', 'Level up to earn more', 'purple');
      this.openPause('festival');
      return;
    }
    const prog = game.progression;
    const prize = prog.rollPrize();
    // reel of random prizes with the winner at a fixed slot
    const rnd = mulberry32(Date.now() & 0xffff);
    const items = [];
    for (let i = 0; i < 40; i++) items.push(i === 34 ? prize : prog.rollPrize(rnd));
    const card = (p) => h('div', { class: `ws-item ${p.rarity}` }, p.type === 'car' ? h('img', { src: carThumb(CAR_BY_ID[p.id]) }) : h('div', { class: 'ws-cr' }, 'CR'), h('div', { class: 'ws-label' }, p.label), h('div', { class: 'ws-rarity' }, p.rarity.toUpperCase()));
    const reel = h('div', { class: 'ws-reel' }, items.map(card));
    const status = h('div', { class: 'ws-status' }, 'SPINNING…');
    const cont = h('button', { class: 'btn primary focusable', style: 'visibility:hidden', onclick: () => this.openPause('festival') }, 'CONTINUE');
    const again = h('button', { class: 'btn focusable', style: 'visibility:hidden', onclick: () => this.openWheelspin() }, 'SPIN AGAIN');
    const el = h(
      'div',
      { class: 'screen menu wheelspin', 'data-noback': '1' },
      h('div', { class: 'ws-title' }, 'WHEELSPIN'),
      h('div', { class: 'ws-window' }, reel, h('div', { class: 'ws-marker' })),
      status,
      h('div', { class: 'dialog-actions' }, cont, again)
    );
    this.mount(el);
    d.wheelspins--;
    game.save.write();
    const itemH = 150;
    const target = 34 * itemH - 150;
    const start = performance.now();
    const dur = 4200;
    let lastIdx = -1;
    const anim = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3.4);
      const y = e * target;
      reel.style.transform = `translateY(${-y}px)`;
      const idx = Math.floor(y / itemH);
      if (idx !== lastIdx) {
        lastIdx = idx;
        game.audio.ui('wheel');
      }
      if (k < 1) requestAnimationFrame(anim);
      else {
        prog.applyPrize(prize);
        game.audio.ui('levelup');
        status.innerHTML = `YOU WON <b class="${prize.rarity}">${prize.label}</b>${prize.type === 'car' && prize.dup ? ' (duplicate — converted to credits)' : ''}`;
        cont.style.visibility = 'visible';
        if (d.wheelspins > 0) {
          again.style.visibility = 'visible';
          again.textContent = `SPIN AGAIN (${d.wheelspins})`;
        }
        cont.focus();
        el.dataset.noback = '';
        this.backAction = () => this.openPause('festival');
      }
    };
    requestAnimationFrame(anim);
  }
}
