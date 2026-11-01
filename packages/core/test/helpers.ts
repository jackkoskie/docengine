// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, parse, type Diagnostic, type Host } from "../src/index.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const FIXTURES = join(ROOT, "fixtures");

export const config = loadConfig({});

export function fixture(rel: string): string {
  return readFileSync(join(FIXTURES, rel), "utf8");
}

/** Wraps body text in valid frontmatter. */
export function doc(body: string, fm: Record<string, string> = {}): string {
  const base = { title: "T", short: "t", group: "g", version: '"1.0"', effectiveDate: "2024-01-15", ...fm };
  return `---\n${Object.entries(base).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}\n`;
}

export function parseDoc(body: string, fm?: Record<string, string>) {
  return parse(doc(body, fm), { file: "documents/g/t.md" });
}

export function codes(diags: Diagnostic[]): string[] {
  return diags.map((d) => d.code);
}

/** In-memory host. */
export function memoryHost(files: Record<string, { size: number; width?: number }>): Host {
  return {
    inspectFile: (p) => {
      const f = files[p];
      return f ? { size: f.size, sha256: "0".repeat(64), ...(f.width !== undefined ? { width: f.width } : {}) } : undefined;
    },
  };
}
