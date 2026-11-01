// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";

/**
 * Golden render tests. Each fixture is built to Typst (`build --no-compile`) and the generated `.typ`
 * is compared with `fixtures/golden/<name>.typ`. Run with `UPDATE_GOLDEN=1` to rewrite the golden files.
 *
 * When a Typst binary is found (DOCENGINE_TYPST, PATH, or %TEMP%/typst-dl) the fixture is also compiled
 * to PDF and, if `pdftotext` exists, key strings are asserted on the extracted text. Those checks are
 * skipped when either tool is missing.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GOLDEN = join(ROOT, "fixtures", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function works(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return !r.error && r.status === 0;
}

function findFile(dir: string, name: string, depth = 4): string | null {
  if (!existsSync(dir) || depth < 0) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === name) return join(dir, entry.name);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const hit = findFile(join(dir, entry.name), name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function findTypst(): string | null {
  const candidates = [process.env.DOCENGINE_TYPST, "typst", findFile(join(tmpdir(), "typst-dl"), process.platform === "win32" ? "typst.exe" : "typst")];
  for (const c of candidates) if (c && works(c, ["--version"])) return c;
  return null;
}

function findPdfToText(): string | null {
  // poppler prints its version and may exit non-zero, so only a spawn error means "missing".
  return spawnSync("pdftotext", ["-v"]).error ? null : "pdftotext";
}

const TYPST = findTypst();
const PDFTOTEXT = findPdfToText();

/** Copies a fixture (without its generated dist/) into a fresh temp project. */
function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `docengine-golden-${name}-`));
  cpSync(join(ROOT, "fixtures", name), dir, { recursive: true, filter: (src) => !/[\\/](dist|node_modules)([\\/]|$)/.test(src.slice(join(ROOT, "fixtures", name).length)) });
  return dir;
}

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function pdfText(pdf: string): string {
  const r = spawnSync(PDFTOTEXT!, ["-layout", pdf, "-"], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return r.stdout.replace(/\s+/g, " ");
}

function matchGolden(name: string, actual: string): void {
  const file = join(GOLDEN, `${name}.typ`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, actual);
    if (!UPDATE) throw new Error(`Golden file ${file} did not exist and was created. Review it, then re-run.`);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

interface Fixture {
  name: string;
  typ: string;
  strings: (string | RegExp)[];
}

const FIXTURES: Fixture[] = [
  {
    name: "example-policy",
    typ: "operations/departure-release-v1.0.typ",
    strings: [
      "Departure Release (DR) Authority",
      "Section 200.01 — ZXAA Airport",
      "Section 200.02 — All other ZXEX Airports",
      "(1) Departure release (DR) is automatically granted",
      "DR requests are processed as described in [200.01(3)].",
      "Repealed. Repealed, effective 2025-01-01",
      "(Figure 1)",
      "Figure 1: Example FIR logo",
    ],
  },
  {
    name: "legal-outline",
    typ: "general/legal-outline-v1.0.typ",
    strings: ["Legal Outline", "Article 1 — Principles", "Section 1.1 — Scope", "(a) This paragraph states the scope", "(i) A term used below"],
  },
  {
    name: "sample-repo",
    typ: "operations/sample-policy-v1.0.typ",
    strings: ["Section 300.01 — Scope", "(ii) Otherwise coordinate by landline.", "profile in Figure 1", "Figure 1: Handoff profile at the sector boundary", "(4) Repealed. Withdrawn 2023-12-01."],
  },
  {
    // cover, table of contents, titles at depth, footnotes (also in a table cell), table spans, underline/highlight,
    // keep-with-next, page breaks, a second document for cross-document references
    name: "example-handbook",
    typ: "general/example-handbook-v2.0.typ",
    strings: [
      "Example Handbook",
      "Fictional policy handbook for the Exampleland FIR",
      "Effective 2025-03-01 0300Z",
      "For Example Use Only",
      "Table of Contents",
      "Part 6 Exampleland FIR Policy",
      "Subpart 601 Training and Qualification",
      "Part 6 — Exampleland FIR Policy",
      "Subpart 601 — Training and Qualification",
      "Section 601.01 — Training",
      "(2) Stages and expectations. The training path has four stages",
      "Durations are guidance only.",
      "The terminal stage includes at least two supervised sessions",
      "Figure 1: Release and handoff flow",
      "Figure 2: Organization of the Exampleland FIR",
      "(b) Repealed. Withdrawn on 2025-03-01",
      "Section 602.05 — Software Use",
    ],
  },
];

describe.each(FIXTURES)("golden: $name", (fx) => {
  it("generates the checked-in Typst", async () => {
    const dir = copyFixture(fx.name);
    const r = await run(["build", "--cwd", dir, "--no-compile"]);
    expect(r.err).not.toMatch(/error/);
    expect(r.code).toBe(0);
    const typ = readFileSync(join(dir, "dist", fx.typ), "utf8").replace(/\r\n/g, "\n");
    expect(typ).not.toContain(dir.replace(/\\/g, "/"));
    matchGolden(fx.name, typ);
  });

  it.skipIf(!TYPST || !PDFTOTEXT)("compiles to a PDF with the expected text", async () => {
    const dir = copyFixture(fx.name);
    const r = await run(["build", "--cwd", dir, "--typst", TYPST!]);
    expect(r.code).toBe(0);
    const pdf = join(dir, "dist", fx.typ.replace(/\.typ$/, ".pdf"));
    expect(existsSync(pdf)).toBe(true);
    const text = pdfText(pdf);
    for (const s of fx.strings) {
      if (typeof s === "string") expect(text, `PDF text should contain "${s}"`).toContain(s);
      else expect(text).toMatch(s);
    }
  });
});
