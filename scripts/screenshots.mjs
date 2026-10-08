// Renders the README screenshots from a running dev server with headless
// Microsoft Edge, in English and Turkish, into docs/media/<lang>/<name>.png.
//
//   npm run dev                                   # terminal 1: the UI with demo data
//   node scripts/screenshots.mjs                  # terminal 2: every image, both languages
//   node scripts/screenshots.mjs tr critical      # only some: languages and/or image names
//
// Environment:
//   NOBETCI_URL    dev server to capture (default http://127.0.0.1:1420)
//   NOBETCI_EDGE   path to msedge.exe (default: where Windows installs it)
//   NOBETCI_SCALE  device scale factor, e.g. 2 for high-DPI images (default 1)
//
// Dependency-free on purpose: Node built-ins and the Edge that ships with Windows.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "docs", "media");

const base = (process.env.NOBETCI_URL || "http://127.0.0.1:1420").replace(/\/*$/, "/");
const scale = Number(process.env.NOBETCI_SCALE || 1);
const edge =
  process.env.NOBETCI_EDGE ||
  [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => existsSync(p));

/** The island panel (PANEL_W × PANEL_H in src/island/layout.ts). */
const ISLAND = { width: 720, height: 460 };
/** The settings window's inner size (create_settings_window in src-tauri/src/lib.rs). */
const SETTINGS = { width: 1000, height: 740 };

const SHOTS = [
  { name: "critical", path: "?demo=critical", size: ISLAND },
  { name: "low", path: "?demo=low", size: ISLAND },
  { name: "overview", path: "?demo=overview", size: ISLAND },
  { name: "session", path: "?demo=session", size: ISLAND },
  { name: "compact", path: "?demo=compact", size: ISLAND },
  { name: "settings-rules", path: "settings.html?tab=kurallar", size: SETTINGS },
  { name: "settings-history", path: "settings.html?tab=gecmis", size: SETTINGS },
  { name: "settings-security", path: "settings.html?tab=guvenlik", size: SETTINGS },
  { name: "wizard", path: "settings.html?tab=hosgeldin", size: SETTINGS },
];

/** ?lang= picks the UI language; the browser locale backs it up. */
const LANGS = {
  en: { locale: "en-US", accept: "en-US,en" },
  tr: { locale: "tr-TR", accept: "tr-TR,tr" },
};

/** Per screenshot. Edge normally finishes in about a second. */
const TIMEOUT_MS = 60_000;
/** How long a PNG may take to show up after Edge exits (see waitForPng). */
const SETTLE_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** `node screenshots.mjs [en|tr]… [name]…` — no arguments means everything. */
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
    shots: names.length ? SHOTS.filter((s) => names.includes(s.name)) : SHOTS,
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
 * The PNG once it exists and has stopped growing. `--do-not-de-elevate` keeps
 * Edge in our process tree, but should a launcher still hand off to another
 * process and exit early, the file lands a moment later — wait for it.
 */
async function waitForPng(file) {
  const deadline = Date.now() + SETTLE_MS;
  let last = -1;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const bytes = statSync(file).size;
      if (bytes > 0 && bytes === last) return pngSize(file);
      last = bytes;
    }
    await sleep(150);
  }
  return existsSync(file) ? pngSize(file) : null;
}

/** Runs Edge once; on timeout the whole process tree goes, not just the parent. */
function runEdge(args) {
  return new Promise((done) => {
    const child = spawn(edge, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      done({ ok: false, why: `timed out after ${TIMEOUT_MS / 1000} s` });
    }, TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ ok: false, why: err.message });
    });
    child.on("exit", () => {
      clearTimeout(timer);
      done({ ok: true });
    });
  });
}

function shown(file) {
  return relative(root, file).split(sep).join("/");
}

async function main() {
  const { langs, shots } = selection(process.argv.slice(2));
  if (process.platform !== "win32") fail("This script drives Microsoft Edge on Windows.");
  if (!edge || !existsSync(edge)) fail("Microsoft Edge not found. Set NOBETCI_EDGE to the full path of msedge.exe.");
  if (!Number.isFinite(scale) || scale <= 0) fail(`NOBETCI_SCALE must be a positive number, got "${process.env.NOBETCI_SCALE}".`);
  if (!(await serverUp(base))) {
    fail(`No dev server at ${base} — start one with \`npm run dev\`, or point NOBETCI_URL at yours.`);
  }

  const profiles = mkdtempSync(join(tmpdir(), "nobetci-shots-"));
  console.log(`\n  Capturing ${base} with ${edge}\n`);

  const failed = [];
  let wrote = 0;
  try {
    for (const lang of langs) {
      const outDir = join(outRoot, lang);
      mkdirSync(outDir, { recursive: true });
      for (const shot of shots) {
        const file = join(outDir, `${shot.name}.png`);
        const url = new URL(shot.path, base);
        url.searchParams.set("lang", lang);
        // A fresh profile per image: no storage or preference leaks between shots.
        const profile = mkdtempSync(join(profiles, "p-"));
        rmSync(file, { force: true });

        const result = await runEdge([
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          `--user-data-dir=${profile}`,
          `--window-size=${shot.size.width},${shot.size.height}`,
          `--force-device-scale-factor=${scale}`,
          "--virtual-time-budget=6000",
          `--screenshot=${file}`,
          `--lang=${LANGS[lang].locale}`,
          `--accept-lang=${LANGS[lang].accept}`,
          // From an elevated shell Edge would relaunch itself de-elevated and exit
          // at once, leaving the screenshot to a process we cannot wait for.
          "--do-not-de-elevate",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          "--mute-audio",
          url.href,
        ]);

        const size = result.ok ? await waitForPng(file) : null;
        if (!size) {
          failed.push(`${shown(file)} — ${result.ok ? "Edge wrote no PNG" : result.why}`);
          console.log(`  ✗ ${shown(file)}  (${url.href})`);
          continue;
        }
        wrote++;
        const kb = Math.round(statSync(file).size / 1024);
        console.log(`  ✓ ${shown(file).padEnd(38)} ${`${size.width}×${size.height}`.padEnd(10)} ${String(kb).padStart(4)} KB   ${url.pathname}${url.search}`);
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
  if (failed.length) {
    console.error(`  ${failed.length} failed:\n${failed.map((f) => `    ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("");
}

await main();
