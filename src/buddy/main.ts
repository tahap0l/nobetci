// The desktop mascot window (src-tauri/src/buddy.rs): the island's mascot in a
// small window of its own, dragged anywhere with the mouse.
//
// It only shows what is going on. The island sends it its mood and its
// reactions (`buddy-mood`, `buddy-emote`); a double click opens the island, where
// every decision is still taken, and a single click pokes it. Dragging spreads
// its wings, letting go lands it.
//
// Like the island it draws only while something moves: once it has nodded off
// (two minutes of calm, or as soon as the island itself sleeps or Nobi is
// paused) the frame loop stops and costs nothing until something stirs it. With
// the system's "reduce motion" setting the engine keeps still, so the loop also
// stops whenever nothing changes.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { OwlEngine, type OwlEmote, type OwlMood } from "../baykus/owl";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import type { MascotTheme } from "../core/mascot-theme";
import type { Settings } from "../core/settings-model";
import { guardWebview } from "../core/webview";

/** How far the pointer must travel with the button down before it is a drag. */
const DRAG_SLOP = 4;
/** No moves for this long and the drag is over. */
const LANDING_MS = 180;
/** Calm for this long and the mascot falls asleep (and the loop stops). */
const DOZE_MS = 120_000;
/**
 * A single click waits this long for a second one before it counts as a poke:
 * the two presses of a double click (which opens the island) are not pokes.
 * As long as the systems' own double-click time (500 ms on Windows and macOS,
 * 400 ms in GTK), so a double click at the usual pace never pokes first.
 */
const POKE_DELAY_MS = 500;
/** A double click this soon after a poke played was meant as one: no frown then. */
const POKE_REGRET_MS = 900;
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
let dozeTimer: number | null = null;
/**
 * It has nodded off: nothing is left to wait for, so no timer and no frame
 * until something stirs it (mascots-buddy#0 — a doze check that kept coming
 * back redrew the sleeping mascot about 15 times a second, forever).
 */
let asleep = false;

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
  asleep = false;
  owl.setMood(islandMood === "sleeping" ? "idle" : islandMood);
  wake();
}

/**
 * Nods off now: the loop draws it closing its eyes, then stops. (The margin
 * covers a frame whose time stamp is a little older than this call.)
 */
function doze() {
  if (asleep || carried) return;
  lastStir = Math.min(lastStir, performance.now() - DOZE_MS - 1_000);
  wake();
}

function wake() {
  if (dozeTimer != null) {
    window.clearTimeout(dozeTimer);
    dozeTimer = null;
  }
  if (running || document.hidden) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

/** Waiting requests and work keep it awake; plain idling does not. */
function mayDoze(): boolean {
  return islandMood === "idle" || islandMood === "finished" || islandMood === "sleeping";
}

/**
 * A still mascot (reduced motion) stops its loop while awake: come back when it
 * is time to nod off, so it still falls asleep after two calm minutes. Once it
 * sleeps there is nothing to come back for.
 */
function scheduleDoze() {
  if (dozeTimer != null || asleep || !mayDoze() || carried) return;
  const left = DOZE_MS - (performance.now() - lastStir);
  dozeTimer = window.setTimeout(() => {
    dozeTimer = null;
    wake();
  }, Math.max(0, left) + 50);
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!asleep && mayDoze() && !carried && now - lastStir > DOZE_MS) {
    asleep = true;
    owl.setMood("sleeping");
  }

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
  else {
    running = false;
    if (!document.hidden) scheduleDoze();
  }
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
  down = null;
  stir();
});

// A click that was not a drag pokes the mascot, unless it was half of a double
// click: the poke waits a moment and a second click cancels it.
let pokeTimer: number | null = null;
/** When the last poke played (performance.now()), to take its frown back. */
let pokedAt = -Infinity;
function cancelPoke() {
  if (pokeTimer == null) return;
  window.clearTimeout(pokeTimer);
  pokeTimer = null;
}
canvas.addEventListener("click", (e) => {
  if (dragged || e.button !== 0) return;
  cancelPoke();
  if (e.detail > 1) return; // the second (or third) press of a double click
  pokeTimer = window.setTimeout(() => {
    pokeTimer = null;
    pokedAt = performance.now();
    owl.poke();
    stir();
  }, POKE_DELAY_MS);
});

// Ctrl (⌘ on a Mac) + wheel resizes the mascot, ten percent a notch.
let wheelAt = 0;
canvas.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelAt < 90) return;
  wheelAt = now;
  void Bridge.buddyResizeBy(e.deltaY < 0 ? 10 : -10);
}, { passive: false });

// A double click opens the island — on the waiting card, if there is one — and
// the mascot waves to say so. A double click slower than the poke's wait (a
// system set to a long double-click time) let the first press poke already:
// its frown gives way to a smile (M-16, mascots-buddy#1).
canvas.addEventListener("dblclick", () => {
  cancelPoke();
  if (performance.now() - pokedAt < POKE_REGRET_MS) {
    pokedAt = -Infinity;
    owl.triggerEmote("happy");
  }
  owl.wave();
  stir();
  void Bridge.buddyOpenIsland();
});

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

let settle: number | null = null;

/** The island's mood (`buddy-mood`). */
function islandSays(mood: OwlMood) {
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
  // The island nodding off — or Nobi paused — is no news to wake up for: the
  // mascot nods off with it and stops drawing.
  if (mood === "sleeping") doze();
  else stir();
}

async function main() {
  // No webview context menu or reload keys in the app window (D12).
  if (IS_TAURI) guardWebview();
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
  await onEvent<OwlMood>("buddy-mood", islandSays);
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
  // Ask the island where things stand. Rust passes the question on, so this
  // window never sends an event of its own (it has no right to, C-13).
  await Bridge.buddyReady();
  stir();

  if (!IS_TAURI) {
    // Plain browser (`npm run dev`, /buddy.html): no island to listen to, so
    // `nobiBuddy.mood("danger")` / `.emote("approve")` in the console stand in.
    (window as unknown as { nobiBuddy: unknown }).nobiBuddy = {
      owl,
      mood: islandSays,
      emote: (e: OwlEmote) => {
        stir();
        owl.triggerEmote(e);
      },
    };
  }
}

void main();
