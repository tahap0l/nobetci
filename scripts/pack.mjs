// Copies the installer Tauri buries under target/ into release/, with the name
// it ships under. Used by `npm run pack` / `npm run pack:mac` and by the release
// workflow, so all of them produce exactly the same file names:
//
//   Windows  release/Nobetci-<version>-setup.exe  (+ Nobetci-setup.exe)
//   macOS    release/Nobetci-<version>-macos-<universal|arm64|x64>.dmg

import { readFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release");
const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

/** Every `<dir>` under target/release/bundle and target/<triple>/release/bundle. */
function bundleDirs(kind) {
  const target = join(root, "target");
  const dirs = [join(target, "release", "bundle", kind)];
  for (const entry of existsSync(target) ? readdirSync(target) : []) {
    dirs.push(join(target, entry, "release", "bundle", kind));
  }
  return dirs.filter((d) => existsSync(d));
}

/** The newest file ending in `suffix`, in case an older build is still lying around. */
function newest(kind, suffix) {
  const files = bundleDirs(kind).flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.endsWith(suffix))
      .map((f) => join(d, f)),
  );
  if (files.length === 0) {
    console.error(`No *${suffix} under target/**/release/bundle/${kind} — run \`npm run tauri build\` first.`);
    process.exit(1);
  }
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function ship(src, names) {
  mkdirSync(outDir, { recursive: true });
  const paths = names.map((n) => join(outDir, n));
  for (const p of paths) copyFileSync(src, p);
  const mb = (statSync(paths[0]).size / 1024 / 1024).toFixed(2);
  console.log(`\n  Installer ready — ${mb} MB\n`);
  for (const p of paths) console.log(`  ${p}`);
  console.log("");
}

if (process.platform === "darwin") {
  const dmg = newest("dmg", ".dmg");
  // Tauri names it Nobetci_<version>_<universal|aarch64|x64>.dmg.
  const arch = /_universal\.dmg$/.test(dmg) ? "universal" : /_aarch64\.dmg$/.test(dmg) ? "arm64" : "x64";
  ship(dmg, [`Nobetci-${version}-macos-${arch}.dmg`]);
} else {
  ship(newest("nsis", "-setup.exe"), [`Nobetci-${version}-setup.exe`, "Nobetci-setup.exe"]);
}
