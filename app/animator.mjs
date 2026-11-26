// animator.mjs - the menu bar icon's small animation. Template images, so macOS colors them
// for light and dark menu bars. Holds still when Reduce Motion is on (System Settings >
// Accessibility > Display), and shows the first frame of each state instead.
import path from 'node:path';

export const FRAMES = {
  idle: ['idle'], stopped: ['idle'],
  thinking: ['working-0', 'working-1', 'working-2', 'working-3'],
  working: ['working-0', 'working-1', 'working-2', 'working-3'],
  waiting: ['waiting-0', 'waiting-1'],
  error: ['alert'],
};
export const FRAME_MS = { thinking: 260, working: 180, waiting: 600 };

export class Animator {
  static reducedMotion(systemPreferences) {
    try { return Boolean(systemPreferences?.getAnimationSettings?.().prefersReducedMotion); } catch { return false; }
  }

  constructor({ tray, dir, nativeImage, systemPreferences, setTimer = setInterval, clearTimer = clearInterval }) {
    Object.assign(this, { tray, dir, nativeImage, systemPreferences, setTimer, clearTimer });
    this.cache = new Map(); this.state = 'idle'; this.timer = null; this.frame = 0;
  }

  image(name) {
    if (!this.cache.has(name)) {
      const img = this.nativeImage.createFromPath(path.join(this.dir, `${name}Template.png`));
      img.setTemplateImage?.(true);
      this.cache.set(name, img);
    }
    return this.cache.get(name);
  }

  setState(state) {
    const frames = FRAMES[state] || FRAMES.idle;
    if (state === this.state && this.timer) return;
    this.state = state; this.stop(); this.frame = 0;
    this.tray.setImage(this.image(frames[0]));
    if (frames.length < 2 || Animator.reducedMotion(this.systemPreferences)) return;
    this.timer = this.setTimer(() => {
      this.frame = (this.frame + 1) % frames.length;
      this.tray.setImage(this.image(frames[this.frame]));
    }, FRAME_MS[state] || 300);
  }

  /** Reduce Motion changed: show the same state again, moving or still. */
  refresh() { const s = this.state; this.stop(); this.state = null; this.setState(s); }

  stop() { if (this.timer) { this.clearTimer(this.timer); this.timer = null; } }
}
