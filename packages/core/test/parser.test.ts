// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import { doc, fixture, parseDoc } from "./helpers.js";

describe("parse: frontmatter", () => {
  it("reads values with key and value positions", () => {
    const d = parse(doc("[100.01] A"));
    expect(d.frontmatter.title).toBe("T");
    expect(d.frontmatter.effectiveDate).toBe("2024-01-15"); // stays a string
    expect(d.frontmatterPositions.title!.key).toEqual({ line: 2, column: 1, length: 5 });
    expect(d.frontmatterPositions.title!.value.line).toBe(2);
    expect(d.frontmatterPositions.title!.value.column).toBe(8);
    expect(d.bodyStartLine).toBe(8);
  });

  it("reports missing and unterminated frontmatter without throwing", () => {
    expect(parse("[100.01] A").diagnostics.map((d) => d.code)).toContain("missing-frontmatter");
    const u = parse("---\ntitle: x\n[100.01] A\n");
    expect(u.diagnostics.map((d) => d.code)).toContain("unterminated-frontmatter");
  });

  it("reports YAML errors with a position and still parses the body", () => {
    const d = parse("---\ntitle: [unclosed\n---\n\n[100.01] A\n");
    const e = d.diagnostics.find((x) => x.code === "frontmatter-yaml")!;
    expect(e.position.line).toBeGreaterThanOrEqual(2);
    expect(d.provisions).toHaveLength(1);
  });

  it("handles CRLF line endings and a BOM", () => {
    const d = parse("\uFEFF" + doc("[100.01] A\n\n[100.01(1)] B").replaceAll("\n", "\r\n"));
    expect(d.diagnostics).toEqual([]);
    expect(d.provisions.map((c) => c.id.text)).toEqual(["100.01", "100.01(1)"]);
  });
});

describe("parse: provisions", () => {
  it("builds provisions with positions, depth and parents", () => {
    const d = parseDoc("[100.01] Scope\n\n[100.01(1)] One\n\n[100.01(1)(a)] Two");
    expect(d.provisions.map((c) => [c.id.text, c.depth, c.parentId?.text ?? null])).toEqual([
      ["100.01", 3, "100"], ["100.01(1)", 4, "100.01"], ["100.01(1)(a)", 5, "100.01(1)"],
    ]);
    const c = d.provisions[1]!;
    expect(c.position).toEqual({ line: 11, column: 1, length: 11 });
    expect(c.blocks[0]).toMatchObject({ type: "paragraph", text: "One" });
  });

  it("takes a title only from the `# ` marker; text after the ID is the body at every level", () => {
    const d = parseDoc("[100.01] # ZXAA Airport\n\n[100.01(1)] x\n\n[100.02] body only");
    expect(d.provisions[0]!.title).toBe("ZXAA Airport");
    expect(d.provisions[0]!.blocks).toHaveLength(0);
    expect(d.provisions[2]!.title).toBeUndefined();
    expect(d.provisions[2]!.blocks).toMatchObject([{ type: "paragraph", text: "body only" }]);
  });

  it("parses optional Part and Subpart headings as provisions of their own", () => {
    const d = parseDoc("[6] # Part title\n\n[602] # Subpart title\n\n[602.60] # Section\n\n[602.60(1)(a)] x");
    expect(d.provisions.map((c) => [c.id.text, c.depth, c.level.label, c.title ?? null])).toEqual([
      ["6", 1, "Part", "Part title"],
      ["602", 2, "Subpart", "Subpart title"],
      ["602.60", 3, "Section", "Section"],
      ["602.60(1)(a)", 5, "Paragraph", null],
    ]);
    expect(d.provisions[0]!.isDivision).toBe(true);
    expect(d.provisions[2]!.isDivision).toBe(false);
  });

  it("parses a bare-ID tombstone and a titled tombstone", () => {
    const d = parseDoc("[200.03] # Old title [repealed] Replaced by [[200.04]]\n\n[200.03(2)] [repealed] optional note\n\n[200.03(3)] [REPEALED]");
    expect(d.provisions[0]).toMatchObject({ repealed: true, title: "Old title", repealNote: "Replaced by [[200.04]]", blocks: [] });
    expect(d.provisions[1]).toMatchObject({ repealed: true, repealNote: "optional note", blocks: [] });
    expect(d.provisions[1]!.title).toBeUndefined();
    expect(d.provisions[2]).toMatchObject({ repealed: true, blocks: [] });
    expect(d.provisions[2]!.repealNote).toBeUndefined();
  });

  it("parses every level of a chain down to a Subclause", () => {
    const d = parseDoc("[602.60] a\n\n[602.60(1)] b\n\n[602.60(1)(c)] c\n\n[602.60(1)(c)(i)] d\n\n[602.60(1)(c)(i)(A)] e\n\n[602.60(1)(c)(i)(A)(I)] f");
    expect(d.provisions.map((c) => c.id.depth)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(d.diagnostics).toEqual([]);
  });

  it("joins continuation lines and keeps multiple paragraphs", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] line one\nline two\n\nsecond paragraph");
    expect(d.provisions[1]!.blocks).toMatchObject([
      { type: "paragraph", text: "line one line two" },
      { type: "paragraph", text: "second paragraph" },
    ]);
    expect(d.provisions[1]!.endLine).toBe(14);
  });

  it("marks tombstones", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] [repealed] Withdrawn 2024-01-01");
    expect(d.provisions[1]).toMatchObject({ repealed: true, repealNote: "Withdrawn 2024-01-01", blocks: [] });
  });

  it("keeps blank and malformed IDs in the tree instead of failing", () => {
    const d = parseDoc("[] blank\n\n[hello] odd\n\n[100.01] ok");
    expect(d.provisions.map((c) => c.id.text)).toEqual(["", "hello", "100.01"]);
  });

  it("does not treat markdown links, refs or fenced code as provisions", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] x\n\n```\n[100.01(2)] not a provision\n```\n\n[link](http://x.test) text\n\n[[100.01(1)]] starts a line");
    expect(d.provisions.map((c) => c.id.text)).toEqual(["100.01", "100.01(1)"]);
  });

  it("warns about text before the first provision", () => {
    const d = parseDoc("stray\n\n[100.01] S");
    expect(d.diagnostics.map((x) => x.code)).toContain("content-outside-provision");
  });

  it("parses lists and tables", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] Intro:\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    const blocks = d.findProvision("100.01(1)")!.blocks;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list", "table"]);
  });
});

