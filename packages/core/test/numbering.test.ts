// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  CARS,
  CARS_TEMPLATE,
  DECIMAL,
  LEGAL_TEMPLATE,
  Formatter,
  LEGAL,
  ProvisionId,
  Renumberer,
  buildCustomScheme,
  ConfigError,
  generateTypst,
  loadConfig,
  parse,
  validateRepository,
} from "../src/index.js";
import { doc } from "./helpers.js";

const parseAs = (body: string, scheme = CARS) => ProvisionId.parse(body, scheme);

describe("numbering presets", () => {
  it("keeps the cars preset as the default grammar", () => {
    expect(loadConfig({}).numbering).toBe(CARS);
    expect(CARS.example).toBe("602.60(1)(c)(i)(A)(I)");
    expect(parseAs("602.60(1)(c)").display).toBe("Paragraph 602.60(1)(c)");
    expect(parseAs("602.60(1)(c)").typstLabel).toBe("p602-60-1-c");
  });

  it("parses, orders and nests legal ids", () => {
    const ids = ["1", "1.1", "1.1(a)", "1.1(a)(i)", "1.2", "1.10", "2", "2.1"].map((t) => parseAs(t, LEGAL));
    expect(ids.map((id) => id.formProblems())).toEqual(ids.map(() => []));
    expect(ids.map((id) => [id.depth, id.level.label])).toEqual([
      [1, "Article"],
      [2, "Section"],
      [3, "Paragraph"],
      [4, "Subparagraph"],
      [2, "Section"],
      [2, "Section"],
      [1, "Article"],
      [2, "Section"],
    ]);
    expect(parseAs("1.1(a)", LEGAL).parent?.text).toBe("1.1");
    expect(parseAs("1.1", LEGAL).parent?.text).toBe("1");
    expect(parseAs("1", LEGAL).parent).toBeNull();
    expect(parseAs("1.1(a)(i)", LEGAL).requiresParent).toBe(true);
    expect(parseAs("1.1", LEGAL).requiresParent).toBe(false);
    expect(parseAs("1", LEGAL).child(2).text).toBe("1.2");
    expect(parseAs("1.1", LEGAL).child(1).text).toBe("1.1(a)");
    expect(parseAs("1.1(a)", LEGAL).sibling(2)?.text).toBe("1.1(b)");
    expect(parseAs("1.1", LEGAL).sibling(2)).toBeNull();
    expect(parseAs("1.9", LEGAL).nextSection()?.text).toBe("1.10");
    expect(parseAs("1", LEGAL).nextSection()).toBeNull();
    expect(() => parseAs("1.1(a)(i)", LEGAL).child(1)).toThrow();
    const sorted = ["1.10", "1.2", "2", "1.1(b)", "1.1(a)", "1", "1.1"].map((t) => parseAs(t, LEGAL)).sort((a, b) => a.compare(b));
    expect(sorted.map((id) => id.text)).toEqual(["1", "1.1", "1.1(a)", "1.1(b)", "1.2", "1.10", "2"]);
    expect(parseAs("1.1(a)(i)", LEGAL).typstLabel).toBe("p1-1-a-i");
    expect(parseAs("1.1(a)", LEGAL).display).toBe("Paragraph 1.1(a)");
  });

  it("rejects malformed legal ids with the scheme's level names", () => {
    expect(parseAs("1.1(1)", LEGAL).formProblems()[0]).toContain("Paragraph");
    expect(parseAs("1.1(a)(1)", LEGAL).formProblems()[0]).toContain("Subparagraph");
    expect(parseAs("1.1(a)(i)(1)", LEGAL).formProblems()[0]).toContain("deeper than a Subparagraph");
    expect(parseAs("a", LEGAL).isWellFormed).toBe(false);
    expect(parseAs("01", LEGAL).isWellFormed).toBe(false);
  });

  it("parses dotted decimal ids up to six levels", () => {
    expect(parseAs("1.2.3", DECIMAL).depth).toBe(3);
    expect(parseAs("1.2.3", DECIMAL).level.label).toBe("Section");
    expect(parseAs("1.2.3.4", DECIMAL).requiresParent).toBe(true);
    expect(parseAs("1.2.3", DECIMAL).requiresParent).toBe(false);
    expect(parseAs("1.2", DECIMAL).child(3).text).toBe("1.2.3");
    expect(parseAs("1.2.3", DECIMAL).nextSection()?.text).toBe("1.2.4");
    expect(parseAs("1.9", DECIMAL).compare(parseAs("1.10", DECIMAL))).toBeLessThan(0);
    expect(parseAs("1.2.3.4.5.6", DECIMAL).isWellFormed).toBe(true);
    expect(parseAs("1.2.3.4.5.6.7", DECIMAL).formProblems()[0]).toContain("deeper than a Subparagraph");
    expect(parseAs("1.2.3.4.5.6", DECIMAL).typstLabel).toBe("p1-2-3-4-5-6");
    expect(parseAs("1.02", DECIMAL).isWellFormed).toBe(false);
  });

  it("builds a custom scheme and rejects ambiguous ones", () => {
    const custom = buildCustomScheme({
      scheme: "custom",
      levels: [
        { label: "Book", kind: "number" },
        { label: "Chapter", kind: "number", joiner: "." },
        { label: "Clause", kind: "lower-letter", joiner: "()", italic: true },
      ],
    });
    expect(custom.topLevels).toBe(2);
    expect(custom.maxLevel).toBe(3);
    const id = parseAs("2.3(b)", custom);
    expect(id.isWellFormed).toBe(true);
    expect(id.display).toBe("Clause 2.3(b)");
    expect(id.parent?.text).toBe("2.3");
    expect(id.level.italicLabel).toBe(true);
    expect(parseAs("2", custom).child(4).text).toBe("2.4");
    const dotted = buildCustomScheme({
      scheme: "custom",
      topLevels: 2,
      levels: [
        { label: "Section", kind: "number" },
        { label: "Subsection", kind: "number", joiner: "." },
        { label: "Paragraph", kind: "number", joiner: ".", italic: true },
        { label: "Subparagraph", kind: "lower-letter", joiner: "()" },
        { label: "Clause", kind: "lower-roman", joiner: "()" },
      ],
    });
    const deep = parseAs("1.2.3(b)(iv)", dotted);
    expect(deep.isWellFormed).toBe(true);
    expect(deep.depth).toBe(5);
    expect(deep.level.label).toBe("Clause");
    expect(parseAs("1.2.3", dotted).parent?.text).toBe("1.2");
    expect(() => buildCustomScheme({ scheme: "custom", levels: [] })).toThrow(/at least one/);
    expect(() => buildCustomScheme({ scheme: "custom", levels: [{ label: "A", kind: "digits" as "number" }] })).toThrow(/kind/);
    expect(() =>
      buildCustomScheme({
        scheme: "custom",
        levels: [
          { label: "Part", kind: "number" },
          { label: "Subpart", kind: "number", joiner: "" },
        ],
      }),
    ).toThrow(/digits/);
  });

  it("compiles the cars and legal presets from custom templates", () => {
    const cars = buildCustomScheme(CARS_TEMPLATE);
    const legal = buildCustomScheme(LEGAL_TEMPLATE);
    expect(cars.key).toBe(CARS.key);
    expect(legal.key).toBe(LEGAL.key);
    expect(cars.name).toBe("custom");
    expect(CARS.example).toBe("602.60(1)(c)(i)(A)(I)");

    for (const text of ["6", "600", "602", "602.01", "602.60", "602.100", "602.60(1)(c)(i)(A)(I)"]) {
      const preset = parseAs(text);
      const copy = parseAs(text, cars);
      expect(copy.formProblems(), text).toEqual(preset.formProblems());
      expect(copy.parent?.text).toBe(preset.parent?.text);
      expect(copy.depth).toBe(preset.depth);
    }
    expect(parseAs("6").child(2).text).toBe("602");
    expect(parseAs("602").child(1).text).toBe("602.01");
    expect(parseAs("602.99").nextSection()?.text).toBe("602.100");
    expect(parseAs("602.00").isWellFormed).toBe(false);
    expect(parseAs("6(1)").isWellFormed).toBe(false);
    expect(parseAs("1.1(a)(i)", legal).parent?.text).toBe(parseAs("1.1(a)(i)", LEGAL).parent?.text);
    expect(parseAs("1.9", legal).nextSection()?.text).toBe("1.10");

    const order = ["602.60(1)(b)", "602.60", "602", "6", "602.60(1)(a)", "602.115", "603.01", "601.02"];
    const by = (scheme: typeof CARS) =>
      order.filter((t) => parseAs(t, scheme).isWellFormed).sort((a, b) => parseAs(a, scheme).compare(parseAs(b, scheme)));
    expect(by(cars)).toEqual(by(CARS));
  });
});

