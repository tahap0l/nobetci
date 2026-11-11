// The mascot on a plain web page: one canvas, the engine, and a frame loop that
// only runs while the mascot can be seen. The website and the web demo use this
// (website/mascot-engine.ts); the island has its own loop.

import type { MascotTheme } from "../core/mascot-theme";
import { OwlEngine, type OwlEmote, type OwlMood } from "./owl";

export interface EmbeddedMascot {
  setTheme(theme: MascotTheme): void;
  setMood(mood: OwlMood): void;
  emote(emote: OwlEmote): void;
  wave(): void;
  poke(): void;
  destroy(): void;
}

/** How long the pose is given to settle when nothing may move (reduced motion). */
const SETTLE_STEPS = 120;

/** Fills `host` with an animated mascot that follows the pointer. */
export function mountMascot(host: HTMLElement, theme: MascotTheme = "owl"): EmbeddedMascot {
  const engine = new OwlEngine();
  engine.setSkin(theme);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%";
  host.replaceChildren(canvas);

  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let last = 0;
  let visible = true;
  let alive = true;

  function paint() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || w <= 0 || h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // The body is a square; the rest of the height is headroom for "!", "?" and z's.
    const size = Math.min(w, h / 1.3);
    ctx.translate((w - size) / 2, 0);
    engine.draw(ctx, size, h);
  }

  function tick(now: number) {
    frame = 0;
    if (!alive) return;
    engine.update(last ? (now - last) / 1000 : 1 / 60);
    last = now;
    paint();
    schedule();
  }

  function schedule() {
    if (!frame && alive && visible && !still.matches && document.visibilityState === "visible") {
      frame = requestAnimationFrame(tick);
    }
  }

  /** After a change: animate towards it, or jump to the settled pose when motion is off. */
  function refresh() {
    if (still.matches) {
      for (let i = 0; i < SETTLE_STEPS; i++) engine.update(1 / 60);
      paint();
      return;
    }
    last = 0;
    schedule();
  }

  function look(event: PointerEvent) {
    const box = canvas.getBoundingClientRect();
    engine.lookX = Math.tanh((event.clientX - box.left - box.width / 2) / 260);
    engine.lookY = -Math.tanh((event.clientY - box.top - box.height / 2) / 200);
  }

  const seen = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    refresh();
  });
  seen.observe(canvas);
  const resized = new ResizeObserver(() => (still.matches ? paint() : schedule()));
  resized.observe(host);
  window.addEventListener("pointermove", look, { passive: true });
  document.addEventListener("visibilitychange", refresh);
  still.addEventListener("change", refresh);
  refresh();

  return {
    setTheme(next) {
      engine.setSkin(next);
      refresh();
    },
    setMood(mood) {
      engine.setMood(mood);
      refresh();
    },
    emote(emote) {
      engine.triggerEmote(emote);
      refresh();
    },
    wave() {
      engine.wave();
      refresh();
    },
    poke() {
      engine.poke();
      refresh();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(frame);
      seen.disconnect();
      resized.disconnect();
      window.removeEventListener("pointermove", look);
      document.removeEventListener("visibilitychange", refresh);
      still.removeEventListener("change", refresh);
      canvas.remove();
    },
  };
}
