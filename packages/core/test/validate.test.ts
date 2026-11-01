// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { formatDiagnostic, loadConfig, parse, validate, validateRepository, findRemovedProvisionIds } from "../src/index.js";
import { codes, config, doc, fixture, memoryHost, parseDoc } from "./helpers.js";

const v = (body: string, fm?: Record<string, string>, extra: Partial<Parameters<typeof validate>[1]> = {}) =>
  validate(parseDoc(body, fm), { config, ...extra });

describe("validate: sample documents", () => {
  it("accepts the valid sample", () => {
    const cfg = loadConfig({ extensions: { required: "boolean", "public?": "boolean" } });
    const d = parse(fixture("sample-repo/documents/operations/sample-policy.md"), { file: "documents/operations/sample-policy.md" });
    const host = memoryHost({ "documents/operations/images/handoff.svg": { size: 500 } });
    expect(validate(d, { config: cfg, host })).toEqual([]);
  });

  it("reports the ID-scheme problems in the new invalid fixtures", () => {
    const run = (name: string) => codes(validate(parse(fixture(`invalid/${name}`), { file: name }), { config }));
    expect(run("bad-part.md")).toEqual(["section-subpart-mismatch", "provision-order", "provision-order", "subpart-part-mismatch"]);
    expect(run("bad-subpart.md")).toEqual(["section-subpart-mismatch", "provision-order"]);
    expect(run("bad-section-order.md")).toEqual(["provision-order", "duplicate-provision-id"]);
    expect(run("bad-paragraphs.md")).toEqual(Array(4).fill("provision-order"));
    expect(run("bad-tombstones.md")).toEqual(["duplicate-provision-id"]);
    expect(run("bad-legacy-ids.md")).toEqual(["invalid-provision-id", "invalid-provision-id", "missing-parent"]);
    expect(run("bad-no-parent.md")).toEqual(["missing-parent"]);
    expect(run("bad-depth.md")).toEqual(["invalid-provision-id"]);
  });

  it("reports every problem in the invalid fixtures", () => {
    const run = (name: string) => codes(validate(parse(fixture(`invalid/${name}`), { file: name }), { config }));
    expect(run("no-frontmatter.md")).toContain("missing-frontmatter");
    expect(run("bad-frontmatter.md")).toEqual(
      expect.arrayContaining(["frontmatter-schema", "invalid-date", "unknown-frontmatter-key"]),
    );
    expect(run("bad-ids.md")).toEqual(
      expect.arrayContaining(["provision-order", "invalid-provision-id", "missing-parent", "duplicate-provision-id"]),
    );
    // Cross-document refs are only judged with repo context (see validateRepository).
    expect(run("bad-refs.md")).toEqual(["unresolved-reference", "unresolved-reference", "invalid-reference"]);
    const repo = validateRepository(
      [{ file: "documents/operations/bad-refs.md", doc: parse(fixture("invalid/bad-refs.md")) }],
      { config },
    );
    expect(codes(repo).filter((c) => c === "unresolved-reference")).toHaveLength(3);
  });
});

describe("validate: frontmatter", () => {
  it("flags missing required fields at the frontmatter", () => {
    const d = parse("---\ntitle: T\n---\n\n[100.01] S\n");
    const errs = validate(d, { config }).filter((x) => x.code === "frontmatter-schema");
    expect(errs.length).toBeGreaterThanOrEqual(4);
    expect(errs.every((e) => e.position.line >= 1)).toBe(true);
  });

  it("points type errors at the offending value", () => {
    const d = validate(parseDoc("[100.01] S", { version: "1.0" }), { config });
    const e = d.find((x) => x.code === "frontmatter-schema")!;
    expect(e.position.line).toBe(5);
    expect(e.message).toContain("quote");
  });

  it("requires expiry after effective", () => {
    expect(codes(v("[100.01] S", { expiryDate: "2024-01-15" }))).toContain("expiry-before-effective");
    expect(codes(v("[100.01] S", { expiryDate: "2025-01-01" }))).not.toContain("expiry-before-effective");
  });

  it("accepts draft and version-note, rejects other notes", () => {
    expect(v("[100.01] S", { draft: "true", "version-note": "editorial" })).toEqual([]);
    expect(codes(v("[100.01] S", { "version-note": "nope" }))).toContain("frontmatter-schema");
  });

  it("supports extension fields from config", () => {
    const cfg = loadConfig({ extensions: { required: "boolean" } });
    const ok = validate(parseDoc("[100.01] S", { required: "true" }), { config: cfg });
    expect(ok).toEqual([]);
    const bad = validate(parseDoc("[100.01] S", { required: "maybe" }), { config: cfg });
    expect(codes(bad)).toContain("frontmatter-schema");
    expect(codes(v("[100.01] S", { required: "true" }))).toContain("unknown-frontmatter-key");
  });
});