describe("numbering config and front matter", () => {
  it("validates numbering when the config loads", () => {
    expect(loadConfig({ numbering: "decimal" }).numbering.name).toBe("decimal");
    expect(loadConfig({ numbering: { scheme: "custom", levels: [{ label: "Item", kind: "number" }] } }).numbering.name).toBe("custom");
    expect(() => loadConfig({ numbering: "outline" })).toThrow(ConfigError);
    expect(() => loadConfig({ numbering: { scheme: "custom", levels: [{ label: "", kind: "number" }] } })).toThrow(/label/);
    expect(() => loadConfig({ levels: ["a", "b"] })).not.toThrow();
  });

  it("lets front matter override the workspace scheme", () => {
    const legal = parse(doc("[1.1] # Scope\n\n[1.1(a)] Text.", { numbering: "legal" }), { scheme: CARS, file: "documents/g/t.md" });
    expect(legal.scheme).toBe(LEGAL);
    expect(legal.provisions.map((c) => c.id.level.label)).toEqual(["Section", "Paragraph"]);
    expect(legal.diagnostics.map((d) => d.code)).not.toContain("invalid-numbering");

    const fallback = parse(doc("[100.01] S", { numbering: "outline" }), { scheme: CARS });
    expect(fallback.scheme).toBe(CARS);
    expect(fallback.diagnostics.map((d) => d.code)).toContain("invalid-numbering");
    expect(fallback.provisions[0]!.id.isWellFormed).toBe(true);
  });

  it("warns when a cross-document reference uses a different scheme", () => {
    const cars = parse(doc("[100.01] See [[other#1.1]].", { short: "cars-doc" }), { file: "documents/g/cars-doc.md" });
    const legal = parse(doc("[1] # A\n\n[1.1] # S", { short: "other", numbering: "legal" }), { file: "documents/g/other.md" });
    const diags = validateRepository(
      [
        { file: "documents/g/cars-doc.md", doc: cars },
        { file: "documents/g/other.md", doc: legal },
      ],
      { config: loadConfig({}) },
    );
    const mismatch = diags.filter((d) => d.code === "numbering-scheme-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.message).toContain("legal");
    expect(mismatch[0]!.message).toContain("cars");
    expect(diags.map((d) => d.code)).not.toContain("unresolved-reference");
  });
});

describe("numbering in authoring and typst", () => {
  it("renumbers a legal provision and its descendants", () => {
    const source = doc("[1.1] # S\n\n[1.1(a)] a\n\n[1.1(a)(i)] i\n", { numbering: "legal" });
    const file = "documents/g/t.md";
    const parsed = parse(source, { file });
    const plan = new Renumberer().plan([{ file, source, doc: parsed }], file, [{ from: "1.1(a)", to: "1.1(b)" }]);
    expect(plan.problems).toEqual([]);
    expect(plan.edits[0]!.text).toContain("[1.1(b)] a");
    expect(plan.edits[0]!.text).toContain("[1.1(b)(i)] i");
    expect(plan.edits[0]!.text).not.toContain("[1.1(a)");
  });

  it("fills blank legal ids from indentation", () => {
    const result = new Formatter().format("[1] # Article\n\n[] First\n\n  [] a\n\n  [] b\n", { scheme: LEGAL });
    expect(result.problems).toEqual([]);
    expect(result.text).toContain("[1.1] First");
    expect(result.text).toContain("[1.1(a)] a");
    expect(result.text).toContain("[1.1(b)] b");
  });

  it("renders legal headings and italic paragraph labels", () => {
    const parsed = parse(doc("[1] # Principles\n\n[1.1] # Scope\n\n[1.1(a)] Text.", { numbering: "legal" }));
    const typ = generateTypst(parsed, loadConfig({ cover: { enabled: false } }), { templateImport: "/t.typ" });
    expect(typ).toContain('level-label: "Article", structural-heading: true');
    expect(typ).toContain('level-label: "Section", structural-heading: true');
    expect(typ).toContain('level-label: "Paragraph", label: "(a)", structural-heading: false, italic-label: true');
    const dotted = buildCustomScheme({
      scheme: "custom",
      topLevels: 2,
      levels: [
        { label: "Section", kind: "number" },
        { label: "Subsection", kind: "number", joiner: "." },
        { label: "Paragraph", kind: "number", joiner: ".", italic: true },
      ],
    });
    const dottedTyp = generateTypst(parse(doc("[1.1] # Scope\n\n[1.1.1] Text."), { scheme: dotted }), loadConfig({ cover: { enabled: false } }), {
      templateImport: "/t.typ",
    });
    expect(dottedTyp).toContain('level-label: "Paragraph", label: ".1", structural-heading: false, italic-label: true');
    expect(typ).toContain("<p1-1-a>");
    const cars = generateTypst(parse(doc("[100.01] # S\n\n[100.01(1)] x")), loadConfig({ cover: { enabled: false } }), { templateImport: "/t.typ" });
    expect(cars).not.toContain("structural-heading");
    expect(cars).not.toContain("show-label");
    expect(cars).toContain('level-label: "Section"');
    expect(cars).toContain('label: "(1)"');
  });

  it("omits the level name in headings when showLabel is false", () => {
    const quiet = buildCustomScheme({
      scheme: "custom",
      levels: [
        { label: "Section", kind: "number", showLabel: false },
        { label: "Clause", kind: "lower-letter", joiner: "()", italic: true },
      ],
    });
    expect(parseAs("2", quiet).display).toBe("Section 2");
    expect(parseAs("2", quiet).level.showLabel).toBe(false);
    const parsed = parse(doc("[2] # Title\n\n[2(a)] Text."), { scheme: quiet });
    const typ = generateTypst(parsed, loadConfig({ cover: { enabled: false }, toc: { depth: 2 } }), { templateImport: "/t.typ" });
    expect(typ).toContain('level-label: "Section", structural-heading: true, show-label: false');
    expect(typ).toContain('level-label: "Clause", label: "(a)", structural-heading: false, italic-label: true');
    expect(typ).not.toContain('level-label: "Clause", label: "(a)", structural-heading: false, italic-label: true, show-label');
  });

  it("indents a hanging label by the level's own step count", () => {
    const levels = [
      { label: "Section", kind: "number" as const, indent: 2 },
      { label: "Paragraph", kind: "lower-letter" as const, joiner: "()" as const, italic: true, indent: 2 },
      { label: "Clause", kind: "lower-roman" as const, joiner: "()" as const },
    ];
    const scheme = buildCustomScheme({ scheme: "custom", topLevels: 1, levels });
    const plain = buildCustomScheme({
      scheme: "custom",
      topLevels: 1,
      levels: levels.map(({ indent: _indent, ...level }) => level),
    });
    expect(scheme.key).toBe(plain.key);
    expect(parseAs("1", scheme).level.indent).toBe(2);
    expect(parseAs("1(a)", scheme).level.indent).toBe(2);
    expect(parseAs("1(a)(i)", scheme).level.indent).toBe(0);
    expect(parseAs("602.60(1)(a)").level.indent).toBe(1);
    expect(parseAs("602.60(1)(a)(i)").level.indent).toBe(2);
    expect(parseAs("602.60(1)(a)(i)(A)").level.indent).toBe(3);
    expect(parseAs("602.60(1)(a)(i)(A)(I)").level.indent).toBe(4);
    expect(CARS.levels[3]!.indent).toBe(0);
    expect(DECIMAL.levels[4]!.indent).toBe(1);
    expect(DECIMAL.levels[5]!.indent).toBe(2);
    expect(parseAs("1.1(a)", LEGAL).level.indent).toBe(0);
    expect(() => buildCustomScheme({ scheme: "custom", levels: [{ label: "Section", kind: "number", indent: -1 }] })).toThrow(/indent/);
    expect(() => buildCustomScheme({ scheme: "custom", levels: [{ label: "Section", kind: "number", indent: 1.5 }] })).toThrow(/indent/);
    expect(() => buildCustomScheme({ scheme: "custom", levels: [{ label: "Section", kind: "number", indent: true as unknown as number }] })).toThrow(/indent/);

    const parsed = parse(doc("[1] # Scope\n\n[1(a)] Text.\n\n[1(a)(i)] Deep."), { scheme });
    const typ = generateTypst(parsed, loadConfig({ cover: { enabled: false } }), { templateImport: "/t.typ" });
    expect(typ).toContain('#provision("1", 1, level-label: "Section", structural-heading: true, title: [Scope])');
    expect(typ).not.toMatch(/provision\("1",.*indent/);
    expect(typ).toContain('level-label: "Paragraph", label: "(a)", structural-heading: false, italic-label: true, indent: 2');
    expect(typ).toContain('level-label: "Clause", label: "(i)", structural-heading: false)');
    expect(typ).not.toMatch(/provision\("1\(a\)\(i\)".*indent/);

    const flush = buildCustomScheme({
      scheme: "custom",
      topLevels: 1,
      levels: [
        { label: "Section", kind: "number" },
        { label: "Paragraph", kind: "lower-letter", joiner: "()", indent: 0 },
      ],
    });
    const flushTyp = generateTypst(parse(doc("[1] # Scope\n\n[1(a)] Text."), { scheme: flush }), loadConfig({ cover: { enabled: false } }), {
      templateImport: "/t.typ",
    });
    expect(flushTyp).not.toContain("indent:");
  });

  it("lets each level choose its own page break", () => {
    const levels = [
      { label: "Section", kind: "number" as const, pageBreak: true },
      { label: "Subsection", kind: "number" as const, joiner: "." as const, pageBreak: false },
      { label: "Paragraph", kind: "lower-letter" as const, joiner: "()" as const, italic: true },
    ];
    const scheme = buildCustomScheme({ scheme: "custom", topLevels: 2, levels });
    const sameGrammar = buildCustomScheme({
      scheme: "custom",
      topLevels: 2,
      levels: levels.map(({ pageBreak: _pageBreak, ...level }) => level),
    });
    expect(scheme.key).toBe(sameGrammar.key);
    expect(parseAs("1", scheme).level.pageBreak).toBe(true);
    expect(parseAs("1.1", scheme).level.pageBreak).toBe(false);
    expect(parseAs("1.1(a)", scheme).level.pageBreak).toBeNull();
    expect(() =>
      buildCustomScheme({ scheme: "custom", levels: [{ label: "Section", kind: "number", pageBreak: "yes" as unknown as boolean }] }),
    ).toThrow(/pageBreak/);

    const parsed = parse(doc("[1]{nopage} # Scope\n\n[1.1] # Application\n\n[1.2] # Next\n\n[1.2(a)] Text."), { scheme });
    const typ = generateTypst(parsed, loadConfig({ headings: { pageBreakBefore: false } }), { templateImport: "/t.typ" });
    expect(typ).toContain('#provision("1", 1, level-label: "Section", structural-heading: true, title: [Scope], page-break: false)');
    expect(typ).toContain('#provision("1.1", 2, level-label: "Subsection", structural-heading: true, title: [Application])');
    expect(typ).toContain('#provision("1.2", 2, level-label: "Subsection", structural-heading: true, title: [Next])');
    expect(typ).not.toMatch(/provision\("1\.1".*page-break/);
    expect(typ).not.toMatch(/provision\("1\.2".*page-break/);
    expect(typ).not.toMatch(/provision\("1\.2\(a\)".*page-break/);

    const broken = generateTypst(
      parse(doc("[1] # Scope\n\n[1.1] # Application\n\n[1.1(a)] Text."), { scheme }),
      loadConfig({ headings: { pageBreakBefore: 2 } }),
      { templateImport: "/t.typ" },
    );
    expect(broken).toContain('#provision("1", 1, level-label: "Section", structural-heading: true, title: [Scope], page-break: true)');
    expect(broken).toContain('#provision("1.1", 2, level-label: "Subsection", structural-heading: true, title: [Application], page-break: false)');
  });

  it("does not warn when a reference uses a custom copy of the cars template", () => {
    const pasted = buildCustomScheme(CARS_TEMPLATE);
    const cars = parse(doc("[100.01] See [[other#602.60]].", { short: "cars-doc" }), { file: "documents/g/cars-doc.md" });
    const other = parse(doc("[602.60] # S", { short: "other" }), { file: "documents/g/other.md", scheme: pasted });
    const diags = validateRepository(
      [
        { file: "documents/g/cars-doc.md", doc: cars },
        { file: "documents/g/other.md", doc: other },
      ],
      { config: loadConfig({}) },
    );
    expect(diags.map((d) => d.code)).not.toContain("numbering-scheme-mismatch");
  });
});
