// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  buildManifest,
  buildManifestEntry,
  buildUploadSheet,
  escapeTypst,
  generateTypst,
  imageDimensions,
  loadConfig,
  parse,
  schema,
  toJsonSchema,
} from "../src/index.js";
import { ROOT, config, doc, fixture, parseDoc } from "./helpers.js";

const gen = (body: string, cfg = config) =>
  generateTypst(parseDoc(body), cfg, { templateImport: "/t.typ", resolveAsset: (p) => "/" + p });

describe("generateTypst", () => {
  it("emits a provision call and a dashed, case-preserving label per provision", () => {
    const t = gen("[6] # Part\n\n[602] # Sub\n\n[602.60] # Scope\n\n[602.60(1)(c)] text\n\n[602.60(1)(c)(i)(A)(I)] deep\n\n[602.60(1)(c)(i)(A)(i)] odd");
    expect(t).toContain('#provision("6", 1, level-label: "Part", title: [Part], page-break: true)[');
    expect(t).toContain("] <p6>");
    expect(t).toContain('#provision("602", 2, level-label: "Subpart", title: [Sub], page-break: true)[');
    expect(t).toContain('#provision("602.60", 3, level-label: "Section", title: [Scope])[');
    expect(t).toContain("] <p602-60>");
    expect(t).toContain('#provision("602.60(1)(c)", 5, level-label: "Paragraph", label: "(c)", italic-label: true, indent: 1)[');
    expect(t).toContain("] <p602-60-1-c>");
    expect(t).toContain('#provision("602.60(1)(c)(i)(A)(I)", 8, level-label: "Subclause", label: "(I)", indent: 4)[');
    expect(t).toContain("] <p602-60-1-c-i-A-I>");
  });

  it("starts the outline at level 1 whatever the shallowest declared heading is", () => {
    const sections = gen("[602.60] # A\n\n[602.61] # B");
    expect(sections).toContain("level-offset: 2");
    expect(sections).toContain("toc-depth: 1");
    const withSubpart = gen("[602] # Sub\n\n[602.60] # A");
    expect(withSubpart).toContain("level-offset: 1");
    expect(withSubpart).toContain("toc-depth: 2");
    expect(gen("[6] # P\n\n[602.60] # A")).not.toContain("level-offset");
  });

  it("uses the fixed level names", () => {
    expect(gen("[602.60] # S\n\n[602.60(1)] x\n\n[602.60(1)(a)] y\n\n[602.60(1)(a)(i)] z\n\n[602.60(1)(a)(i)(A)] c")).toMatch(
      /"Section".*"Subsection".*"Paragraph".*"Subparagraph".*"Clause"/s,
    );
    expect(() => loadConfig({ levels: ["a", "b", "c", "d"] })).not.toThrow(); // unknown keys are ignored: names are fixed
  });

  it("writes a tombstone with its note and keeps a titled one in the headings", () => {
    const t = gen("[602.60] # Old title [repealed] Gone\n\n[602.61] # S\n\n[602.61(1)] [repealed] Replaced by [[602.61(2)]]\n\n[602.61(2)] new");
    expect(t).toContain('#provision("602.60", 3, level-label: "Section", repealed: true, title: [Old title]');
    expect(t).toContain("  Gone");
    expect(t).toContain('#provision("602.61(1)", 4, level-label: "Subsection", label: "(1)", repealed: true)[');
    expect(t).toContain("Replaced by");
  });

  it("passes branding and metadata to the template", () => {
    const cfg = loadConfig({ branding: { firName: "Test FIR", logo: "assets/logo.svg", footer: "Foot", colors: { primary: "#112233" } } });
    const t = gen("[100.01] S", cfg);
    expect(t).toContain('#import "/t.typ": letterhead, provision');
    expect(t).toContain('fir-name: "Test FIR"');
    expect(t).toContain('logo: image("/assets/logo.svg", height: 1.3cm)');
    expect(t).toContain('primary: rgb("#112233")');
    expect(t).toContain('footer-text: "Foot"');
    expect(t).toContain('version: "1.0"');
    expect(t).toContain("draft: false");
  });

  it("converts references to links", () => {
    const t = gen("[100.01] S\n\n[100.01(1)] a\n\n[100.01(2)] see [[100.01(1)]]; and [[fig:f]].\n\n![Cap](a.svg){#fig:f}");
    expect(t).toContain("#link(<p100-01-1>)[\\[100.01(1)\\]]\\;");
    expect(t).toContain("#ref(<fig-f>)");
  });

  it("renders cross-document references as text", () => {
    expect(gen("[100.01] S\n\n[100.01(1)] [[other#100.01(2)]]")).toContain("other \\[100.01(2)\\]");
  });

  it("converts inline markdown and escapes Typst specials", () => {
    const t = gen("[100.01] S\n\n[100.01(1)] **bold** _em_ `code` [link](https://x.test) #hash $5 a_b @x ZXEX/ZXEY");
    expect(t).toContain("#strong[bold]");
    expect(t).toContain("#emph[em]");
    expect(t).toContain('#raw("code")');
    expect(t).toContain('#link("https://x.test")[link]');
    expect(t).toContain("\\#hash \\$5 a\\_b \\@x ZXEX/ZXEY");
  });

  it("honors Markdown backslash escapes", () => {
    const t = gen("[100.01] S\n\n[100.01(1)] snake\\_case \\*not emph\\* a\\b \\` end");
    expect(t).toContain("snake\\_case \\*not emph\\* a\\\\b \\` end");
    expect(t).not.toContain("#emph");
  });

  it("protects paragraphs that would start a list or heading", () => {
    expect(gen("[100.01] S\n\n[100.01(1)] = not a heading")).toContain("\\= not a heading");    expect(escapeTypst("//x")).toBe("\\//x");
  });

  it("generates figures with alt text, width, label and numbering", () => {
    const t = gen("[100.01] S\n\n[100.01(1)] x\n\n![RVSM profile](images/p.svg){#fig:p width=80% placement=float}");
    expect(t).toContain('#figure(image("/documents/g/images/p.svg", alt: "RVSM profile", width: 80%), caption: [RVSM profile], placement: auto) <fig-p>');
    expect(t).toContain("#set figure(supplement: [Figure])");
  });

  it("nests the figure inside the provision it follows", () => {
    const t = gen("[100.01] S\n\n[100.01(1)] x\n\n![C](a.svg){#fig:a}\n\n[100.01(2)] y");
    expect(t.indexOf("#figure(")).toBeLessThan(t.indexOf("] <p100-01-1>"));
    expect(t.indexOf("#figure(")).toBeGreaterThan(t.indexOf('#provision("100.01(1)"'));
  });

  it("renders lists, tables and tombstones", () => {
    const t = gen("[100.01] S\n\n[100.01(1)] - a\n- b\n\n| H1 | H2 |\n| --- | :-: |\n| x | y |\n\n[100.01(2)] [repealed] gone");
    expect(t).toContain("#list([a], [b])");
    expect(t).toContain("table.header([H1], [H2])");
    expect(t).toContain("align: (left, center)");
    expect(t).toContain("repealed: true");
  });

  it("marks drafts", () => {
    expect(generateTypst(parseDoc("[100.01] S", { draft: "true" }), config, { templateImport: "/t.typ" })).toContain("draft: true");
  });

  it("generates the sample fixture", () => {
    const d = parse(fixture("sample-repo/documents/operations/sample-policy.md"), { file: "documents/operations/sample-policy.md" });
    const t = generateTypst(d, config, { templateImport: "/t.typ" });
    expect(t).toContain("<fig-handoff>");
    expect(t).toContain("<p300-01-2-b-ii>");
  });
});

