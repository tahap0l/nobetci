// The desktop mascot window (src-tauri/src/buddy.rs): the island's mascot in a
// small window of its own, dragged anywhere with the mouse.
//
// It only shows what is going on. The island sends it its mood and its
// reactions (`buddy-mood`, `buddy-emote`); a click opens the island, where every
// decision is still taken. Dragging spreads its wings, letting go lands it.
//
// Like the island it draws only while something moves: once it has nodded off
// (two minutes of calm) the frame loop stops and costs nothing.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { OwlEngine, type OwlEmote, type OwlMood } from "../baykus/owl";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import type { MascotTheme } from "../core/mascot-theme";
import type { Settings } from "../core/settings-model";

/** How far the pointer must travel with the button down before it is a drag. */
const DRAG_SLOP = 4;
/** No moves for this long and the drag is over. */
const LANDING_MS = 180;
/** Calm for this long and the mascot falls asleep (and the loop stops). */
const DOZE_MS = 120_000;
/**
 * The mascot's width as a share of the window's; the rest is room for badges and
 * sparkles. The window itself is sized by the `buddySize` setting.
 */
const BODY_SHARE = 96 / 124;
const OVERHANG_SHARE = 56 / 96;

const canvas = document.getElementById("mascot") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const owl = new OwlEngine();
let body = 96;

let islandMood: OwlMood = "idle";
let lastStir = performance.now();
let running = false;
let last = 0;
let carried = false;
let landing: number | null = null;

function size() {
  body = Math.round(window.innerWidth * BODY_SHARE);
  owl.overhang = Math.round(body * OVERHANG_SHARE);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

/** Wakes the mascot up: something happened. */
function stir() {
  lastStir = performance.now();
  owl.setMood(islandMood === "sleeping" ? "idle" : islandMood);
  wake();
}

function wake() {
  if (running || document.hidden) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Waiting requests and work keep it awake; plain idling does not.
  const calm = islandMood === "idle" || islandMood === "finished" || islandMood === "sleeping";
  if (calm && !carried && now - lastStir > DOZE_MS) owl.setMood("sleeping");

  owl.flight += ((carried ? 1 : 0) - owl.flight) * Math.min(1, dt * 10);
  if (owl.flight < 0.01) owl.flight = 0;
  owl.update(dt);

  const dpr = canvas.width / window.innerWidth;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  // Feet near the bottom, room above the head for badges.
  const top = window.innerHeight - (body + owl.overhang) - 2;
  ctx.translate((window.innerWidth - body) / 2, top);
  owl.draw(ctx, body, body + owl.overhang);

  if (owl.busy && !document.hidden) requestAnimationFrame(frame);
  else running = false;
}

// ── Pointer: look, poke, drag, open ─────────────────────────────────────────

let down: { x: number; y: number } | null = null;
let dragged = false;

canvas.addEventListener("pointermove", (e) => {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight - body * 0.7;
  owl.lookX = Math.tanh((e.clientX - cx) / 50);
  owl.lookY = -Math.tanh((e.clientY - cy) / 50);
  if (down && !dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_SLOP) {
    dragged = true;
    if (IS_TAURI) void getCurrentWindow().startDragging();
  }
  stir();
});

canvas.addEventListener("pointerleave", () => {
  owl.lookX = 0;
  owl.lookY = 0;
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  down = { x: e.clientX, y: e.clientY };
  dragged = false;
  stir();
});

canvas.addEventListener("pointerup", () => {
  // A press that never moved is a poke.
  if (down && !dragged) owl.poke();
  down = null;
  stir();
});

// A double click opens the island — on the waiting card, if there is one.
canvas.addEventListener("dblclick", () => void Bridge.buddyOpenIsland());

/** The window moves while it is carried; when the moves stop, it lands. */
function carriedAlong() {
  if (!carried) {
    carried = true;
    canvas.classList.add("dragging");
  }
  stir();
  if (landing != null) window.clearTimeout(landing);
  landing = window.setTimeout(() => {
    landing = null;
    carried = false;
    down = null;
    canvas.classList.remove("dragging");
    owl.land(1.2);
    stir();
  }, LANDING_MS);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function applySettings(s: Settings) {
  owl.setSkin(s.mascotTheme as MascotTheme);
  stir();
}

async function main() {
  size();
  window.addEventListener("resize", () => {
    size();
    stir();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) stir();
  });

  const boot = await Bridge.boot();
  if (boot) applySettings(boot.settings);
  await onEvent<Settings>("settings-changed", applySettings);
  let settle: number | null = null;
  await onEvent<OwlMood>("buddy-mood", (mood) => {
    islandMood = mood;
    // The island lets "finished" and "error" fade after a few seconds; so do we,
    // even if the island itself has folded away and stopped looking.
    if (settle != null) window.clearTimeout(settle);
    settle =
      mood === "finished" || mood === "error"
        ? window.setTimeout(() => {
            settle = null;
            islandMood = "idle";
            stir();
          }, 6500)
        : null;
    stir();
  });
  await onEvent<OwlEmote>("buddy-emote", (emote) => {
    stir();
    owl.triggerEmote(emote);
  });
  await onEvent<string | null>("buddy-accent", (accent) => {
    owl.accent = accent;
    stir();
  });
  if (IS_TAURI) {
    await getCurrentWindow().onMoved(() => {
      if (down || carried) carriedAlong();
    });
  }
  // Ask the island where things stand.
  await Bridge.toBuddy("buddy-ready", null);
  stir();

  if (!IS_TAURI) {
    // Plain browser (`npm run dev`, /buddy.html): no island to listen to, so
    // `nobetciBuddy.mood("danger")` / `.emote("approve")` in the console stand in.
    (window as unknown as { nobetciBuddy: unknown }).nobetciBuddy = {
      owl,
      mood: (m: OwlMood) => {
        islandMood = m;
        stir();
      },
      emote: (e: OwlEmote) => {
        stir();
        owl.triggerEmote(e);
      },
    };
  }
}

void main();
