// Keyboard + gamepad input, merged into a single driving/menu state.
import { clamp } from './math.js';

const KEYMAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  shiftUp: ['KeyE', 'ShiftRight'],
  shiftDown: ['KeyQ', 'ControlRight'],
  camera: ['KeyC'],
  lookBack: ['KeyB'],
  reset: ['KeyT'],
  rewind: ['KeyR'],
  horn: ['KeyH'],
  map: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  accept: ['Enter', 'NumpadEnter'],
  back: ['Backspace'],
  lights: ['KeyL'],
  radio: ['KeyN'],
  chat: ['KeyY'],
  photo: ['KeyV'],
  tab: ['Tab'],
};

const PAD_MAP = { accept: 0, back: 1, handbrake: 0, camera: 3, rewind: 2, pause: 9, map: 8, shiftUp: 5, shiftDown: 4, reset: 11, lookBack: 10, horn: 12, lights: 13 };

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.gamepad = null;
    this.padButtons = [];
    this.padPrev = [];
    this.steerSmooth = 0;
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this.textFocus = false;
    target.addEventListener('keydown', (e) => {
      if (this.textFocus) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('gamepadconnected', () => (this.lastDevice = 'gamepad'));
  }

  // (plain loops: these run many times per frame and must not allocate)
  key(action) {
    const keys = KEYMAP[action];
    for (let i = 0; i < keys.length; i++) if (this.down.has(keys[i])) return true;
    return false;
  }

  // true once per key press (keyboard or gamepad)
  hit(action) {
    const keys = KEYMAP[action];
    for (let i = 0; i < keys.length; i++) if (this.pressed.has(keys[i])) return true;
    return this.padHit(action);
  }

  padHit(action) {
    const b = PAD_MAP[action];
    if (b === undefined) return false;
    return !!this.padButtons[b] && !this.padPrev[b];
  }

  poll() {
    // swap the two button arrays instead of allocating new ones
    const prev = this.padPrev;
    this.padPrev = this.padButtons;
    this.padButtons = prev;
    this.padButtons.length = 0;
    this.gamepad = null;
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        this.gamepad = p;
        break;
      }
    }
    if (this.gamepad) {
      const btn = this.gamepad.buttons;
      let fresh = false;
      for (let i = 0; i < btn.length; i++) {
        const on = btn[i].pressed || btn[i].value > 0.5;
        this.padButtons[i] = on;
        if (on && !this.padPrev[i]) fresh = true;
      }
      if (fresh || Math.abs(this.gamepad.axes[0] || 0) > 0.3) this.lastDevice = 'gamepad';
    }
  }

  endFrame() {
    this.pressed.clear();
  }

  // driving controls, dt for keyboard steering smoothing
  driving(dt) {
    let throttle = this.key('throttle') ? 1 : 0;
    let brake = this.key('brake') ? 1 : 0;
    let steerRaw = (this.key('right') ? 1 : 0) - (this.key('left') ? 1 : 0);
    let handbrake = this.key('handbrake') ? 1 : 0;
    let analog = false;
    const gp = this.gamepad;
    if (gp) {
      const ax = gp.axes[0] || 0;
      const dz = 0.12;
      const sx = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz));
      if (Math.abs(sx) > 0.01) {
        steerRaw = Math.sign(sx) * Math.pow(Math.abs(sx), 1.35);
        analog = true;
      }
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      if (gp.buttons[0] && gp.buttons[0].pressed) handbrake = 1;
    }
    // keyboard steering ramps in/out for smoother digital input
    if (!analog) {
      const rate = steerRaw === 0 ? 6.5 : Math.sign(steerRaw) !== Math.sign(this.steerSmooth) ? 9 : 3.6;
      this.steerSmooth += clamp(steerRaw - this.steerSmooth, -rate * dt, rate * dt);
    } else this.steerSmooth = steerRaw;
    const out = this._ctl || (this._ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 0 });
    out.throttle = throttle;
    out.brake = brake;
    out.steer = clamp(this.steerSmooth, -1, 1);
    out.handbrake = handbrake;
    return out;
  }

  // menu navigation: returns {x, y} steps this frame
  menuNav() {
    let x = 0,
      y = 0;
    if (this.pressed.has('ArrowLeft') || this.pressed.has('KeyA')) x -= 1;
    if (this.pressed.has('ArrowRight') || this.pressed.has('KeyD')) x += 1;
    if (this.pressed.has('ArrowUp') || this.pressed.has('KeyW')) y -= 1;
    if (this.pressed.has('ArrowDown') || this.pressed.has('KeyS')) y += 1;
    if (this.gamepad) {
      const b = this.padButtons,
        p = this.padPrev;
      if (b[14] && !p[14]) x -= 1;
      if (b[15] && !p[15]) x += 1;
      if (b[12] && !p[12]) y -= 1;
      if (b[13] && !p[13]) y += 1;
    }
    return { x, y };
  }
}
