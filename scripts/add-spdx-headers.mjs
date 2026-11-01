// SPDX-License-Identifier: MPL-2.0
// Adds an SPDX-License-Identifier header to the top of source files. Idempotent: files that already
// carry one (in their first lines) are left alone, and nothing but the top of a file is touched.
//   node scripts/add-spdx-headers.mjs          add missing headers
//   node scripts/add-spdx-headers.mjs --check  list files missing a header, exit 1 if any
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");

const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git", "coverage"]);
// Generated copy of templates/ inside the npm package; the original is the source of truth.
const SKIP_PREFIXES = ["packages/cli/templates/"];
const MIT_PREFIXES = ["templates/", "template-repo/"];
const SLASH_EXT = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".typ"]);
const HASH_EXT = new Set([".sh"]);

function inScope(rel) {
  if (MIT_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (/^packages\/[^/]+\/(src|test|scripts)\//.test(rel)) return true;
  if (/^(scripts|action\/scripts|action\/test)\//.test(rel)) return true;
  return false;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

let changed = 0;
const missing = [];
for (const file of walk(root)) {
  const rel = relative(root, file).split(sep).join("/");
  const ext = extname(rel);
  const comment = SLASH_EXT.has(ext) ? "//" : HASH_EXT.has(ext) ? "#" : null;
  if (!comment || !inScope(rel) || SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;

  let text = readFileSync(file, "utf8");
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (bom) text = text.slice(1);
  const head = text.split(/\r?\n/, 6).join("\n");
  if (head.includes("SPDX-License-Identifier:")) continue;

  if (check) {
    missing.push(rel);
    continue;
  }
  const license = MIT_PREFIXES.some((p) => rel.startsWith(p)) ? "MIT" : "MPL-2.0";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const line = `${comment} SPDX-License-Identifier: ${license}${eol}`;
  let out;
  if (text.startsWith("#!")) {
    // Keep the shebang as the first line.
    const nl = text.indexOf("\n");
    out = nl === -1 ? text + eol + line : text.slice(0, nl + 1) + line + text.slice(nl + 1);
  } else {
    out = line + text;
  }
  writeFileSync(file, bom + out);
  changed++;
  console.log(`added ${license}: ${rel}`);
}

if (check) {
  if (missing.length) {
    console.error("Missing SPDX header:\n" + missing.map((m) => "  " + m).join("\n"));
    process.exit(1);
  }
} else {
  console.log(`${changed} file(s) updated.`);
}
