// Copies the installer Tauri buries under target/ into release/, with the name
// it ships under. The Store flavor is kept in release/store so it cannot be
// mistaken for the regular online installer.
//
//   Windows  release/Nobi-<version>-setup.exe  (+ Nobi-setup.exe)
//   Store    release/store/Nobi-<version>-setup.exe
//   macOS    release/Nobi-<version>-macos-<universal|arm64|x64>.dmg
//   Linux    release/Nobi-<version>-linux-<amd64|arm64>.deb and .AppImage

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release", process.argv.includes("--store") ? "store" : "");
const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

/** The command that builds this platform's package from scratch. */
const PACK = { darwin: "npm run pack:mac", linux: "npm run pack:linux" }[process.platform] ?? "npm run pack";

/**
 * Where cargo, and so `tauri build`, writes: <repo>/target unless
 * CARGO_TARGET_DIR or a cargo config moves it. Both are searched.
 */
function targetDirs() {
  const dirs = [join(root, "target")];
  try {
    const meta = execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    const dir = JSON.parse(meta).target_directory;
    if (dir) dirs.unshift(dir);
  } catch {
    if (process.env.CARGO_TARGET_DIR) dirs.unshift(resolve(root, process.env.CARGO_TARGET_DIR));
  }
  return [...new Set(dirs.map((d) => resolve(d)))];
}

/** Every `<dir>` under <target>/release/bundle and <target>/<triple>/release/bundle. */
function bundleDirs(kind) {
  const dirs = [];
  for (const target of targetDirs()) {
    dirs.push(join(target, "release", "bundle", kind));
    for (const entry of existsSync(target) ? readdirSync(target) : []) {
      dirs.push(join(target, entry, "release", "bundle", kind));
    }
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
    console.error(`No *${suffix} under target/**/release/bundle/${kind} — run \`${PACK}\`.`);
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
  // Tauri names it Nobi_<version>_<universal|aarch64|x64>.dmg.
  const arch = /_universal\.dmg$/.test(dmg) ? "universal" : /_aarch64\.dmg$/.test(dmg) ? "arm64" : "x64";
  ship(dmg, [`Nobi-${version}-macos-${arch}.dmg`]);
} else if (process.platform === "linux") {
  // Tauri names them nobi_<version>_amd64.deb and nobi_<version>_amd64.AppImage.
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  ship(newest("deb", ".deb"), [`Nobi-${version}-linux-${arch}.deb`]);
  ship(newest("appimage", ".AppImage"), [`Nobi-${version}-linux-${arch}.AppImage`]);
} else {
  ship(newest("nsis", "-setup.exe"), [`Nobi-${version}-setup.exe`, "Nobi-setup.exe"]);
}
