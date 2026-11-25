// Renders the README screenshots from a running dev server with headless
// Microsoft Edge (or any Chromium-based browser), in English and Turkish, into
// docs/media/<lang>/<name>.png.
//
//   npm run dev                                   # terminal 1: the UI with demo data
//   node scripts/screenshots.mjs                  # terminal 2: every README image, both languages
//   node scripts/screenshots.mjs tr critical      # only some: languages and/or image names
//
// Images the README does not show (marked onRequest below) are made only when named,
// so a full run never brings back files nothing uses.
//
// Environment:
//   NOBI_URL    dev server to capture (default http://127.0.0.1:1420)
//   NOBI_EDGE   path to msedge.exe (default: where Windows installs it); on
//                  macOS and Linux, the path to Edge, Chrome or Chromium
//   NOBI_SCALE  device scale factor, e.g. 2 for high-DPI images (default 1)
//   NOBI_OUT    output directory, relative to the repo root (default docs/media)
//
// Dependency-free on purpose: Node built-ins and the Edge that ships with Windows.
// Text is set in the system font, so images taken on another system differ in type.
//
// An image is taken when the page is ready, not after a fixed time budget: the
// script drives the browser over the DevTools protocol, through the pipe that
// --remote-debugging-pipe opens (file descriptors 3 and 4). It waits for the
// load event, the fonts and two frames, lets every animation that comes to an
// end finish, and then captures until two captures in a row are the same
// picture. (A virtual-time budget used to decide when to shoot; the island's
// first frames had sometimes not run by then, so the same page came out
// differently from one run to the next.)
//
// So that a page comes out the same on every run, and on every day, the browser
// also gets a pinned clock — it shows a fixed moment (UTC) until the page has
// loaded, runs for a few seconds and stops, which holds countdowns, "3 s ago",
// the playing track, the date and the timeline's times — a seeded Math.random
// (the demo's system load), no blinking text caret, and reduced motion, so the
// small mascots' rings stop pulsing. The demos themselves run with ?still=1
// (src/demo.ts).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(root, process.env.NOBI_OUT || "docs/media");

