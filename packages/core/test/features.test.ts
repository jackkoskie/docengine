// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, Formatter, generateTypst, loadConfig, parse, validate } from "../src/index.js";
import { ROOT, codes, config, doc, parseDoc } from "./helpers.js";

const gen = (body: string, cfg = config, fm?: Record<string, string>) =>
  generateTypst(parseDoc(body, fm), cfg, { templateImport: "/dist/_template/letterhead.typ", resolveAsset: (p) => "/" + p });
const diag = (body: string, cfg = config, fm?: Record<string, string>) => {
  const d = parseDoc(body, fm);
  return validate(d, { config: cfg });
};
const ofCode = (body: string, code: string, cfg = config, fm?: Record<string, string>) => diag(body, cfg, fm).filter((d) => d.code === code);

describe("titles at any depth", () => {
  it("reads `# Title` on the first line and keeps the following lines as the body", () => {
    const d = parseDoc("[100.01] # Intro\nText.\n\n[100.01(1)] # Scope\nBody line one\nbody line two.\n\n[100.01(1)(a)] # Deep\n\nMore.");
    expect(d.findProvision("100.01")!.title).toBe("Intro");
    expect(d.findProvision("100.01")!.blocks).toMatchObject([{ type: "paragraph", text: "Text." }]);
    const c = d.findProvision("100.01(1)")!;
    expect(c.title).toBe("Scope");
    expect(c.titleLine).toBe(c.startLine);
    expect(c.blocks).toMatchObject([{ type: "paragraph", text: "Body line one body line two." }]);
    expect(d.findProvision("100.01(1)(a)")!.title).toBe("Deep");
    expect(d.findProvision("100.01(1)(a)")!.blocks).toHaveLength(1);
  });

  it("is not limited to a depth", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] a\n\n[100.01(1)(a)] b\n\n[100.01(1)(a)(i)] c\n\n[100.01(1)(a)(i)(A)] # Very deep\nx");
    expect(d.findProvision("100.01(1)(a)(i)(A)")!.title).toBe("Very deep");
  });

  it("never takes a title from the first paragraph, at any level", () => {
    const d = parseDoc("[100.01] First paragraph is text\n\nText\n\n[100.01(1)] Plain text, not a title\n\n[100.01(2)] #hashtag stays text");
    expect(d.findProvision("100.01")!.title).toBeUndefined();
    expect(d.findProvision("100.01")!.blocks).toHaveLength(2);
    expect(d.findProvision("100.01(1)")!.title).toBeUndefined();
    expect(d.findProvision("100.01(1)")!.blocks[0]).toMatchObject({ text: "Plain text, not a title" });
    expect(d.findProvision("100.01(2)")!.title).toBeUndefined();
    expect(d.findProvision("100.01(2)")!.blocks[0]).toMatchObject({ text: "#hashtag stays text" });
  });

  it("an empty marker gives an empty title and a warning", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] #\nbody");
    expect(d.findProvision("100.01(1)")!.title).toBe("");
    expect(ofCode("[100.01] S\n\n[100.01(1)] #\nbody", "empty-title")).toHaveLength(1);
    expect(ofCode("[100.01] S\n\n[100.01(1)] # Fine\nbody", "empty-title")).toHaveLength(0);
  });

  it("warns about a `# ` line that is not on the provision's first line", () => {
    const hits = ofCode("[100.01] S\n\n[100.01(1)] # T\nbody\n\n# Not a title\n", "misplaced-title-marker");
    expect(hits).toHaveLength(1);
    expect(ofCode("[100.01] S\n\n[100.01(1)] # T\nbody `# code`", "misplaced-title-marker")).toHaveLength(0);
  });

  it("shows the title in the provision index and in the Typst call, at every depth", () => {
    const d = parseDoc("[100.01] # A\n\n[100.01(1)] # B\ntext");
    expect(d.findProvision("100.01(1)")!.toIndexEntry()).toMatchObject({ title: "B", depth: 4, level: "Subsection" });
    const t = gen("[100.01] # A\n\n[100.01(1)] # B\ntext", OFF);
    expect(t).toContain('#provision("100.01", 3, level-label: "Section", title: [A], level-offset: 2)[');
    expect(t).toContain('#provision("100.01(1)", 4, level-label: "Subsection", label: "(1)", title: [B])[');
  });

  it("fmt keeps titles, attributes and footnotes untouched and does not mistake `[^1]:` for an ID", () => {
    const src = doc("[100.01] # A\nx[^1]\n\n[100.01(1)]{keep} # B\ny\n\n  [] # Blank titled\nz\n\n[^1]: Note\n  more");
    const r = new Formatter().format(src);
    expect(r.text).toContain("[100.01(1)]{keep} # B");
    expect(r.text).toContain("[100.01(2)] # Blank titled");
    expect(r.text).toContain("[^1]: Note\n  more");
    expect(r.problems).toEqual([]);
  });
});

