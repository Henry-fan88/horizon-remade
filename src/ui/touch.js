// On-screen touch controls for phones/tablets.
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.enabled = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
    if (!this.enabled) return;
    const ui = document.getElementById('ui');
    const el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `
      <div class="t-steer"><div class="t-knob"></div><span>STEER</span></div>
      <button class="t-btn t-gas">GAS</button>
      <button class="t-btn t-brake">BRAKE</button>
      <button class="t-btn t-hb">E-BRAKE</button>
      <div class="t-top">
        <button class="t-small" data-a="pause">❚❚</button>
        <button class="t-small" data-a="camera">CAM</button>
        <button class="t-small" data-a="map">MAP</button>
        <button class="t-small" data-a="rewind">⟲</button>
        <button class="t-small" data-a="accept">START</button>
      </div>`;
    ui.appendChild(el);
    this.el = el;
    const hint = document.createElement('div');
    hint.className = 'rotate-hint';
    hint.innerHTML = '<i>📱</i><div>ROTATE YOUR PHONE<br>FOR THE BEST RIDE</div><button>PLAY IN PORTRAIT</button>';
    hint.querySelector('button').addEventListener('click', () => hint.classList.add('dismissed'));
    ui.appendChild(hint);
    const t = game.input.touch;
    const steer = el.querySelector('.t-steer');
    const knob = el.querySelector('.t-knob');
    let sid = null,
      sx = 0;
    steer.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      sx = e.clientX;
      steer.setPointerCapture(sid);
    });
    steer.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      const d = Math.max(-1, Math.min(1, (e.clientX - sx) / 70));
      t.steer = d;
      knob.style.transform = `translateX(${d * 55}px)`;
    });
    const endSteer = (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      t.steer = 0;
      knob.style.transform = '';
    };
    steer.addEventListener('pointerup', endSteer);
    steer.addEventListener('pointercancel', endSteer);
    const hold = (sel, key) => {
      const b = el.querySelector(sel);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        t[key] = 1;
        b.classList.add('on');
        game.audio.init();
      });
      const up = () => {
        t[key] = 0;
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    };
    hold('.t-gas', 'throttle');
    hold('.t-brake', 'brake');
    hold('.t-hb', 'handbrake');
    const codes = { pause: 'Escape', camera: 'KeyC', map: 'KeyM', rewind: 'KeyR', accept: 'Enter' };
    el.querySelectorAll('.t-small').forEach((b) => {
      const code = codes[b.dataset.a];
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        game.input.pressed.add(code);
        game.input.down.add(code);
        game.audio.init();
      });
      const up = () => game.input.down.delete(code);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  show(v) {
    if (this.el) this.el.style.display = v ? 'block' : 'none';
  }
}
