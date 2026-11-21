// Joins the macOS disk image backgrounds (src-tauri/dmg/dmg.png and dmg@2x.png,
// drawn by scripts/installer-art.mjs) into one Retina TIFF, which Finder shows
// sharp on both kinds of screen. macOS only (tiffutil). Tauri runs it before
// every bundle on a Mac (beforeBundleCommand in src-tauri/tauri.macos.conf.json),
// so `npm run tauri build` works from a fresh clone; the TIFF itself is not
// committed.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

if (process.platform !== "darwin") {
  console.log("dmg-background: not on a Mac, nothing to do.");
  process.exit(0);
}
const dir = join(import.meta.dirname, "..", "src-tauri", "dmg");
execFileSync(
  "tiffutil",
  ["-cathidpicheck", join(dir, "dmg.png"), join(dir, "dmg@2x.png"), "-out", join(dir, "background.tiff")],
  { stdio: "inherit" },
);
console.log("dmg-background: wrote src-tauri/dmg/background.tiff");