const base = (process.env.NOBI_URL || "http://127.0.0.1:1420").replace(/\/*$/, "/");
const scale = Number(process.env.NOBI_SCALE || 1);
const edge =
  process.env.NOBI_EDGE ||
  [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => existsSync(p));

/** The island panel (PANEL_W × PANEL_H in src/island/layout.ts). */
const ISLAND = { width: 720, height: 460 };
/** The top of the island at 16:9, for the README's first image and the website. */
const HERO = { width: 720, height: 405 };
/** The settings window's inner size (create_settings_window in src-tauri/src/lib.rs). */
const SETTINGS = { width: 1000, height: 740 };

const SHOTS = [
  { name: "critical", path: "?demo=critical", size: ISLAND },
  { name: "low", path: "?demo=low", size: ISLAND },
  { name: "overview", path: "?demo=overview", size: HERO },
  { name: "idle-island", path: "?demo=overview&theme=wolf&media=art", size: HERO },
  // Drawn at twice the size: the mascots are the whole picture. Fixed scenes
  // (a seeded engine, a fixed number of steps), drawn with motion on: reduced
  // motion would hold the reactions back.
  { name: "mascots", path: "?demo=mascots", size: { width: 720, height: 210 }, scale: 2, motion: true },
  { name: "reactions", path: "?demo=reactions", size: { width: 720, height: 210 }, scale: 2, motion: true },
  { name: "session", path: "?demo=session", size: ISLAND },
  { name: "question", path: "?demo=question", size: ISLAND },
  { name: "plan", path: "?demo=plan", size: ISLAND },
  { name: "batch", path: "?demo=batch", size: ISLAND },
  // The assistant with its prompt library open, and each card of the dashboard.
  { name: "assistant", path: "?demo=assistant&lib=1&text=", size: ISLAND },
  { name: "card-weather", path: "?demo=overview&media=art&weather=2&page=weather", size: HERO },
  { name: "card-agenda", path: "?demo=overview&media=art&page=agenda", size: HERO },
  { name: "card-calendar", path: "?demo=overview&media=art&page=calendar", size: HERO },
  { name: "card-system", path: "?demo=overview&media=art&page=system", size: HERO },
  // Made only when named: the README does not show the compact pill.
  { name: "compact", path: "?demo=compact", size: ISLAND, onRequest: true },
  { name: "settings-rules", path: "settings.html?tab=kurallar", size: SETTINGS },
  { name: "settings-history", path: "settings.html?tab=gecmis", size: SETTINGS },
  { name: "settings-security", path: "settings.html?tab=guvenlik", size: SETTINGS },
  // For the Microsoft Store listing (docs/microsoft-store.md), not the README: made only when named.
  { name: "settings-prompts", path: "settings.html?tab=prompts", size: SETTINGS, onRequest: true },
  { name: "wizard", path: "settings.html?tab=hosgeldin", size: SETTINGS },
];

/** ?lang= picks the UI language; the browser locale backs it up. */
const LANGS = {
  en: { locale: "en-US", accept: "en-US,en" },
  tr: { locale: "tr-TR", accept: "tr-TR,tr" },
};

/** Per screenshot, from starting the browser to closing it. It normally takes about six seconds. */
const TIMEOUT_MS = 60_000;
/** The moment the page's clock shows (UTC): a Tuesday morning. */
const CLOCK_AT = Date.UTC(2026, 10, 24, 9, 41);
/**
 * How long the page's clock runs after the load event before it stops. By then
 * the demos' own timers (a tab switched, a menu opened, text typed: within
 * 400 ms) have run and the system card has read its load twice (every 2 s), and
 * nothing waits on the clock any more.
 */
const CLOCK_RUNS_MS = 3_500;
/** The first capture comes after the clock stopped and the island's one-second refresh ran on it. */
const FIRST_CAPTURE_MS = CLOCK_RUNS_MS + 1_100;
/** Between two captures that have to match. */
const QUIET_MS = 300;
/** How long a page may keep changing before the last capture is kept anyway. */
const STEADY_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** `node screenshots.mjs [en|tr]… [name]…` — no names means every README image. */
function selection(args) {
  const isLang = (a) => Object.hasOwn(LANGS, a);
  const langs = args.filter(isLang);
  const names = args.filter((a) => !isLang(a));
  const unknown = names.filter((n) => !SHOTS.some((s) => s.name === n));
  if (unknown.length) {
    fail(`Unknown image: ${unknown.join(", ")}. Choose from: ${SHOTS.map((s) => s.name).join(", ")}, or a language (en, tr).`);
  }
  return {
    langs: langs.length ? langs : Object.keys(LANGS),
    shots: names.length ? SHOTS.filter((s) => names.includes(s.name)) : SHOTS.filter((s) => !s.onRequest),
  };
}

async function serverUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Width and height from a PNG's IHDR chunk, or null if it is not a PNG. */
function pngSize(file) {
  const buf = readFileSync(file);
  const signature = "89504e470d0a1a0a";
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * A DevTools protocol connection over the pipe a Chromium browser opens with
 * --remote-debugging-pipe: it reads commands on file descriptor 3 and writes
 * replies and events on 4, each message JSON ended by a NUL byte.
 */
class Devtools {
  #out;
  #next = 0;
  #calls = new Map();
  #waiters = new Set();
  #closed = null;

  constructor(child) {
    this.#out = child.stdio[3];
    const input = child.stdio[4];
    let parts = [];
    input.on("data", (chunk) => {
      let start = 0;
      for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, start)) {
        parts.push(chunk.subarray(start, end));
        this.#receive(Buffer.concat(parts).toString("utf8"));
        parts = [];
        start = end + 1;
      }
      if (start < chunk.length) parts.push(chunk.subarray(start));
    });
    input.on("close", () => this.#close(new Error("the browser closed the DevTools pipe")));
    input.on("error", (err) => this.#close(err));
    this.#out.on("error", (err) => this.#close(err));
  }

  #receive(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const call = this.#calls.get(message.id);
      if (!call) return;
      this.#calls.delete(message.id);
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
      else call.resolve(message.result);
      return;
    }
    for (const waiter of this.#waiters) {
      if (waiter.method === message.method && waiter.sessionId === message.sessionId) {
        this.#waiters.delete(waiter);
        waiter.resolve(message.params);
      }
    }
  }

  #close(err) {
    if (this.#closed) return;
    this.#closed = err;
    for (const call of this.#calls.values()) call.reject(err);
    for (const waiter of this.#waiters) waiter.reject(err);
    this.#calls.clear();
    this.#waiters.clear();
  }

  /** Sends a command (to the page when `sessionId` is given) and resolves with its result. */
  send(method, params = {}, sessionId) {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#calls.set(id, { method, resolve, reject });
      this.#out.write(`${JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })}\0`);
    });
  }

  /** The next `method` event of the page `sessionId`. Ask before causing it. */
  next(method, sessionId) {
    if (this.#closed) return Promise.reject(this.#closed);
    return new Promise((resolve, reject) => this.#waiters.add({ method, sessionId, resolve, reject }));
  }
}

/**
 * Runs in the page before any of its own scripts: Date shows CLOCK_AT until the
 * load event, then runs for CLOCK_RUNS_MS and stops (animation frames keep
 * their real time), so the demo's data is made at the same moment however long
 * the page took to load; and Math.random is a seeded generator (mulberry32).
 */
const PINNED = `(() => {
  const Real = Date;
  let loaded = Infinity;
  addEventListener("load", () => { loaded = performance.now(); }, { once: true });
  const at = () => ${CLOCK_AT} + Math.min(Math.max(performance.now() - loaded, 0), ${CLOCK_RUNS_MS});
  function Pinned(...args) {
    if (!new.target) return new Real(at()).toString();
    return args.length ? new Real(...args) : new Real(at());
  }
  Pinned.prototype = Real.prototype;
  Pinned.now = () => Math.floor(at());
  Pinned.parse = Real.parse;
  Pinned.UTC = Real.UTC;
  globalThis.Date = Pinned;
  let seed = 0x2f6b1;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})()`;

/**
 * Runs in the page once it has loaded: hides the text caret (it blinks), then
 * waits for the fonts, two frames (a demo lays the island out, then snaps it
 * into place), every animation that ends — a still demo jumps its animations
 * to their end — and two more frames. Anything that keeps moving is left to
 * the capture loop.
 */
const READY = `(async () => {
  const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
  const caret = document.createElement("style");
  caret.textContent = "*, *::before, *::after { caret-color: transparent !important; }";
  document.head.append(caret);
  await document.fonts.ready;
  await frame();
  await frame();
  const until = performance.now() + 5000;
  for (;;) {
    const ending = document.getAnimations().filter(
      (a) => a.playState === "running" && a.effect && a.effect.getComputedTiming().endTime !== Infinity,
    );
    if (!ending.length || performance.now() > until) break;
    await Promise.race([Promise.allSettled(ending.map((a) => a.finished)), new Promise((done) => setTimeout(done, 250))]);
  }
  await frame();
  await frame();
  return true;
})()`;

/** Ends the browser and everything it started, if it is still there. */
function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

/**
 * Opens `url` in a fresh headless browser at `size` × `dpr` and writes the
 * picture to `file` once the page is ready and has stopped changing. Resolves
 * with whether it settled; throws when there is no picture.
 */
async function capture({ url, size, dpr, reducedMotion, profile, locale, file }) {
  const child = spawn(
    edge,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      `--window-size=${size.width},${size.height}`,
      `--force-device-scale-factor=${dpr}`,
      // Chromium refuses to start its sandbox as root (containers, CI).
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      ...(reducedMotion ? ["--force-prefers-reduced-motion"] : []),
      `--lang=${locale.locale}`,
      `--accept-lang=${locale.accept}`,
      // From an elevated shell Edge would relaunch itself de-elevated and exit
      // at once, taking the DevTools pipe with it.
      "--do-not-de-elevate",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--mute-audio",
      "--remote-debugging-pipe",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true },
  );
  const exited = new Promise((done) => child.once("exit", done));
  // Only a browser that cannot be started at all emits "error".
  const failedToStart = new Promise((_, reject) => child.once("error", reject));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    kill(child);
  }, TIMEOUT_MS);
  const devtools = new Devtools(child);
  try {
    return await Promise.race([failedToStart, shoot(devtools, { url, size, dpr, reducedMotion, file })]);
  } catch (err) {
    throw timedOut ? new Error(`timed out after ${TIMEOUT_MS / 1000} s`) : err;
  } finally {
    clearTimeout(timer);
    await Promise.race([devtools.send("Browser.close").catch(() => {}), sleep(3000)]);
    await Promise.race([exited, sleep(3000)]);
    kill(child);
  }
}