describe("keep with next", () => {
  it("parses {keep} and {break} after the ID, with or without a title", () => {
    const d = parseDoc("[100.01]{keep} # S\n\n[100.01(1)]{break} # T\nx\n\n[100.01(2)] {keep} y\n\n[100.01(3)] {other} z");
    expect(d.findProvision("100.01")!.keep).toBe("keep");
    expect(d.findProvision("100.01")!.title).toBe("S");
    expect(d.findProvision("100.01(1)")!.keep).toBe("break");
    expect(d.findProvision("100.01(1)")!.title).toBe("T");
    expect(d.findProvision("100.01(2)")!.keep).toBe("keep");
    expect(d.findProvision("100.01(3)")!.keep).toBeUndefined();
    expect(d.findProvision("100.01(3)")!.blocks[0]).toMatchObject({ text: "{other} z" });
  });

  it("emits keep: only when explicit or when keepWithNext is off for a heading", () => {
    const t = gen("[100.01] # S\n\n[100.01(1)]{keep} a\n\n[100.01(2)]{break} # B\nb", OFF);
    expect(t).toContain('#provision("100.01", 3, level-label: "Section", title: [S], level-offset: 2)[');
    expect(t).toContain('#provision("100.01(1)", 4, level-label: "Subsection", label: "(1)", keep: true)[');
    expect(t).toContain('#provision("100.01(2)", 4, level-label: "Subsection", label: "(2)", title: [B], keep: false)[');
    const off = gen("[100.01] # S\n\n[100.01(1)] plain\n\n[100.01(2)] # H\nb", loadConfig({ keepWithNext: false, cover: { enabled: false }, headings: { maxDepth: 4 } }));
    expect(off).toContain('title: [S], keep: false, heading-depth: 4, level-offset: 2)[');
    expect(off).toContain('title: [H], keep: false, heading-depth: 4, level-offset: 2)[');
    expect(off).toContain('#provision("100.01(1)", 4, level-label: "Subsection", label: "(1)")[');
  });

  it("keeps the paragraph that introduces a figure with it (unless {break} or keepWithNext is false)", () => {
    const body = "[100.01] S\n\n[100.01(1)] See below:\n\n![Cap](a.svg){#fig:f}\n\n[100.01(2)] [[fig:f]]";
    expect(gen(body)).toContain("#block(sticky: true)[See below:]");
    expect(gen(body.replace("[100.01(1)]", "[100.01(1)]{break}"))).not.toContain("sticky: true)[See below:]");
    expect(gen(body, loadConfig({ keepWithNext: false }))).not.toContain("#block(sticky: true)");
  });

  it("the template implements keep and the heading arguments", () => {
    const tpl = readFileSync(join(ROOT, "templates", "default-letterhead.typ"), "utf8");
    for (const name of ["keep", "heading-format", "heading-depth", "sticky"]) expect(tpl).toContain(name);
  });
});

describe("headings config", () => {
  it("validates and defaults", () => {
    expect(config.headings).toEqual({ format: "{level} {id} \u2014 {title}", maxDepth: 3, pageBreakBefore: 2 });
    expect(config.keepWithNext).toBe(true);
    expect(() => loadConfig({ headings: { maxDepth: 0 } })).toThrow(ConfigError);
    expect(() => loadConfig({ headings: { format: "plain" } })).toThrow(/headings.format/);
    expect(() => loadConfig({ keepWithNext: "yes" })).toThrow(/keepWithNext/);
  });

  it("passes only non-default heading settings to the template", () => {
    expect(gen("[100.01] # S", OFF)).not.toContain("heading-format");
    const t = gen("[100.01] # S\n\n[100.01(1)] # T\nx", loadConfig({ cover: { enabled: false }, headings: { format: "{id}  {title}", maxDepth: 2 } }));
    expect(t).toContain('title: [S], heading-format: "{id}  {title}", heading-depth: 2, level-offset: 2)[');
    expect(t).toContain('title: [T], heading-format: "{id}  {title}", heading-depth: 2)['); // run-in: no level-offset
  });
});