describe("default template", () => {
  it("defines letterhead and provision with the variables the generator passes", () => {
    const tpl = readFileSync(join(ROOT, "templates", "default-letterhead.typ"), "utf8");
    expect(tpl).toContain("#let provision(");
    const generated = gen("[100.01] S");
    const passed = [...generated.matchAll(/^\s{2}([a-z-]+):/gm)].map((m) => m[1]!);
    for (const arg of passed) expect(tpl, arg).toContain(`${arg}:`);
  });
});

describe("manifest", () => {
  const d = parse(fixture("sample-repo/documents/operations/sample-policy.md"), { file: "documents/operations/sample-policy.md" });
  const cfg = loadConfig({});

  it("builds entries with provision and figure indexes and hashes", () => {
    const e = buildManifestEntry(d, cfg, {
      gitCommit: "abc",
      pdf: { filename: "sample-policy-v1.0.pdf", path: "dist/operations/sample-policy-v1.0.pdf", sha256: "f".repeat(64) },
      fileHashes: { "documents/operations/images/handoff.svg": "a".repeat(64) },
    });
    expect(e).toMatchObject({ group: "operations", short: "sample-policy", version: "1.0", effectiveDate: "2024-01-15", expiryDate: null, gitCommit: "abc", draft: false });
    expect(e.extensions).toEqual({ required: true, public: true });
    expect(e.provisions.find((c) => c.id === "300.01")).toMatchObject({ level: "Section", title: "Scope", depth: 3 });
    expect(e.provisions.find((c) => c.id === "300.01(4)")!.repealed).toBe(true);
    expect(e.figures).toEqual([
      { key: "handoff", number: 1, caption: "Handoff profile at the sector boundary", path: "images/handoff.svg", source: "documents/operations/images/handoff.svg", sha256: "a".repeat(64) },
    ]);
  });

  it("builds a manifest and upload sheet; drafts are excluded", () => {
    const a = buildManifestEntry(d, cfg, { pdf: { filename: "a.pdf", path: "dist/a.pdf", sha256: "1".repeat(64) } });
    const draft = buildManifestEntry(parse(doc("[100.01] S", { draft: "true" })), cfg);
    const m = buildManifest([draft, a], { gitCommit: "abc", engineVersion: "9.9.9" });
    expect(m.generator.version).toBe("9.9.9");
    expect(m.documents).toHaveLength(2);
    const sheet = buildUploadSheet(m);
    expect(sheet).toContain("| operations | sample-policy | 1.0 | 2024-01-15 | none | a.pdf | `" + "1".repeat(64) + "` |");
    expect(sheet).not.toContain("| g | t |");
    expect(sheet).toContain("required = true");
  });

  it("supports the changed-only hook", () => {
    const a = buildManifestEntry(d, cfg);
    const m = buildManifest([a], { isChanged: () => false });
    expect(m.documents[0]!.changed).toBe(false);
    expect(buildUploadSheet(m, { changedOnly: true })).toContain("No documents to upload");
    expect(buildUploadSheet(buildManifest([a]), { changedOnly: true })).toContain("sample-policy");
  });
});

