// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { LEVELS, LEVEL_NAMES, ProvisionId, ids, levelLabel, typstLabelForProvision } from "../src/index.js";

const P = ProvisionId.parse;

describe("provision ID scheme", () => {
  it("has eight fixed levels with the CARs vocabulary", () => {
    expect(LEVEL_NAMES).toEqual(["Part", "Subpart", "Section", "Subsection", "Paragraph", "Subparagraph", "Clause", "Subclause"]);
    expect(LEVELS.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(levelLabel(7)).toBe("Clause");
  });

  it("converts letters beyond z", () => {
    expect(ids.toLetters(1)).toBe("a");
    expect(ids.toLetters(26)).toBe("z");
    expect(ids.toLetters(27)).toBe("aa");
    expect(ids.toLetters(28)).toBe("ab");
    expect(ids.fromLetters("ab")).toBe(28);
  });

  it("converts roman numerals and rejects non-canonical ones", () => {
    expect(ids.toRoman(4)).toBe("iv");
    expect(ids.fromRoman("xiv")).toBe(14);
    expect(ids.fromRoman("iiii")).toBeNull();
    expect(ids.fromRoman("vx")).toBeNull();
    expect(ids.fromRoman("a")).toBeNull();
  });

  it("derives the level from the shape of the ID", () => {
    const levels: [string, number, string][] = [
      ["6", 1, "Part"],
      ["602", 2, "Subpart"],
      ["600", 2, "Subpart"],
      ["602.60", 3, "Section"],
      ["602.115", 3, "Section"],
      ["602.60(1)", 4, "Subsection"],
      ["602.60(1)(c)", 5, "Paragraph"],
      ["602.60(1)(c)(i)", 6, "Subparagraph"],
      ["602.60(1)(c)(i)(A)", 7, "Clause"],
      ["602.60(1)(c)(i)(A)(I)", 8, "Subclause"],
    ];
    for (const [id, depth, label] of levels) {
      expect(ids.idFormatProblems(id), id).toEqual([]);
      expect(P(id).depth).toBe(depth);
      expect(P(id).level.label).toBe(label);
    }
  });

  it("resolves (i) and (I) by position: the ninth letter at paragraph level, a roman numeral below it", () => {
    expect(P("602.60(1)(i)").ordinal).toBe(9);
    expect(P("602.60(1)(i)").level.name).toBe("paragraph");
    expect(P("602.60(1)(a)(i)").ordinal).toBe(1);
    expect(P("602.60(1)(a)(i)").level.name).toBe("subparagraph");
    expect(P("602.60(1)(a)(i)(I)").ordinal).toBe(9); // (I) is the ninth letter at Clause level
    expect(P("602.60(1)(a)(i)(I)").level.name).toBe("clause");
    expect(P("602.60(1)(a)(i)(A)(I)").ordinal).toBe(1);
    expect(P("602.60(1)(a)(i)(A)(I)").level.name).toBe("subclause");
    // letters past z at paragraph and clause level
    expect(P("602.60(1)(aa)").ordinal).toBe(27);
    expect(P("602.60(1)(a)(i)(AA)").ordinal).toBe(27);
  });

  it("rejects wrong shapes at each level", () => {
    for (const bad of [
      "60", // neither part nor subpart
      "0",
      "6021",
      "602.6", // section number needs two digits
      "602.6000",
      "602.00",
      "60.20",
      "602.60(0)",
      "602.60(01)",
      "602.60(a)", // subsection must be a number
      "602.60(1)(1)", // paragraph must be a letter
      "602.60(1)(A)", // paragraph is lowercase
      "602.60(1)(a)(a)", // subparagraph is roman
      "602.60(1)(a)(I)", // subparagraph is lowercase
      "602.60(1)(a)(i)(a)", // clause is uppercase
      "602.60(1)(a)(i)(A)(i)", // subclause is uppercase
      "602.60(1)(a)(i)(A)(I)(1)", // deeper than Subclause
      "602.60()",
      "602.60(1",
      "6(1)", // a Part has no numbered levels
      "602(1)",
      "x",
    ]) {
      expect(P(bad).isWellFormed, bad).toBe(false);
      expect(P(bad).formProblems().length, bad).toBeGreaterThan(0);
    }
    expect(P("602.60(1)(a)(i)(A)(I)(1)").formProblems()[0]).toContain("deeper than a Subclause");
  });

  it("knows parents; Parts, Subparts and Sections need none", () => {
    expect(P("602.60(1)(c)").parent?.text).toBe("602.60(1)");
    expect(P("602.60(1)").parent?.text).toBe("602.60");
    expect(P("602.60").parent?.text).toBe("602");
    expect(P("602").parent?.text).toBe("6");
    expect(P("6").parent).toBeNull();
    expect(P("602.60(1)(c)").requiresParent).toBe(true);
    expect(P("602.60").requiresParent).toBe(false);
    expect(P("602.60(1)(c)").ancestors.map((a) => a.text)).toEqual(["602.60(1)", "602.60", "602", "6"]);
    expect(P("602.60(1)(c)").isDescendantOf(P("602.60"))).toBe(true);
    expect(P("602.60").isDescendantOf(P("6"))).toBe(true);
    expect(P("602.60").isDescendantOf(P("603"))).toBe(false);
  });

  it("builds children, siblings and the next Section", () => {
    expect(P("602.60").child(2).text).toBe("602.60(2)");
    expect(P("602.60(1)").child(3).text).toBe("602.60(1)(c)");
    expect(P("602.60(1)(c)").child(4).text).toBe("602.60(1)(c)(iv)");
    expect(P("602.60(1)(c)(iv)").child(2).text).toBe("602.60(1)(c)(iv)(B)");
    expect(P("602.60(1)(c)(iv)(B)").child(9).text).toBe("602.60(1)(c)(iv)(B)(IX)");
    expect(() => P("602.60(1)(c)(iv)(B)(IX)").child(1)).toThrow();
    expect(P("602.60(1)(c)").sibling(5)?.text).toBe("602.60(1)(e)");
    expect(P("602.60").sibling(2)).toBeNull();
    expect(P("602.60").nextSection()?.text).toBe("602.61");
    expect(P("602.09").nextSection()?.text).toBe("602.10");
    expect(P("602.99").nextSection()?.text).toBe("602.100");
    expect(P("602").nextSection()).toBeNull();
  });

  it("compares in document order by ordinal, not by text", () => {
    const sorted = ["602.60(1)(b)", "602.60", "602", "6", "602.9", "602.60(1)(a)(ii)", "602.60(1)(a)", "602.60(1)", "602.115", "603.01", "601.02", "602.60(1)(a)(i)", "602.60(2)", "602.60(1)(aa)", "602.60(1)(z)"]
      .filter((t) => P(t).isWellFormed)
      .sort((a, b) => P(a).compare(P(b)));
    expect(sorted).toEqual([
      "6",
      "601.02",
      "602",
      "602.60",
      "602.60(1)",
      "602.60(1)(a)",
      "602.60(1)(a)(i)",
      "602.60(1)(a)(ii)",
      "602.60(1)(b)",
      "602.60(1)(z)",
      "602.60(1)(aa)",
      "602.60(2)",
      "602.115",
      "603.01",
    ]);
  });

  it("exposes parts of the ID and a display name", () => {
    const id = P("602.60(1)(c)");
    expect(id.partDigit).toBe("6");
    expect(id.subpartCode).toBe("602");
    expect(id.sectionId?.text).toBe("602.60");
    expect(id.label).toBe("(c)");
    expect(P("602.60").label).toBe("602.60");
    expect(id.display).toBe("Paragraph 602.60(1)(c)");
    expect(P("602").display).toBe("Subpart 602");
  });

  it("is immutable and serialises to its text", () => {
    const id = P("602.60(1)");
    expect(Object.isFrozen(id)).toBe(true);
    expect(JSON.stringify({ id })).toBe('{"id":"602.60(1)"}');
    expect(`${id}`).toBe("602.60(1)");
    expect(id.equals(P("602.60(1)"))).toBe(true);
  });

  it("builds Typst labels without parentheses or dots, keeping case", () => {
    expect(typstLabelForProvision("602.60(1)(c)(i)(A)")).toBe("p602-60-1-c-i-A");
    expect(typstLabelForProvision("602.60(1)(c)(i)(A)(I)")).toBe("p602-60-1-c-i-A-I");
    expect(typstLabelForProvision("602.60(1)(a)(i)(A)(i)")).not.toBe(typstLabelForProvision("602.60(1)(a)(i)(A)(I)"));
    expect(typstLabelForProvision("602")).toBe("p602");
    expect(typstLabelForProvision("6")).toBe("p6");
  });
});