describe("parse: references", () => {
  it("finds provision, cross-document and figure references with positions", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] See [[100.01(2)(a)]], [[other#100.01(2)]], [[fig:x]], [[other#fig:y]].");
    expect(d.references.map((r) => [r.kind, r.doc ?? null, r.target])).toEqual([
      ["provision", null, "100.01(2)(a)"], ["provision", "other", "100.01(2)"], ["figure", null, "x"], ["figure", "other", "y"],
    ]);
    const r = d.references[0]!;
    expect(r.position).toEqual({ line: 11, column: 17, length: 16 });
    expect(r.provisionId?.text).toBe("100.01(1)");
  });

  it("records the target offset and length inside the brackets", () => {
    const text = "[100.01] S\n\n[100.01(1)] See [[ 100.01(2)(a) ]], [[other#100.01(2)]], [[fig:x]], [[other#fig:yy]], [[100.01(1)(a)]].";
    const d = parseDoc(text);
    const line = text.split("\n")[2]!;
    for (const r of d.references) {
      expect(r.raw.slice(r.targetOffset, r.targetOffset + r.targetLength)).toBe(r.target);
      expect(line.slice(r.position.column - 1 + r.targetOffset, r.position.column - 1 + r.targetOffset + r.targetLength)).toBe(r.target);
    }
    expect(d.references.map((r) => r.target)).toEqual(["100.01(2)(a)", "100.01(2)", "x", "yy", "100.01(1)(a)"]);
  });

  it("ignores references inside code spans and fences", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] `[[100.01(9)]]`\n\n```\n[[100.01(8)]]\n```");
    expect(d.references).toHaveLength(0);
  });
});

describe("parse: figures", () => {
  const body = "[100.01] S\n\n[100.01(1)] See [[fig:a]].\n\n![First caption](images/a.svg){#fig:a width=80% align=center placement=float}\n\n![Second](b.png)";

  it("parses attributes, derives numbers and owner provisions", () => {
    const d = parseDoc(body);
    expect(d.figures).toHaveLength(2);
    expect(d.figures[0]).toMatchObject({
      key: "a", caption: "First caption", path: "images/a.svg", width: "80%", align: "center", placement: "float",
      number: 1,
    });
    expect(d.figures[0]!.provisionId?.text).toBe("100.01(1)");
    expect(d.figures[1]).toMatchObject({ number: 2, caption: "Second" });
    expect(d.figures[1]!.key).toBeUndefined();
  });

  it("records positions for the figure, key and path", () => {
    const f = parseDoc(body).figures[0]!;
    expect(f.position.line).toBe(13);
    expect(f.keyPosition).toMatchObject({ line: 13, length: 6 });
    expect(f.pathPosition).toEqual({ line: 13, column: 18, length: 12 });
  });

  it("flags invalid keys and bad attributes without dropping the figure", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] x\n\n![c](a.svg){#fig:Bad_Key width=wide bogus=1}");
    expect(d.figures).toHaveLength(1);
    expect(d.diagnostics.map((x) => x.code).sort()).toEqual(["invalid-figure-attribute", "invalid-figure-key", "unknown-figure-attribute"]);
  });
});
