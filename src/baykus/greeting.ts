// Launch greeting on a 640 × 150 transparent canvas: the owl swoops in, lands
// with a squash, looks left and right, hops aside to make room for
// "Nöbetteyim!", waves a wing and hoots. After the main beat it keeps an idle
// pose until interrupted.

import { Ease, clamp, lerp, seg } from "../core/anim";
import { OwlEngine } from "./owl";
import { t } from "../i18n/island";

const CW = 640;
const CH = 150;
const OWL = 70; // owl body size, px
const OVER = 40; // owl canvas overhang, px
const GAP = 12; // owl ↔ text gap, px
const GROUND_Y = CH / 2 + 5; // owl centre once perched
/** "Nöbetteyim!" / "On watch!" — read at draw time so it follows the language. */
const text = () => t("greet.text");
const FONT = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';

// Timeline (seconds).
const T_LAND = 0.62;
const T_LOOK_L = 0.92;
const T_LOOK_R = 1.28;
const T_LOOK_C = 1.64;
const T_HOP0 = 1.72;
const T_HOP1 = 2.06;
const T_TEXT = 1.95;
const T_WAVE = 2.12;
const T_HOOT = 2.6;
const T_DONE = 3.2;

export class OwlGreeting {
  /** Fires once when the main beat ends. */
  onComplete: (() => void) | null = null;

  private owl = new OwlEngine();
  private running = false;
  private t0 = 0;
  private last = 0;
  private textW = -1;
  private landed = false;
  private hopped = false;
  private waved = false;
  private hooted = false;
  private done = false;
  private lastHover = -1e9;

  start(): void {
    this.textW = -1;
    const now = performance.now();
    this.owl = new OwlEngine();
    this.owl.overhang = OVER;
    this.t0 = now;
    this.last = now;
    this.running = true;
    this.landed = this.hopped = this.waved = this.hooted = this.done = false;
  }

  interrupt(): void {
    this.running = false;
  }

  hover(): void {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastHover < 700 || (now - this.t0) / 1000 < T_LAND) return;
    this.lastHover = now;
    this.owl.wave();
    this.owl.triggerEmote("happy");
  }

  get active(): boolean {
    return this.running;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, CW, CH);
    if (!this.running) return;

    const now = performance.now();
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const owl = this.owl;

    if (this.textW < 0) {
      ctx.save();
      ctx.font = FONT;
      this.textW = ctx.measureText(text()).width;
      ctx.restore();
    }
    const groupW = OWL + GAP + this.textW;
    const landX = CW / 2;
    const restX = CW / 2 - groupW / 2 + OWL / 2;

    // Position along the timeline.
    let x = restX;
    let y = GROUND_Y;
    let bank = 0;
    if (t < T_LAND) {
      // Swoop in from the upper right on a decelerating curve.
      const p = t / T_LAND;
      const e = 1 - (1 - p) * (1 - p);
      const x0 = landX + 210;
      const y0 = -70;
      const cx = landX + 70;
      const cy = GROUND_Y - 6;
      const m = 1 - e;
      x = m * m * x0 + 2 * m * e * cx + e * e * landX;
      y = m * m * y0 + 2 * m * e * cy + e * e * GROUND_Y;
      bank = -0.32 * (1 - Ease.out(p));
      owl.flight = 1 - seg(p, 0.72, 1);
    } else if (t < T_HOP1) {
      owl.flight = 0;
      if (!this.landed) {
        this.landed = true;
        owl.land(1.2);
      }
      const p = seg(t, T_HOP0, T_HOP1);
      x = lerp(landX, restX, Ease.inOut(p));
      y = GROUND_Y - Math.sin(Math.PI * p) * 11;
    } else if (!this.hopped) {
      this.hopped = true;
      owl.land(0.6);
    }

    // Look around, then settle on the text; drift gently once idle.
    if (t >= T_LAND) {
      if (t < T_LOOK_L) owl.lookX = 0;
      else if (t < T_LOOK_R) owl.lookX = -1;
      else if (t < T_LOOK_C) owl.lookX = 1;
      else if (t < T_DONE) owl.lookX = 0.15;
      else owl.lookX = 0.2 + Math.sin((t - T_DONE) * 0.6) * 0.35;
      owl.lookY = t < T_DONE ? 0 : Math.sin((t - T_DONE) * 0.43) * 0.2;
    }
    if (!this.waved && t >= T_WAVE) {
      this.waved = true;
      owl.wave();
    }
    if (!this.hooted && t >= T_HOOT) {
      this.hooted = true;
      owl.triggerEmote("hoot");
    }

    owl.update(dt);

    // Landing dust.
    const dq = (t - T_LAND) / 0.45;
    if (dq > 0 && dq < 1) {
      ctx.fillStyle = "#FFFFFF";
      ctx.globalAlpha = 0.28 * (1 - dq);
      const fy = GROUND_Y + OWL * 0.48;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 2; i++) {
          const d = (10 + i * 9) * (0.6 + Ease.out(dq));
          ctx.beginPath();
          ctx.arc(landX + side * d, fy - i * 2 - dq * 3, 2 + dq * 3 - i, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(x, y);
    if (bank !== 0) ctx.rotate(bank);
    ctx.translate(-OWL / 2, -(OWL + OVER) / 2);
    owl.draw(ctx, OWL, OWL + OVER);
    ctx.restore();

    // Caption.
    const ta = Ease.out(seg(t, T_TEXT, T_TEXT + 0.5));
    if (ta > 0) {
      ctx.save();
      ctx.globalAlpha = ta;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = FONT;
      ctx.fillText(text(), restX + OWL / 2 + GAP - (1 - ta) * 8, GROUND_Y + 2);
      ctx.restore();
    }

    if (!this.done && t >= T_DONE) {
      this.done = true;
      this.onComplete?.();
    }
  }
}
