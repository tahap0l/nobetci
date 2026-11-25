// Builds nobi-hook (the relay Claude Code runs on every hook event) in
// release mode, where the app bundle picks it up: target/release/nobi-hook
// (.exe on Windows). Runs before `tauri dev`, `tauri build` and the tests —
// see the pre-scripts in package.json.
//
// Tauri tells the pre-build step which target it builds for in
// TAURI_ENV_TARGET_TRIPLE. For a macOS universal build
// (`tauri build --target universal-apple-darwin`) both architectures are built
// and merged with lipo, so the bundled relay runs on Apple silicon and Intel
// alike. Any other cross target is built for that target and copied into place.
// `npm run pack:mac` also says so outright (NOBI_RELAY=universal), so a
// universal app can never end up with a single-architecture relay.
//
// The relay always goes to <repo>/target, even when CARGO_TARGET_DIR (or a
// cargo config) moves cargo's own output elsewhere: the platform configs in
// src-tauri bundle ../target/release/nobi-hook from there.
//
//   node scripts/build-relay.mjs

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "nobi-hook.exe" : "nobi-hook";
const target = join(root, "target");
const out = join(target, "release");

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const build = (...extra) => run("cargo", ["build", "--release", "-p", "nobi-hook", "--target-dir", target, ...extra]);

/**
 * Cargo makes target/release/nobi-hook a hard link to its own native build
 * in target/release/deps. Writing a cross-built relay through that link would
 * replace the native build too, and cargo, finding it up to date, would never
 * build it again: every later native package would carry the wrong
 * architecture. Removing the link first makes the copy a file of its own.
 */
function freshFile(path) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  return path;
}

const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1] ?? "";
const triple =
  process.env.NOBI_RELAY === "universal" ? "universal-apple-darwin" : (process.env.TAURI_ENV_TARGET_TRIPLE ?? "");

if (!triple || triple === host) {
  build();
} else if (triple === "universal-apple-darwin") {
  const arches = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  for (const t of arches) build("--target", t);
  run("lipo", ["-create", "-output", freshFile(join(out, exe)), ...arches.map((t) => join(target, t, "release", exe))]);
  console.log(`relay: universal (${arches.join(" + ")}) → target/release/${exe}`);
} else {
  build("--target", triple);
  copyFileSync(join(target, triple, "release", exe), freshFile(join(out, exe)));
  console.log(`relay: ${triple} → target/release/${exe}`);
}
