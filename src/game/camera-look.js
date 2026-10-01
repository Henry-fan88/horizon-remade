// Shared drag offsets for orbiting chase cameras and looking from mounted cameras.
import { clamp, TAU, wrapAngle } from '../core/math.js';

export const LOOK_IDLE_SECONDS = 3;
const PITCH_LIMIT = Math.PI * 85 / 180;
const RETURN_SECONDS = 0.75;
const nowSeconds = () => performance.now() / 1000;

export class CameraLook {
  constructor(now = nowSeconds) {
    this.now = now;
    this.revision = 0;
    this.reset();
  }

  reset() {
    this.revision++;
    this.yaw = this.pitch = 0;
    this.returnYaw = this.returnPitch = 0;
    this.lastInput = -Infinity;
  }

  drag(dx, dy, width, height) {
    this.yaw = wrapAngle(this.yaw - dx / Math.max(width, 1) * TAU);
    this.pitch = clamp(this.pitch - dy / Math.max(height, 1) * Math.PI, -PITCH_LIMIT, PITCH_LIMIT);
    this.returnYaw = this.yaw;
    this.returnPitch = this.pitch;
    this.lastInput = this.now();
  }

  update() {
    // Both the delay and the eased return use wall time, including after a slow frame.
    const returningFor = this.now() - this.lastInput - LOOK_IDLE_SECONDS;
    if (returningFor <= 0) return;
    if (returningFor >= RETURN_SECONDS) { this.yaw = this.pitch = 0; return; }
    const t = returningFor / RETURN_SECONDS;
    const remaining = 1 - t * t * (3 - 2 * t);
    this.yaw = this.returnYaw * remaining;
    this.pitch = this.returnPitch * remaining;
  }
}

// Bind only the game canvas: menus and the map keep their own pointers.
export class CameraLookInput {
  constructor(canvas, look, canLook, target = window) {
    this.canvas = canvas;
    this.look = look;
    this.canLook = canLook;
    this.target = target;
    this.enabled = false;
    this.lookRevision = look.revision;
    this.pointerId = null;
    this.x = this.y = 0;
    this.onDown = e => {
      this.sync();
      if (!this.enabled || this.pointerId !== null || (e.pointerType !== 'touch' && e.button !== 0)) return;
      this.pointerId = e.pointerId;
      this.x = e.clientX; this.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('camera-dragging');
      look.drag(0, 0, 1, 1);
      e.preventDefault();
    };
    this.onMove = e => {
      this.sync();
      if (e.pointerId !== this.pointerId) return;
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { this.cancel(); return; }
      const dx = e.clientX - this.x, dy = e.clientY - this.y;
      this.x = e.clientX; this.y = e.clientY;
      if (dx || dy) {
        const bounds = canvas.getBoundingClientRect();
        look.drag(dx, dy, bounds.width, bounds.height);
      }
      e.preventDefault();
    };
    this.onEnd = e => { if (e.pointerId === this.pointerId) this.cancel(); };
    this.onBlur = () => { this.cancel(); look.reset(); };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onEnd);
    canvas.addEventListener('pointercancel', this.onEnd);
    canvas.addEventListener('lostpointercapture', this.onEnd);
    target.addEventListener('blur', this.onBlur);
    this.sync();
  }

  sync() {
    const enabled = !!this.canLook();
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.canvas.classList.toggle('camera-look', enabled);
      if (!enabled) { this.cancel(); this.look.reset(); }
    }
    // Camera switches and respawns reset the offsets even when dragging stays enabled.
    if (this.lookRevision !== this.look.revision) {
      this.cancel();
      this.lookRevision = this.look.revision;
    }
  }

  cancel() {
    const id = this.pointerId;
    this.pointerId = null;
    this.canvas.classList.remove('camera-dragging');
    if (id !== null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }

  dispose() {
    this.cancel(); this.look.reset();
    this.canvas.classList.remove('camera-look');
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onEnd);
    this.canvas.removeEventListener('pointercancel', this.onEnd);
    this.canvas.removeEventListener('lostpointercapture', this.onEnd);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
