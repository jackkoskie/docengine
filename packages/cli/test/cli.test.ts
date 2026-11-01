// SPDX-License-Identifier: MPL-2.0
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SAMPLE = join(ROOT, "fixtures", "sample-repo");

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("docengine CLI", () => {
  it("validate succeeds on the sample repo", async () => {
    const r = await run(["validate", "--cwd", SAMPLE]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 document(s), 0 error(s)");
  });

  it("validate prints file:line:col severity message and exits non-zero on errors", async () => {
    const r = await run(["validate", "--cwd", join(ROOT, "fixtures", "invalid"), "bad-ids.md", "bad-refs.md"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^bad-ids\.md:13:1 error Subsection 602\.60\(3\) is out of sequence/m);
    expect(r.err).toMatch(/^bad-refs\.md:11:\d+ error Reference/m);
  });

  it("build --no-compile writes .typ, manifest and upload sheet", async () => {
    const out = mkdtempSync(join(tmpdir(), "docengine-"));
    const r = await run(["build", "--cwd", SAMPLE, "--out", out, "--no-compile"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(out, "operations", "sample-policy-v1.0.typ"))).toBe(true);
    expect(existsSync(join(out, "_template", "letterhead.typ"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(manifest.documents[0]).toMatchObject({ short: "sample-policy", pdf: null });
    expect(manifest.documents[0].figures[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(out, "upload-sheet.md"), "utf8")).toContain("sample-policy");
  });

  it("build <file> writes to <outDir>/preview and keeps the full-repo manifest.json", async () => {
    const repo = mkdtempSync(join(tmpdir(), "docengine-repo-"));
    cpSync(SAMPLE, repo, { recursive: true });
    expect((await run(["build", "--cwd", repo, "--no-compile"])).code).toBe(0);
    const full = readFileSync(join(repo, "dist", "manifest.json"), "utf8");
    const r = await run(["build", "--cwd", repo, "documents/operations/sample-policy.md", "--no-compile"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(repo, "dist", "preview", "operations", "sample-policy-v1.0.typ"))).toBe(true);
    expect(existsSync(join(repo, "dist", "preview", "manifest.json"))).toBe(true);
    expect(readFileSync(join(repo, "dist", "manifest.json"), "utf8")).toBe(full);
    const explicit = mkdtempSync(join(tmpdir(), "docengine-out-"));
    await run(["build", "--cwd", repo, "documents/operations/sample-policy.md", "--out", explicit, "--no-compile"]);
    expect(existsSync(join(explicit, "manifest.json"))).toBe(true);
  });

  it("build refuses to run when validation fails", async () => {
    const out = mkdtempSync(join(tmpdir(), "docengine-"));
    const r = await run(["build", "--cwd", join(ROOT, "fixtures", "invalid"), "bad-ids.md", "--out", out, "--no-compile"]);
    expect(r.code).toBe(1);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
  });

  it("build without typst skips compilation with a clear message", async () => {
    const out = mkdtempSync(join(tmpdir(), "docengine-"));
    const r = await run(["build", "--cwd", SAMPLE, "--out", out, "--typst", "definitely-not-typst-xyz"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("typst CLI not found");
  });

  it("schema prints JSON Schema including config extensions", async () => {
    const r = await run(["schema", "--cwd", SAMPLE]);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    expect(json.properties.required).toBeDefined();
  });

  it("rejects unknown commands", async () => {
    expect((await run(["nope"])).code).toBe(2);
  });
});