const OFF = loadConfig({ cover: { enabled: false } });

describe("cover page", () => {
  const fm = { cover: "true", subtitle: "A subtitle", effectiveTime: "0300Z", notice: "Notice here" };

  it("can be switched off by config and then leaves the document unchanged", () => {
    const t = gen("[100.01] S", OFF);
    expect(t).not.toContain("cover");
    expect(t).not.toContain("toc-depth");
    expect(t).not.toContain("effective-time");
    expect(t).not.toContain("highlight-color");
  });

  it("is turned on by frontmatter and renders every field from the cover template", () => {
    const cfg = loadConfig({ branding: { firName: "FIR", logo: "assets/logo.png" }, cover: { notice: "Config notice" } });
    const t = gen("[100.01] S", cfg, fm);
    expect(t).toContain('#import "/dist/_template/cover.typ": cover');
    expect(t).toContain("cover: cover(");
    expect(t).toContain('logo: image("/assets/logo.png", height: 4.5cm)');
    expect(t).toContain('subtitle: "A subtitle"');
    expect(t).toContain('effective-time: "0300Z"');
    expect(t).toContain('notice: "Notice here"');
    expect(t).toContain("toc-depth: 1");
  });

  it("is turned on by config, can be turned off per document, and takes the notice default from config", () => {
    const cfg = loadConfig({ cover: { enabled: true, notice: "Config notice", firName: "Cover FIR", logo: "c.svg", colors: { primary: "#112233" } } });
    const on = gen("[100.01] S", cfg);
    expect(on).toContain('notice: "Config notice"');
    expect(on).toContain('fir-name: "Cover FIR"');
    expect(on).toContain('logo: image("/c.svg", height: 4.5cm)');
    expect(on).toContain('primary: rgb("#112233")');
    expect(gen("[100.01] S", cfg, { cover: "false" })).not.toContain("cover:");
  });

  it("validates the config and frontmatter", () => {
    expect(() => loadConfig({ cover: { colors: { primary: "red" } } })).toThrow(/cover.colors.primary/);
    expect(codes(diag("[100.01] S", config, { effectiveTime: "25:00" }))).toContain("frontmatter-schema");
    expect(codes(diag("[100.01] S", config, { effectiveTime: "0300Z" }))).not.toContain("frontmatter-schema");
    expect(codes(diag("[100.01] S", config, { cover: "yes please" }))).toContain("frontmatter-schema");
  });

  it("warns about subtitle/notice when there is no cover", () => {
    expect(ofCode("[100.01] S", "cover-field-ignored", OFF, { subtitle: "x", notice: "y" })).toHaveLength(2);
    expect(ofCode("[100.01] S", "cover-field-ignored", OFF, { subtitle: "x", cover: "true" })).toHaveLength(0);
    expect(ofCode("[100.01] S", "cover-field-ignored", loadConfig({ cover: { enabled: true } }), { notice: "y" })).toHaveLength(0);
  });

  it("effective time also reaches the letterhead when there is no cover", () => {
    expect(gen("[100.01] S", config, { effectiveTime: "0300Z" })).toContain('effective-time: "0300Z",');
  });

  it("ships a cover template that accepts the arguments the generator passes", () => {
    const tpl = readFileSync(join(ROOT, "templates", "default-cover.typ"), "utf8");
    for (const name of ["fir-name", "logo", "title", "subtitle", "version", "effective-date", "effective-time", "notice", "primary", "accent", "font", "draft"]) {
      expect(tpl).toContain(`${name}:`);
    }
    const letterhead = readFileSync(join(ROOT, "templates", "default-letterhead.typ"), "utf8");
    for (const name of ["cover", "toc-depth", "toc-title", "effective-time", "highlight-color"]) expect(letterhead).toContain(`${name}:`);
  });
});