async function shoot(devtools, { url, size, dpr, reducedMotion, file }) {
  const { targetId } = await devtools.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await devtools.send("Target.attachToTarget", { targetId, flatten: true });
  await devtools.send("Page.enable", {}, sessionId);
  await devtools.send(
    "Emulation.setDeviceMetricsOverride",
    { width: size.width, height: size.height, deviceScaleFactor: dpr, mobile: false },
    sessionId,
  );
  if (reducedMotion) {
    await devtools.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, sessionId);
  }
  await devtools.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" }, sessionId);
  await devtools.send("Page.addScriptToEvaluateOnNewDocument", { source: PINNED }, sessionId);
  const loaded = devtools.next("Page.loadEventFired", sessionId);
  // Awaited below; this only keeps a failed navigation from leaving it unhandled.
  loaded.catch(() => {});
  const navigation = await devtools.send("Page.navigate", { url }, sessionId);
  if (navigation.errorText) throw new Error(`could not open the page (${navigation.errorText})`);
  await loaded;
  const loadedAt = Date.now();
  const ready = await devtools.send("Runtime.evaluate", { expression: READY, awaitPromise: true, returnByValue: true }, sessionId);
  if (ready.exceptionDetails) throw new Error(`the page failed to settle: ${ready.exceptionDetails.text}`);
  // Until the page's clock has stopped and the page has drawn with it.
  await sleep(Math.max(0, FIRST_CAPTURE_MS - (Date.now() - loadedAt)));

  // Captures until two in a row are the same picture. A page that keeps
  // changing (a clock, a spinner) gets its last capture after STEADY_MS.
  const until = Date.now() + STEADY_MS;
  let previous = null;
  let data;
  let settled = false;
  for (;;) {
    ({ data } = await devtools.send("Page.captureScreenshot", { format: "png" }, sessionId));
    if (data === previous) {
      settled = true;
      break;
    }
    if (Date.now() >= until) break;
    previous = data;
    await sleep(QUIET_MS);
  }
  writeFileSync(file, Buffer.from(data, "base64"));
  return settled;
}