describe("validate: provision IDs", () => {
  const sec = "[602.60] # S\n\n";
  const ok = (body: string) => expect(v(body)).toEqual([]);

  it("accepts sequential siblings at all levels including letters past z", () => {
    const letters = Array.from({ length: 28 }, (_, i) => `[602.60(1)(${ids28(i + 1)})] x`).join("\n\n");
    ok(`${sec}[602.60(1)] x\n\n${letters}`);
  });

  it("accepts a chain down to a Subclause and roman numerals in sequence", () => {
    ok(
      sec +
        ["[602.60(1)] a", "[602.60(1)(a)] b", "[602.60(1)(a)(i)] c", "[602.60(1)(a)(i)(A)] d", "[602.60(1)(a)(i)(A)(I)] e", "[602.60(1)(a)(i)(A)(II)] f", "[602.60(1)(a)(i)(A)(III)] g", "[602.60(1)(a)(i)(B)] h", "[602.60(1)(a)(ii)] i", "[602.60(1)(b)] j"].join("\n\n"),
    );
  });

  it("errors on gaps, wrong order and a missing parent", () => {
    const d = v(sec + "[602.60(1)] x\n\n[602.60(3)] gap\n\n[602.60(2)(a)] orphan");
    expect(d.map((x) => [x.code, x.position.line])).toEqual([
      ["provision-order", 13],
      ["missing-parent", 15],
    ]);
    expect(d[0]!.message).toContain("[602.60(2)]");
    expect(d[0]!.message).toContain("Subsection 602.60(3)");
    expect(codes(v(sec + "[602.60(2)] starts at two"))).toEqual(["provision-order"]);
    expect(codes(v(sec + "[602.60(1)] a\n\n[602.60(1)(b)] starts at b"))).toEqual(["provision-order"]);
    expect(codes(v(sec + "[602.60(1)] a\n\n[602.60(1)(a)] a\n\n[602.60(1)(c)] c"))).toEqual(["provision-order"]);
  });

  it("requires a parent for Subsections and deeper, but none for Sections", () => {
    expect(codes(v("[602.60(1)] orphan subsection"))).toEqual(["missing-parent"]);
    expect(codes(v("[602.60] S\n\n[602.60(1)(a)] skipped the subsection"))).toEqual(["missing-parent", "provision-order"].slice(0, 1));
    ok("[602.60] a section needs neither a Subpart nor a Part");
    ok("[602] # Subpart\n\n[602.60] # S");
  });

  it("requires ascending Parts, Subparts and Sections but not consecutive ones", () => {
    ok("[100.01] A\n\n[100.05] B\n\n[200.01] C\n\n[250.01] D\n\n[602.60] E\n\n[602.115] F");
    expect(codes(v("[200.01] A\n\n[100.01] B"))).toEqual(["provision-order"]);
    expect(codes(v("[602.61] A\n\n[602.60] B"))).toEqual(["provision-order"]);
    expect(codes(v("[602.60] A\n\n[602.60] B"))).toContain("duplicate-provision-id");
    expect(codes(v("[7] # P7\n\n[6] # P6"))).toEqual(["provision-order"]);
  });

  it("errors on blank, malformed and too-deep IDs", () => {
    expect(codes(v("[] blank"))).toContain("blank-provision-id");
    expect(codes(v("[602.6] short section number"))).toEqual(["invalid-provision-id"]);
    expect(codes(v("[602.60(a)] letter subsection"))).toContain("invalid-provision-id");
    const deep = v(sec + ["[602.60(1)] 1", "[602.60(1)(a)] 2", "[602.60(1)(a)(i)] 3", "[602.60(1)(a)(i)(A)] 4", "[602.60(1)(a)(i)(A)(I)] 5", "[602.60(1)(a)(i)(A)(I)(1)] 6"].join("\n\n"));
    expect(deep.map((x) => [x.code, x.severity])).toEqual([["invalid-provision-id", "error"]]);
    expect(deep[0]!.message).toContain("deeper than a Subclause");
  });

  it("checks declared Part and Subpart headings against the Sections", () => {
    ok("[6] # Part\n\n[602] # Subpart\n\n[602.60] # S\n\n[602.61] # T\n\n[603] # Next\n\n[603.01] # U");
    // Subpart in the wrong Part
    expect(codes(v("[5] # Part five\n\n[602] # Subpart"))).toEqual(["subpart-part-mismatch"]);
    // Section under the wrong declared Subpart
    const wrong = v("[602] # Subpart\n\n[603.01] # S");
    expect(wrong.map((x) => x.code)).toEqual(["section-subpart-mismatch"]);
    expect(wrong[0]!.message).toContain("declare Subpart 603");
    // Section under the wrong declared Part (no Subpart declared)
    expect(codes(v("[6] # Part\n\n[702.01] # S"))).toEqual(["section-part-mismatch"]);
    // a Subpart declared after its Sections
    expect(codes(v("[602.60] # S\n\n[602] # late"))).toEqual(["provision-order"]);
    // undeclared headings are fine, and Sections without headings are fine next to declared ones
    ok("[602.60] # S\n\n[603.01] # T");
  });

  describe("tombstones", () => {
    it("stand in for the number: no gap error, and still count as the parent", () => {
      ok(sec + "[602.60(1)] a\n\n[602.60(2)] [repealed] optional note\n\n[602.60(3)] live");
      ok(sec + "[602.60(1)] a\n\n[602.60(2)] [repealed]\n\n[602.60(3)] live");
      ok(sec + "[602.60(1)] [repealed]\n\n[602.60(2)] live");
      // a repealed parent is present for its repealed or kept children
      ok(sec + "[602.60(1)] [repealed]\n\n[602.60(1)(a)] [repealed]\n\n[602.60(1)(b)] [repealed]");
      expect(codes(v(sec + "[602.60(1)] a\n\n[602.60(4)] live gap"))).toEqual(["provision-order"]);
    });

    it("are skipped by the sequence check themselves and never hide a real gap", () => {
      expect(codes(v(sec + "[602.60(1)] a\n\n[602.60(3)] [repealed]\n\n[602.60(2)] live"))).toEqual([]);
      expect(codes(v(sec + "[602.60(1)] a\n\n[602.60(3)] live after nothing"))).toEqual(["provision-order"]);
    });

    it("count in Section order without raising an order error", () => {
      ok("[602.58] a\n\n[602.59] [repealed]\n\n[602.60] b");
      ok("[602.58] a\n\n[602.50] [repealed] out of place tombstones are not judged\n\n[602.60] b");
    });

    it("stay in the table of contents when titled", () => {
      const d = parseDoc("[602.59] # Old title [repealed] gone");
      expect(d.provisions[0]).toMatchObject({ repealed: true, title: "Old title" });
      expect(d.provisions[0]!.toIndexEntry()).toMatchObject({ repealed: true, title: "Old title", level: "Section" });
    });
  });

  it("flags removed IDs given a previous version", () => {
    const d = parseDoc("[602.60] S\n\n[602.60(1)] x");
    expect(findRemovedProvisionIds(["602.60", "602.60(1)", "602.60(2)"], d).map((x) => x.message)[0]).toContain("[602.60(2)]");
    const withTombstone = parseDoc("[602.60] S\n\n[602.60(1)] x\n\n[602.60(2)] [repealed]");
    expect(findRemovedProvisionIds(["602.60", "602.60(1)", "602.60(2)"], withTombstone)).toEqual([]);
  });
});

