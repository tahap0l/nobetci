// Release notes for one version: its CHANGELOG.md section plus a short footer on
// installing and verifying. Used by .github/workflows/release.yml.
//
//   node .github/scripts/release-notes.mjs 0.2.0 [--out RELEASE_NOTES.md]
//
// The section runs from its "## [0.2.0] - …" heading to the next "## " heading.
// A pre-release (0.3.0-beta.1) without a section of its own falls back to
// "## [Unreleased]". Anything else without a section is an error: a release
// should never go out without notes.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && !(outAt >= 0 && i === outAt + 1));
const version = positional[0]?.replace(/^v/, "");

if (!version || (outAt >= 0 && !out)) {
  console.error("usage: node .github/scripts/release-notes.mjs <version> [--out <file>]");
  process.exit(2);
}

const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lines = changelog.split("\n");

/** The body under `## [name]` (or `## name`), without link definitions; null if absent. */
function section(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+\\[?${escaped}\\]?(\\s|$)`, "i");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .filter((l) => !/^\[[^\]]+\]:\s+\S/.test(l))
    .join("\n")
    .trim();
}

/**
 * Joins hard-wrapped lines back into one line per paragraph or list item. The
 * CHANGELOG is wrapped at ~100 columns, and a GitHub release body turns every
 * newline into a line break. Code fences, headings, tables and quotes are kept.
 */
function unwrap(md) {
  const out = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      out.push(line);
      continue;
    }
    const prev = out.at(-1);
    const startsBlock = /^\s*$|^\s*([-*+]|\d+\.)\s|^#|^\s*[|>]|^---\s*$/.test(line);
    const prevOpen =
      !fence && prev !== undefined && !/^\s*$|^#|^\s*[|>]|^\s*```|^---\s*$/.test(prev) && !/( {2}|\\)$/.test(prev);
    if (!startsBlock && prevOpen) out[out.length - 1] = `${prev} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

const prerelease = version.includes("-");
let body = section(version);
if (!body && prerelease) body = section("Unreleased");
if (!body) {
  console.error(`CHANGELOG.md has no "## [${version}]" section${prerelease ? " and nothing under Unreleased" : ""}.`);
  process.exit(1);
}

const installer = `Nobetci-${version}-setup.exe`;
const dmg = `Nobetci-${version}-macos-universal.dmg`;
const footer = [
  "---",
  "",
  "**Install.** Download the file for your system below and check it against `SHA256SUMS.txt` before you open it.",
  "",
  `- **Windows 10/11:** \`${installer}\``,
  "",
  "  ```powershell",
  `  Get-FileHash .\\${installer} -Algorithm SHA256`,
  "  ```",
  "",
  `- **macOS 11 or later** (Apple silicon and Intel): \`${dmg}\``,
  "",
  "  ```sh",
  `  shasum -a 256 ${dmg}`,
  "  ```",
  "",
  "Releases aren't code-signed or notarized yet, so Windows SmartScreen and macOS Gatekeeper warn the first time. " +
    "The [installation guide](https://github.com/tahap0l/nobetci/blob/main/docs/install.md) shows how to get past them.",
].join("\n");

const notes = `${unwrap(body)}\n\n${footer}\n`;
if (out) {
  writeFileSync(out, notes);
  console.log(`Wrote the notes for ${version} to ${out}.`);
} else {
  process.stdout.write(notes);
}
