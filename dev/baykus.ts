// Dev preview for the owl: every mood at three sizes, a native-pixel 20 px
// strip, emote/blink/poke controls, mini heads, the launch greeting and the
// generated app icons.
//
// Snapshot params make headless screenshots reproducible, e.g.
//   ?t=1.2&look=0.6,0.2&emote=hoot&accent=%233B9EFF&poke3
// pre-simulates t seconds at 60 Hz, then pauses.

import { OwlEngine, type OwlEmote, type OwlMood } from "../src/baykus/owl";
import { drawOwlMini } from "../src/baykus/mini";
import { OwlGreeting } from "../src/baykus/greeting";

const MOODS: OwlMood[] = [
  "idle", "working", "thinking", "approval", "danger",
  "question", "error", "finished", "sleeping", "dizzy",
];
const EMOTES: OwlEmote[] = ["happy", "love", "annoyed", "surprised", "hoot"];
const SIZES = [20, 56, 140];
const OVERHANG = 40;
const STRIP_CELL = 30;
const STRIP_ZOOM = 5;
const ACCENTS: (string | null)[] = [null, "#F5A524", "#3B9EFF", "#34D399", "#F472B6"];

interface Slot {
  owl: OwlEngine;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

const dpr = Math.max(1, window.devicePixelRatio || 1);
const app = document.getElementById("app") as HTMLDivElement;
const q = new URLSearchParams(location.search);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function makeCanvas(cssW: number, cssH: number, scale = dpr): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = el("canvas");
  c.width = Math.round(cssW * scale);
  c.height = Math.round(cssH * scale);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  return el("button", { textContent: label, onclick: onClick });
}

// ── State ───────────────────────────────────────────────────────────────────

const slots: Slot[] = [];
const allOwls: OwlEngine[] = [];
const moodBusy: { owls: OwlEngine[]; badge: HTMLSpanElement }[] = [];
let paused = false;
let speed = 1;
let clock = 0;
let accentIdx = 0;

function addOwl(mood: OwlMood): OwlEngine {
  const owl = new OwlEngine();
  owl.setMood(mood);
  allOwls.push(owl);
  return owl;
}

// ── Controls ────────────────────────────────────────────────────────────────

const emoteBar = el("div", { className: "bar" }, el("span", { className: "lbl", textContent: "all owls" }));
for (const e of EMOTES) emoteBar.append(button(e, () => allOwls.forEach((o) => o.triggerEmote(e))));
emoteBar.append(
  button("blink", () => allOwls.forEach((o) => o.blink())),
  button("poke", () => allOwls.forEach((o) => o.poke())),
  button("poke ×3", () => {
    for (let i = 0; i < 3; i++) setTimeout(() => allOwls.forEach((o) => o.poke()), i * 180);
  }),
);
const accentBtn = button("accent: none", () => {
  accentIdx = (accentIdx + 1) % ACCENTS.length;
  const a = ACCENTS[accentIdx];
  accentBtn.textContent = `accent: ${a ?? "none"}`;
  for (const o of allOwls) o.accent = a;
});
const pauseBtn = button("pause", () => {
  paused = !paused;
  pauseBtn.classList.toggle("on", paused);
});
const slowBtn = button("slow-mo", () => {
  speed = speed === 1 ? 0.25 : 1;
  slowBtn.classList.toggle("on", speed !== 1);
});
app.append(
  emoteBar,
  el("div", { className: "bar" }, el("span", { className: "lbl", textContent: "view" }), accentBtn, pauseBtn, slowBtn),
);

// ── 20 px strip at native pixels (no DPR), zoomed ───────────────────────────

app.append(el("h2", { textContent: `Compact island: every mood at 20 px, native pixels, zoomed ×${STRIP_ZOOM}` }));
const stripW = STRIP_CELL * MOODS.length;
const stripH = 20 + OVERHANG;
const [stripCanvas, stripCtx] = makeCanvas(stripW, stripH, 1);
const [stripZoomCanvas, stripZoom] = makeCanvas(stripW * STRIP_ZOOM, stripH * STRIP_ZOOM, 1);
stripZoomCanvas.className = "zoom";
stripZoom.imageSmoothingEnabled = false;
const stripOwls = MOODS.map((m) => addOwl(m));
const stripLabels = el("div", { className: "strip-labels" });
stripLabels.style.width = `${stripW * STRIP_ZOOM}px`;
for (const m of MOODS) stripLabels.append(el("span", { textContent: m }));
app.append(el("div", { className: "island strip" }, stripCanvas), stripZoomCanvas, stripLabels);