function ids28(n: number): string {
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

describe("validate: references", () => {
  it("resolves in-document provision and figure references", () => {
    expect(v("[100.01] S\n\n[100.01(1)] See [[100.01]] and [[fig:a]].\n\n![c](a.svg){#fig:a}")).toEqual([]);
  });

  it("errors on unresolved references", () => {
    expect(codes(v("[100.01] S\n\n[100.01(1)] See [[100.01(9)]] [[fig:q]]"))).toEqual(["unresolved-reference", "unresolved-reference"]);
  });

  it("warns when a reference targets a repealed provision", () => {
    expect(codes(v("[100.01] S\n\n[100.01(1)] [repealed]\n\n[100.01(2)] see [[100.01(1)]]"))).toEqual(["reference-to-repealed"]);
  });

  it("resolves cross-document references when other documents are supplied", () => {
    const other = parse(doc("[100.01] A\n\n[100.01(1)] x\n\n![c](a.svg){#fig:k}", { short: "other" }), { file: "documents/g/other.md" });
    const main = parseDoc("[100.01] S\n\n[100.01(1)] [[other#100.01(1)]] [[g/other#fig:k]] [[other#100.01(7)]] [[nope#100.01(1)]] [[other#fig:zz]]");
    const d = validate(main, { config, documents: [main, other] });
    expect(d.filter((x) => x.code === "unresolved-reference").map((x) => x.position.column)).toHaveLength(3);
    // Without repo context, cross-doc refs are not judged.
    expect(codes(validate(main, { config }))).not.toContain("unresolved-reference");
  });
});

describe("validate: figures", () => {
  const fig = (attrs = "{#fig:a}", path = "a.svg", caption = "Caption") =>
    `[100.01] S\n\n[100.01(1)] See [[fig:a]].\n\n![${caption}](${path})${attrs}`;
  const files = { "documents/g/a.svg": { size: 100 }, "documents/g/a.png": { size: 100, width: 800 } };

  it("passes a valid figure", () => {
    expect(v(fig(), undefined, { host: memoryHost(files) })).toEqual([]);
  });

  it("requires alt text", () => {
    expect(codes(v(fig("{#fig:a}", "a.svg", ""), undefined, { host: memoryHost(files) }))).toEqual(["missing-alt-text"]);
  });

  it("rejects duplicate keys, unsupported formats and missing files", () => {
    const body = `${fig()}\n\n![Dup](a.svg){#fig:a}\n\n![Gif](a.gif){#fig:g}\n\n![Gone](gone.svg){#fig:gone}\n\n[[fig:g]] [[fig:gone]]`;
    expect(codes(v(body, undefined, { host: memoryHost(files) }))).toEqual(
      ["duplicate-figure-key", "unsupported-image-format", "image-not-found"],
    );
  });

  it("warns on unkeyed and unreferenced figures", () => {
    const d = v("[100.01] S\n\n[100.01(1)] x\n\n![One](a.svg){#fig:a}\n\n![Two](a.svg)", undefined, { host: memoryHost(files) });
    expect(codes(d).sort()).toEqual(["figure-without-key", "unreferenced-figure"]);
    expect(d.every((x) => x.severity === "warning")).toBe(true);
  });

  it("enforces size limit and warns on low-resolution rasters", () => {
    const host = memoryHost({ "documents/g/big.svg": { size: 3 * 1024 * 1024 }, "documents/g/small.png": { size: 10, width: 100 } });
    const d = v("[100.01] S\n\n[100.01(1)] [[fig:b]] [[fig:s]]\n\n![Big](big.svg){#fig:b}\n\n![Small](small.png){#fig:s}", undefined, { host });
    expect(d.map((x) => [x.code, x.severity])).toEqual([["image-too-large", "error"], ["low-resolution-image", "warning"]]);
  });

  it("honours configured limits and allowed formats", () => {
    const cfg = loadConfig({ images: { maxBytes: 50, allowedFormats: ["svg"] } });
    const d = validate(parseDoc(fig("{#fig:a}", "a.png")), { config: cfg, host: memoryHost(files) });
    expect(codes(d)).toEqual(["unsupported-image-format"]);
    expect(codes(validate(parseDoc(fig()), { config: cfg, host: memoryHost(files) }))).toEqual(["image-too-large"]);
  });

  it("resolves image paths relative to the Markdown file", () => {
    const host = memoryHost({ "documents/g/images/x.svg": { size: 1 } });
    const d = parse(doc("[100.01] S\n\n[100.01(1)] [[fig:x]]\n\n![X](images/x.svg){#fig:x}"), { file: "documents/g/t.md" });
    expect(validate(d, { config, host })).toEqual([]);
  });
});

describe("validateRepository", () => {
  const entry = (file: string, fm: Record<string, string>) => ({ file, doc: parse(doc("[100.01] S", fm)) });

  it("checks path against group and short", () => {
    const d = validateRepository([entry("documents/other/t.md", {}), entry("documents/g/wrong.md", { short: "u" })], { config });
    expect(codes(d)).toEqual(["path-group-mismatch", "path-short-mismatch"]);
  });

  it("requires short to be unique within a group, but not across groups", () => {
    const dup = validateRepository([entry("documents/g/t.md", {}), entry("documents/g/t.md", {})], { config });
    expect(codes(dup)).toContain("duplicate-short");
    const ok = validateRepository([entry("documents/g/t.md", {}), entry("documents/h/t.md", { group: "h" })], { config });
    expect(ok).toEqual([]);
  });

  it("labels diagnostics with the file", () => {
    const d = validateRepository([entry("documents/g/zzz.md", {})], { config });
    expect(formatDiagnostic(d[0]!)).toMatch(/^documents\/g\/zzz\.md:\d+:\d+ error /);
  });
});