describe("config and schema", () => {
  it("applies defaults", () => {
    const c = loadConfig();
    expect(c).toMatchObject({ documents: "documents/**/*.md", outDir: "dist" });
    expect(c.images.maxBytes).toBe(2 * 1024 * 1024);
    expect(c.toc.depth).toBe(3);
    expect(c.headings).toEqual({ format: "{level} {id} \u2014 {title}", maxDepth: 3, pageBreakBefore: 2 });
    expect("levels" in c).toBe(false);
  });

  it("rejects invalid config with all issues listed", () => {
    expect(() => loadConfig({ toc: { depth: 0 }, branding: { colors: { primary: "red" } } })).toThrow(ConfigError);
    try {
      loadConfig({ toc: { depth: 0 }, branding: { colors: { primary: "red" } } });
    } catch (e) {
      expect((e as ConfigError).issues).toHaveLength(2);
    }
  });

  it("generates JSON Schema including extensions", () => {
    const json = toJsonSchema({ required: "boolean" }) as any;
    expect(Object.keys(json.properties)).toEqual(expect.arrayContaining(["title", "short", "group", "version", "effectiveDate", "expiryDate", "description", "draft", "version-note", "required"]));
    expect(json.required).toEqual(expect.arrayContaining(["title", "short", "group", "version", "effectiveDate", "required"]));
    expect(json.required).not.toContain("expiryDate");
    expect(json.additionalProperties).toBe(false);
    expect(schema.toJsonSchema).toBe(toJsonSchema);
  });

  it("matches the committed schema/frontmatter.schema.json", () => {
    const committed = JSON.parse(readFileSync(join(ROOT, "schema", "frontmatter.schema.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(toJsonSchema())));
  });
});

describe("imageDimensions", () => {
  it("reads PNG headers", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(png.buffer).setUint32(16, 520);
    new DataView(png.buffer).setUint32(20, 324);
    expect(imageDimensions(png)).toEqual({ width: 520, height: 324 });
  });

  it("reads JPEG start-of-frame", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x44, 0x02, 0x08, 3, 0, 0, 0]);
    expect(imageDimensions(jpg)).toEqual({ width: 520, height: 324 });
  });

  it("returns undefined for unknown data", () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});