// ── Mood cards ──────────────────────────────────────────────────────────────

app.append(el("h2", { textContent: "Moods at 20 / 56 / 140 px (click to poke)" }));
const grid = el("div", { className: "cards" });
for (const mood of MOODS) {
  const badge = el("span", { className: "badge" });
  const island = el("div", { className: "island" });
  const owls: OwlEngine[] = [];
  for (const w of SIZES) {
    const h = w + OVERHANG;
    const [canvas, ctx] = makeCanvas(w, h);
    const owl = addOwl(mood);
    canvas.addEventListener("click", () => owl.poke());
    owl.onDizzy = () => console.log(`[${mood} @${w}] dizzy!`);
    slots.push({ owl, canvas, ctx, w, h });
    owls.push(owl);
    island.append(canvas);
  }
  moodBusy.push({ owls, badge });
  grid.append(el("div", { className: "card" }, el("div", { className: "head" }, mood, badge), island));
}
app.append(grid);

// ── Transition playground ───────────────────────────────────────────────────

app.append(el("h2", { textContent: "Transitions (one owl, 140 px)" }));
const playBar = el("div", { className: "bar" });
const [pc, pctx] = makeCanvas(140, 180);
const play: Slot = { owl: addOwl("idle"), canvas: pc, ctx: pctx, w: 140, h: 180 };
pc.addEventListener("click", () => play.owl.poke());
slots.push(play);
for (const m of MOODS) playBar.append(button(m, () => play.owl.setMood(m)));
app.append(playBar, el("div", { className: "island" }, pc));

// ── Mini heads ──────────────────────────────────────────────────────────────

app.append(el("h2", { textContent: "Mini heads at 14 / 18 px (+ 18 px zoomed ×6)" }));
const miniGrid = el("div", { className: "minis" });
const minis: { mood: OwlMood; ctxs: CanvasRenderingContext2D[]; zoom: CanvasRenderingContext2D; src: HTMLCanvasElement }[] = [];
for (const mood of MOODS) {
  const [c14, x14] = makeCanvas(14, 14);
  const [c18, x18] = makeCanvas(18, 18);
  const [zc, zx] = makeCanvas(18 * 6, 18 * 6, 1);
  zc.className = "zoom";
  zx.imageSmoothingEnabled = false;
  minis.push({ mood, ctxs: [x14, x18], zoom: zx, src: c18 });
  miniGrid.append(el("div", { className: "mini" }, el("div", { className: "row" }, c14, c18), zc, mood));
}
app.append(miniGrid);

// ── Greeting ────────────────────────────────────────────────────────────────

app.append(el("h2", { textContent: "Greeting (640 × 150, hover it for a reaction)" }));
const [gc, gctx] = makeCanvas(640, 150);
gc.id = "greet";
const greeting = new OwlGreeting();
const greetState = el("span", { className: "lbl" });
greeting.onComplete = () => (greetState.textContent = "onComplete fired");
gc.addEventListener("mouseenter", () => greeting.hover());
app.append(
  el("div", { className: "bar" },
    button("replay", () => {
      greetState.textContent = "";
      greeting.start();
    }),
    button("interrupt", () => greeting.interrupt()),
    greetState,
  ),
  gc,
);
greeting.start();
{
  // ?gt=1.4 renders the greeting frozen at that moment (fake clock at 60 Hz).
  const gt = Number(q.get("gt"));
  if (Number.isFinite(gt) && gt > 0) {
    let fake = 0;
    performance.now = () => fake;
    greeting.start();
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (; fake < gt * 1000; fake += 1000 / 60) greeting.draw(gctx);
    if (q.has("ghover")) greeting.hover();
  }
}

// ── Icons ───────────────────────────────────────────────────────────────────

app.append(el("h2", { textContent: "Generated icons on dark / light taskbars (16, 24, 32, 64, 128)" }));
const icons = el("div", { className: "icons" });
const bust = Date.now();
for (const bg of ["#1f1f1f", "#f3f3f3"]) {
  const box = el("div");
  box.style.background = bg;
  const set = [["32x32.png", 16], ["32x32.png", 24], ["32x32.png", 32], ["128x128.png", 64], ["128x128.png", 128]] as const;
  for (const [src, size] of set) {
    box.append(el("img", { src: `/src-tauri/icons/${src}?v=${bust}`, width: size, height: size }));
  }
  icons.append(box);
}
app.append(icons);

