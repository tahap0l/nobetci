// Fails when a tracked text file contains invisible or direction-changing
// characters: zero-width spaces, bidi controls, BOMs in the middle of a file,
// invisible fillers and operators, tag characters, stray control characters.
// Nobi flags these in commands as an obfuscation trick; its own source must be
// free of them. Run: `npm run check:invisible` (CI runs it too).
//
// Every file git treats as text is scanned, whatever its name (installer
// scripts, PowerShell, XML and plist files included); git decides what is text,
// as it does for diffs. The character ranges are written as code points on
// purpose, so this file does not contain the characters it looks for.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ranges = [
  [0x0000, 0x0008], // C0 controls (tab, line feed and carriage return are fine)
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f], // delete and the C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark (a bidi control)
  [0x115f, 0x1160], // Hangul fillers: valid, invisible JS identifiers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180b, 0x180f], // Mongolian variation selectors and vowel separator
  [0x200b, 0x200f], // zero-width space … right-to-left mark
  [0x2028, 0x2029], // line and paragraph separators
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner and the invisible operators
  [0x2066, 0x206f], // bidi isolates and the deprecated format characters
  [0x3164, 0x3164], // Hangul filler
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation
  [0xe0000, 0xe007f], // tag characters, which can hide text inside text
];
const hex = (n) => n.toString(16);
const pattern = new RegExp(`[${ranges.map(([a, b]) => `\\u{${hex(a)}}-\\u{${hex(b)}}`).join("")}]`, "gu");

/**
 * Tracked files git keeps as text. `--eol` prints "i/<eol> w/<eol> attr/<…>\t<path>";
 * the index side reads "-text" for a binary file.
 */
function textFiles() {
  return execFileSync("git", ["ls-files", "--eol", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      return { info: entry.slice(0, tab), file: entry.slice(tab + 1) };
    })
    .filter(({ info }) => !/^i\/-text\b/.test(info))
    .map(({ file }) => file);
}

const files = textFiles();
let problems = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // A BOM as the very first character of a file is tolerated.
    const scan = i === 0 && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
    for (const m of scan.matchAll(pattern)) {
      problems++;
      const code = m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      console.error(`${file}:${i + 1}:${(m.index ?? 0) + 1}  U+${code}`);
    }
  });
}

if (problems) {
  console.error(`\n${problems} invisible/bidi character(s) found. Write them as escapes instead.`);
  process.exit(1);
}
console.log(`OK — ${files.length} files, no invisible or bidi characters.`);