describe("table of contents", () => {
  it("follows the cover by default, can be forced with `toc: true`, and off with `toc: false`", () => {
    expect(gen("[100.01] S")).toContain("toc-depth: 1,");
    expect(gen("[100.01] S", OFF)).not.toContain("toc-depth");
    expect(gen("[100.01] S", OFF, { toc: "true" })).toContain("toc-depth: 1,");
    expect(gen("[100.01] S", config, { cover: "true" })).toContain("toc-depth: 1,");
    expect(gen("[100.01] S", config, { cover: "true", toc: "false" })).not.toContain("toc-depth");
    expect(gen("[100.01] S", config, { cover: "true", toc: "false" })).toContain("cover: cover(");
  });

  it("uses the configured depth and title", () => {
    const t = gen("[6] # P\n\n[602.60] # S\n\n[602.60(1)] x", loadConfig({ toc: { depth: 4, title: "Contents" } }), { toc: "true" });
    expect(t).toContain("toc-depth: 4,");
    expect(t).toContain('toc-title: "Contents",');
    expect(() => loadConfig({ toc: { depth: 1.5 } })).toThrow(/toc.depth/);
  });
});

describe("footnotes", () => {
  it("parses definitions (with indented continuation lines) and references", () => {
    const d = parseDoc("[^a]: First note.\n[^b]: Second\n  continues\n\n  and another paragraph.\n\n[100.01] Text[^a] and more[^b].\n\n[100.01(1)] Another[^a].");
    expect(d.footnotes.map((f) => [f.id, f.text])).toEqual([
      ["a", "First note."],
      ["b", "Second continues and another paragraph."],
    ]);
    expect(d.footnoteReferences.map((r) => [r.id, r.provisionId?.text ?? null])).toEqual([["a", "100.01"], ["b", "100.01"], ["a", "100.01(1)"]]);
    const r = d.footnoteReferences[0]!;
    expect(r.position.length).toBe(4);
    expect(r.idPosition).toMatchObject({ line: r.position.line, column: r.position.column + 2, length: 1 });
    expect(d.footnotes[0]!.idPosition.length).toBe(1);
  });

  it("takes a definition out of the provision text wherever it appears, and ignores code", () => {
    const d = parseDoc("[100.01] Title\n\nBody[^n] `[^x]`\n\n[^n]: Note text\n\n[100.01(1)] after\n\n```\n[^y]: not a footnote\n```");
    expect(d.footnotes.map((f) => f.id)).toEqual(["n"]);
    expect(JSON.stringify(d.findProvision("100.01")!.blocks)).not.toContain("Note text");
    expect(d.footnoteReferences.map((r) => r.id)).toEqual(["n"]);
    expect(d.findProvision("100.01(1)")!.blocks[0]).toMatchObject({ text: "after" });
  });

  it("a `[^id]` at the start of a line is a reference, not a provision", () => {
    const d = parseDoc("[100.01] S\n\n[^n] starts the line\n\n[^n]: ok");
    expect(d.provisions).toHaveLength(1);
    expect(d.footnoteReferences).toHaveLength(1);
    expect(codes(diag("[100.01] S\n\n[^n] starts the line\n\n[^n]: ok"))).not.toContain("invalid-provision-id");
  });

  it("renders real footnotes, then points later uses at the first", () => {
    const t = gen("[100.01] S\n\nOne[^n] two[^n].\n\n[^n]: Text with **bold**.");
    expect(t).toContain("One#footnote[Text with #strong[bold]\\.]<fn-n> two#footnote(<fn-n>)\\.");
  });

  it("works in table cells and figure captions", () => {
    const t = gen("[100.01] S\n\n| A |\n|---|\n| cell[^n] |\n\n![Caption[^n]](a.svg){#fig:f}\n\n[[fig:f]]\n\n[^n]: N");
    expect(t).toContain("[cell#footnote[N]<fn-n>]");
    expect(t).toContain("caption: [Caption#footnote(<fn-n>)]");
  });

  it("reports undefined, unused and duplicate footnotes, nesting and footnotes in titles", () => {
    expect(ofCode("[100.01] S\n\nText[^x].", "undefined-footnote")).toHaveLength(1);
    expect(ofCode("[100.01] S\n\nText.\n\n[^u]: unused", "unused-footnote")[0]!.severity).toBe("warning");
    const dup = ofCode("[100.01] S\n\nT[^d]\n\n[^d]: one\n[^d]: two", "duplicate-footnote");
    expect(dup).toHaveLength(1);
    expect(dup[0]!.severity).toBe("error");
    expect(ofCode("[100.01] S\n\nT[^a]\n\n[^a]: has [^b]\n[^b]: inner", "nested-footnote")).toHaveLength(1);
    expect(ofCode("[100.01] # Title[^a]\ntext\n\n[^a]: note", "footnote-in-title")).toHaveLength(1);
    expect(diag("[100.01] S\n\nT[^ok].\n\n[^ok]: fine").filter((d) => /footnote/.test(d.code))).toEqual([]);
  });

  it("an undefined reference is written out as plain text", () => {
    expect(gen("[100.01] S\n\nText[^x].")).toContain("Text\\[^x\\].");
  });
});