// ── Look + loop ─────────────────────────────────────────────────────────────

let mx = window.innerWidth / 2;
let my = window.innerHeight / 2;
window.addEventListener("mousemove", (e) => {
  mx = e.clientX;
  my = e.clientY;
});

const fixedLook = q.get("look")?.split(",").map(Number) ?? null;

function aimAt(owl: OwlEngine, r: DOMRect): void {
  if (fixedLook) {
    owl.lookX = fixedLook[0] || 0;
    owl.lookY = fixedLook[1] || 0;
    return;
  }
  owl.lookX = Math.max(-1, Math.min(1, (mx - (r.left + r.width / 2)) / 300));
  owl.lookY = Math.max(-1, Math.min(1, -(my - (r.top + r.height / 2)) / 300));
}

function aimAll(): void {
  for (const s of slots) aimAt(s.owl, s.canvas.getBoundingClientRect());
  const sr = stripCanvas.getBoundingClientRect();
  for (const o of stripOwls) aimAt(o, sr);
}

{
  const acc = q.get("accent");
  if (acc) for (const o of allOwls) o.accent = acc;
  const pre = Number(q.get("t"));
  if (Number.isFinite(pre) && pre > 0) {
    const emote = q.get("emote") as OwlEmote | null;
    if (emote) allOwls.forEach((o) => o.triggerEmote(emote));
    const pokes = q.has("poke3") ? [0, 0.15, 0.3] : q.has("poke") ? [0] : [];
    const step = 1 / 60;
    aimAll();
    for (let tt = 0; tt < pre; tt += step) {
      for (const p of pokes) if (p >= tt && p < tt + step) allOwls.forEach((o) => o.poke());
      for (const o of allOwls) o.update(step);
      clock += step;
    }
    paused = true;
    pauseBtn.classList.add("on");
  }
}

if (q.has("bench")) {
  // ?bench: time update+draw per frame at each size, printed into the page.
  const out = el("pre", { id: "bench" });
  const lines: string[] = [];
  for (const [w, mood] of [[20, "idle"], [56, "idle"], [140, "idle"], [140, "danger"], [140, "dizzy"]] as const) {
    const [, ctx] = makeCanvas(w, w + OVERHANG);
    const owl = new OwlEngine(7);
    owl.setMood(mood);
    owl.accent = "#3B9EFF";
    const n = 3000;
    for (let i = 0; i < 200; i++) owl.update(1 / 60);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      owl.update(1 / 60);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w + OVERHANG);
      owl.draw(ctx, w, w + OVERHANG);
    }
    lines.push(`${String(w).padStart(3)} px ${mood.padEnd(7)} ${(((performance.now() - t0) / n) * 1000).toFixed(1)} µs/frame`);
  }
  out.textContent = lines.join("\n");
  document.body.prepend(out);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000) * speed;
  last = now;
  if (!paused) clock += dt;
  aimAll();
  if (!paused) for (const o of allOwls) o.update(dt);

  for (const { owl, ctx, w, h } of slots) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    owl.draw(ctx, w, h);
  }

  stripCtx.setTransform(1, 0, 0, 1, 0, 0);
  stripCtx.clearRect(0, 0, stripW, stripH);
  stripOwls.forEach((o, i) => {
    stripCtx.setTransform(1, 0, 0, 1, i * STRIP_CELL + (STRIP_CELL - 20) / 2, 0);
    o.draw(stripCtx, 20, stripH);
  });
  stripZoom.clearRect(0, 0, stripZoom.canvas.width, stripZoom.canvas.height);
  stripZoom.drawImage(stripCanvas, 0, 0, stripZoom.canvas.width, stripZoom.canvas.height);

  for (const { owls, badge } of moodBusy) {
    const busy = owls.some((o) => o.busy);
    badge.textContent = busy ? "busy" : "rest";
    badge.classList.toggle("rest", !busy);
  }

  for (const m of minis) {
    m.ctxs.forEach((ctx, i) => {
      const size = i === 0 ? 14 : 18;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawOwlMini(ctx, size / 2, size / 2, size, m.mood, ACCENTS[accentIdx] ?? q.get("accent"), clock);
    });
    m.zoom.clearRect(0, 0, m.zoom.canvas.width, m.zoom.canvas.height);
    m.zoom.drawImage(m.src, 0, 0, m.zoom.canvas.width, m.zoom.canvas.height);
  }

  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  greeting.draw(gctx);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