function shown(file) {
  return relative(root, file).split(sep).join("/");
}

async function main() {
  const { langs, shots } = selection(process.argv.slice(2));
  if (!edge || !existsSync(edge)) {
    fail(
      process.platform === "win32"
        ? "Microsoft Edge not found. Set NOBI_EDGE to the full path of msedge.exe."
        : "Set NOBI_EDGE to the full path of Edge, Chrome or Chromium.",
    );
  }
  if (!Number.isFinite(scale) || scale <= 0) fail(`NOBI_SCALE must be a positive number, got "${process.env.NOBI_SCALE}".`);
  if (!(await serverUp(base))) {
    fail(`No dev server at ${base} — start one with \`npm run dev\`, or point NOBI_URL at yours.`);
  }

  const profiles = mkdtempSync(join(tmpdir(), "nobi-shots-"));
  console.log(`\n  Capturing ${base} with ${edge}\n`);

  const failed = [];
  const unsettled = [];
  let wrote = 0;
  try {
    for (const lang of langs) {
      const outDir = join(outRoot, lang);
      mkdirSync(outDir, { recursive: true });
      for (const shot of shots) {
        const file = join(outDir, `${shot.name}.png`);
        const url = new URL(shot.path, base);
        url.searchParams.set("lang", lang);
        // Animations at their end, and a mascot that holds still (src/demo.ts).
        if (url.searchParams.has("demo")) url.searchParams.set("still", "1");
        // With reduced motion the settings window's tab is simply there instead
        // of fading in, and the island's small mascots keep their rings still.
        const reducedMotion = !shot.motion;
        // A fresh profile per image: no storage or preference leaks between shots.
        const profile = mkdtempSync(join(profiles, "p-"));
        rmSync(file, { force: true });

        let settled;
        try {
          settled = await capture({
            url: url.href,
            size: shot.size,
            dpr: scale * (shot.scale ?? 1),
            reducedMotion,
            profile,
            locale: LANGS[lang],
            file,
          });
        } catch (err) {
          failed.push(`${shown(file)} — ${err.message}`);
          console.log(`  ✗ ${shown(file)}  (${url.href})`);
          continue;
        }
        const size = existsSync(file) ? pngSize(file) : null;
        if (!size) {
          failed.push(`${shown(file)} — the browser sent no PNG`);
          console.log(`  ✗ ${shown(file)}  (${url.href})`);
          continue;
        }
        wrote++;
        if (!settled) unsettled.push(shown(file));
        const kb = Math.round(statSync(file).size / 1024);
        const note = settled ? "" : "   (still changing after 10 s: kept the last capture)";
        console.log(`  ✓ ${shown(file).padEnd(38)} ${`${size.width}×${size.height}`.padEnd(10)} ${String(kb).padStart(4)} KB   ${url.pathname}${url.search}${note}`);
      }
    }
  } finally {
    // Edge's helper processes can hold the profile for a moment after it exits.
    // A leftover temp folder is not worth failing a run over.
    try {
      rmSync(profiles, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err) {
      console.warn(`  (could not remove the temporary Edge profiles in ${profiles}: ${err.code ?? err.message})`);
    }
  }

  console.log(`\n  Wrote ${wrote} image${wrote === 1 ? "" : "s"} to ${shown(outRoot)}/.`);
  if (unsettled.length) console.log(`  Never stopped changing, check by eye: ${unsettled.join(", ")}`);
  if (failed.length) {
    console.error(`  ${failed.length} failed:\n${failed.map((f) => `    ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("");
}

await main();