describe("text before the first section", () => {
  const warns = (body: string) => ofCode(body, "content-outside-provision");

  it("ignores HTML comments (single and multi line) and blank lines", () => {
    expect(warns("<!-- one line -->\n\n[100.01] S")).toHaveLength(0);
    expect(warns("\n\n<!--\nmany\nlines\n[100.01(1)] looks like a provision but is a comment\n-->\n\n[100.01] S")).toHaveLength(0);
    expect(warns("<!-- a --> <!-- b -->\n[100.01] S")).toHaveLength(0);
    const d = parseDoc("<!--\n[100.01] not real\n-->\n\n[100.01] # Real");
    expect(d.provisions.map((c) => c.id.text)).toEqual(["100.01"]);
    expect(d.findProvision("100.01")!.title).toBe("Real");
  });

  it("still warns about real text, once", () => {
    expect(warns("Some text\n\nMore text\n\n[100.01] S")).toHaveLength(1);
    expect(warns("<!-- c -->\nreal text\n[100.01] S")).toHaveLength(1);
    expect(warns("<!-- c --> text after\n[100.01] S")).toHaveLength(1);
  });

  it("a footnote definition before the first section is not stray text", () => {
    expect(warns("[^a]: note\n\n[100.01] S[^a]")).toHaveLength(0);
  });
});

describe("table cell merging", () => {
  const table = (rows: string) => `[100.01] # S\n\n| A | B | C |\n|---|---|---|\n${rows}`;

  it("`||` merges a cell into the one on its left (colspan)", () => {
    const d = parseDoc(table("| a1 || c1 |\n| x | y | z |"));
    const b = d.findProvision("100.01")!.blocks[0]!;
    expect(b).toMatchObject({ type: "table", merge: { rows: [["none", "left", "none"], ["none", "none", "none"]] } });
    const t = gen(table("| a1 || c1 |\n| x | y | z |"));
    expect(t).toContain("table.cell(colspan: 2)[a1], [c1],");
    expect(t).toContain("[x], [y], [z],");
  });

  it("a lone `^` merges a cell into the one above (rowspan)", () => {
    const t = gen(table("| a | b | c |\n| ^ | y | z |\n| ^ | p | q |"));
    expect(t).toContain("table.cell(rowspan: 3)[a], [b], [c],");
    expect(t).toContain("[y], [z],");
    expect(t).toContain("[p], [q],");
  });

  it("an ordinary empty cell is not merged, and `^` in the first row is plain text", () => {
    const t = gen(table("| ^ | | z |"));
    expect(t).not.toContain("table.cell");
    expect(t).toContain("[^], [], [z],");
  });

  it("merging in the header works too, and plain tables are unchanged", () => {
    const t = gen("[100.01] # S\n\n| A || C |\n|---|---|---|\n| 1 | 2 | 3 |");
    expect(t).toContain("table.header(table.cell(colspan: 2)[A], [C]),");
    expect(parseDoc(table("| 1 | 2 | 3 |")).findProvision("100.01")!.blocks[0]).not.toHaveProperty("merge");
  });
});

describe("underline and highlight", () => {
  it("renders ++underline++ and ==highlight==, nested with other inline markup", () => {
    const t = gen("[100.01] S\n\nA ++under **bold**++ and ==marked== text; C++ and a == b stay.");
    expect(t).toContain("#underline[under #strong[bold]]");
    expect(t).toContain("#highlight[marked]");
    expect(t).toContain("C++ and a == b stay");
  });

  it("takes the highlight colour from the config", () => {
    expect(gen("[100.01] S", loadConfig({ branding: { colors: { highlight: "#b5e61d" } } }))).toContain('highlight-color: rgb("#b5e61d"),');
    expect(() => loadConfig({ branding: { colors: { highlight: "green" } } })).toThrow(/highlight/);
  });
});

