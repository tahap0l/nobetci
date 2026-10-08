// Builds nobetci-hook (the relay Claude Code runs on every hook event) in
// release mode, where the app bundle picks it up: target/release/nobetci-hook
// (.exe on Windows). Runs before `tauri dev`, `tauri build` and the tests —
// see the pre-scripts in package.json.
//
// Tauri tells the pre-build step which target it builds for in
// TAURI_ENV_TARGET_TRIPLE. For a macOS universal build
// (`tauri build --target universal-apple-darwin`) both architectures are built
// and merged with lipo, so the bundled relay runs on Apple silicon and Intel
// alike. Any other cross target is built for that target and copied into place.
// `npm run pack:mac` also says so outright (NOBETCI_RELAY=universal), so a
// universal app can never end up with a single-architecture relay.
//
//   node scripts/build-relay.mjs

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "nobetci-hook.exe" : "nobetci-hook";
const out = join(root, "target", "release");

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const build = (...extra) => run("cargo", ["build", "--release", "-p", "nobetci-hook", ...extra]);

const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1] ?? "";
const triple =
  process.env.NOBETCI_RELAY === "universal" ? "universal-apple-darwin" : (process.env.TAURI_ENV_TARGET_TRIPLE ?? "");

if (!triple || triple === host) {
  build();
} else if (triple === "universal-apple-darwin") {
  const arches = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  for (const t of arches) build("--target", t);
  mkdirSync(out, { recursive: true });
  run("lipo", ["-create", "-output", join(out, exe), ...arches.map((t) => join(root, "target", t, "release", exe))]);
  console.log(`relay: universal (${arches.join(" + ")}) → target/release/${exe}`);
} else {
  build("--target", triple);
  mkdirSync(out, { recursive: true });
  copyFileSync(join(root, "target", triple, "release", exe), join(out, exe));
  console.log(`relay: ${triple} → target/release/${exe}`);
}
