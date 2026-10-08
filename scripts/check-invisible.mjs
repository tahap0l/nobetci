// Fails when a tracked text file contains invisible or direction-changing
// characters (zero-width spaces, bidi overrides, BOMs in the middle of a file).
// Nöbetçi flags these in commands as an obfuscation trick; its own source must be
// free of them. Run: `npm run check:invisible` (CI runs it too).
//
// The character ranges are built from code points on purpose, so this file does
// not contain the characters it looks for.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ranges = [
  [0x200b, 0x200f], // zero-width space … right-to-left mark
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];
const cls = ranges.map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("");
const pattern = new RegExp("[" + cls + "]", "g");

const TEXT = /\.(rs|ts|mjs|js|json|html|css|md|toml|yml|yaml|nsh|txt)$/i;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && TEXT.test(f));

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