describe("existing documents are unaffected by the new features", () => {
  it("has no new template arguments with the cover switched off", () => {
    const t = gen("[6] # P\n\n[602.60] S\n\n[602.60(1)] a\n\n[602.60(2)] b\n\n[702.01] Title\n\nText", OFF);
    for (const word of ["cover", "toc-", "effective-time", "highlight", "heading-", "keep"]) expect(t).not.toContain(word);
  });
});

describe("page breaks before headings", () => {
  const body = "[6] # P1\n\n[602] # S1\n\n[602.60] # A\n\n[602.60(1)] # B\ntext\n\n[7] # P2\n\n[702] # S2\n\n[702.60] # C\n\n[702.60(1)] # D\nx";
  const breaks = (t: string) => t.split("\n").filter((l) => l.startsWith("#provision(") && l.includes("page-break: true")).map((l) => /provision\("([^"]+)"/.exec(l)![1]);
  const off = loadConfig({ cover: { enabled: false } });

  it("reads {page} and {nopage} next to {keep} and {break}", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)]{page} a\n\n[100.01(2)]{keep}{nopage} b\n\n[100.01(3)]{break} c");
    expect(d.findProvision("100.01(1)")!.page).toBe("page");
    expect(d.findProvision("100.01(2)")!.page).toBe("nopage");
    expect(d.findProvision("100.01(2)")!.keep).toBe("keep");
    expect(d.findProvision("100.01(3)")!.page).toBeUndefined();
    expect(d.findProvision("100.01(1)")!.blocks[0]).toMatchObject({ text: "a" });
  });

  it("starts each declared Part and Subpart on a new page by default when the document has a table of contents", () => {
    expect(breaks(gen(body))).toEqual(["6", "602", "7", "702"]);
  });

  it("does nothing for documents without a table of contents", () => {
    expect(breaks(gen(body, off))).toEqual([]);
    expect(breaks(gen(body, off, { toc: "true" }))).toEqual(["6", "602", "7", "702"]);
  });

  it("follows headings.pageBreakBefore: a level or false", () => {
    expect(breaks(gen(body, loadConfig({ headings: { pageBreakBefore: 1 } })))).toEqual(["6", "7"]);
    expect(breaks(gen(body, loadConfig({ headings: { pageBreakBefore: 3 } })))).toEqual(["6", "602", "602.60", "7", "702", "702.60"]);
    expect(breaks(gen(body, loadConfig({ headings: { pageBreakBefore: false } })))).toEqual([]);
    expect(() => loadConfig({ headings: { pageBreakBefore: 0 } })).toThrow(ConfigError);
    expect(() => loadConfig({ headings: { pageBreakBefore: true } })).toThrow(/pageBreakBefore/);
  });

  it("lets {page} and {nopage} override the config", () => {
    const t = gen("[6]{nopage} # P\n\n[602.60] # A\n\n[602.60(1)]{page} # B\ntext\n\n[602.61]{page} # C", config);
    expect(breaks(t)).toEqual(["602.60(1)", "602.61"]);
    expect(t).toContain('#provision("6", 1, level-label: "Part", title: [P], page-break: false');
    expect(breaks(gen("[602.60] # A\n\n[602.60(1)]{page} # B", loadConfig({ headings: { pageBreakBefore: false } })))).toEqual(["602.60(1)"]);
  });
});

describe("fonts config", () => {
  it("defaults to no bundled fonts", () => {
    expect(loadConfig({}).fonts).toEqual({ paths: [], ignoreSystemFonts: false });
  });

  it("accepts paths and ignoreSystemFonts", () => {
    expect(loadConfig({ fonts: { paths: ["assets/fonts"], ignoreSystemFonts: true } }).fonts).toEqual({ paths: ["assets/fonts"], ignoreSystemFonts: true });
  });

  it("rejects invalid values", () => {
    expect(() => loadConfig({ fonts: { paths: "assets/fonts" } })).toThrow(/fonts.paths/);
    expect(() => loadConfig({ fonts: { paths: [1] } })).toThrow(/fonts.paths/);
    expect(() => loadConfig({ fonts: { ignoreSystemFonts: "yes" } })).toThrow(/ignoreSystemFonts/);
    expect(() => loadConfig({ fonts: [] })).toThrow(/fonts must be an object/);
  });
});
