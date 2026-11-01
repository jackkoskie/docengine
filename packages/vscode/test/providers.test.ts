// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { CodeActionProvider } from "../src/providers/code-actions.js";
import { CompletionProvider } from "../src/providers/completion.js";
import { HoverProvider } from "../src/providers/hover.js";
import { NavigationProvider } from "../src/providers/navigation.js";
import { RenameError, RenamePlanner, RenameService, type PublishedIds } from "../src/providers/rename.js";
import { FoldingProvider, OutlineProvider, SemanticTokensProvider } from "../src/providers/structure.js";
import { SymbolLocator } from "../src/index/symbols.js";
import type { Range } from "../src/types.js";
import { OTHER, OTHER_FILE, POLICY, POLICY_FILE, colOf, indexOf, lineOf, twoDocs } from "./helpers.js";

const assets = { uriFor: (f: string) => `file:///ws/${f}` };

function applyEdits(text: string, edits: { range: Range; newText: string }[]): string {
  const lines = text.split("\n");
  const sorted = [...edits].sort((a, b) => b.range.startLine - a.range.startLine || b.range.startChar - a.range.startChar);
  for (const e of sorted) {
    const l = lines[e.range.startLine]!;
    lines[e.range.startLine] = l.slice(0, e.range.startChar) + e.newText + l.slice(e.range.endChar);
  }
  return lines.join("\n");
}

describe("CompletionProvider", () => {
  const provider = (idx = twoDocs()) => new CompletionProvider(idx, { extensionKeys: () => ["required"] }, () => "2026-10-26");
  const withLine = (text: string, line: string) => indexOf({ [POLICY_FILE]: POLICY.replace("[200.01(1)] DR requests are processed as described in [[100.01(1)]] and in see Section 100.01(1) below.", line), [OTHER_FILE]: OTHER });

  it("after [[ suggests provision IDs with text, fig: keys and other-doc# targets", () => {
    const idx = withLine(POLICY, "[200.01(1)] See [[");
    const row = idx.get(POLICY_FILE)!.lines.findIndex((l) => l === "[200.01(1)] See [[");
    const items = provider(idx).provide(POLICY_FILE, row, 18);
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(["100.01(1)", "100.01(2)(a)", "fig:rvsm", "relief#"]));
    const c = items.find((i) => i.label === "100.01(1)")!;
    expect(c.detail).toContain("Departure release");
    expect(c.replace).toEqual({ startLine: row, startChar: 18, endLine: row, endChar: 18 });
    expect(items.find((i) => i.label === "relief#")!.retrigger).toBe(true);
  });

  it("completes provision IDs and figure keys of another document after other-doc#", () => {
    const idx = indexOf({
      [POLICY_FILE]: POLICY,
      [OTHER_FILE]: OTHER.replace("[100.01(1)] Cross reference", "[100.01(1)] Cross [[departure-release#"),
    });
    const row = idx.get(OTHER_FILE)!.lines.findIndex((l) => l.includes("Cross [["));
    const text = idx.get(OTHER_FILE)!.lineText(row);
    const col = text.indexOf("[[departure-release#") + "[[departure-release#".length;
    const items = provider(idx).provide(OTHER_FILE, row, col);
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["100.01(2)", "200.01(1)", "fig:rvsm"]));
    expect(items.find((i) => i.label === "100.01(2)")!.replace.startChar).toBe(col);
  });

  it("after fig: offers bare keys", () => {
    const idx = withLine(POLICY, "[200.01(1)] See [[fig:");
    const row = idx.get(POLICY_FILE)!.lines.findIndex((l) => l === "[200.01(1)] See [[fig:");
    const items = provider(idx).provide(POLICY_FILE, row, 22);
    expect(items.map((i) => i.label)).toEqual(["rvsm"]);
    expect(items[0]!.detail).toBe("Figure 1: RVSM profile");
  });

  it("suggests next IDs at the right depth when starting a provision line", () => {
    const idx = withLine(POLICY, "[");
    const row = idx.get(POLICY_FILE)!.lines.findIndex((l) => l === "[");
    const items = provider(idx).provide(POLICY_FILE, row, 1);
    const labels = items.map((i) => i.label);
    // previous provision is Section 200.01 (its only child was replaced by this line)
    expect(labels).toContain("200.02");
    expect(labels).toContain("200.01(1)");
    expect(items[0]!.insertText.endsWith("] ")).toBe(true);
  });

  it("offers sibling, child and parent-sibling IDs after a nested provision", () => {
    const text = `---\ntitle: T\nshort: t\ngroup: g\nversion: "1.0"\neffectiveDate: 2024-01-01\n---\n\n[100.01] A\n\n[100.01(1)] B\n\n[100.01(1)(a)] C\n\n[`;
    const idx = indexOf({ "documents/g/t.md": text });
    const row = idx.get("documents/g/t.md")!.lines.length - 1;
    const labels = provider(idx).provide("documents/g/t.md", row, 1).map((i) => i.label);
    expect(labels).toEqual(["100.01(1)(b)", "100.01(1)(a)(i)", "100.01(2)", "100.02"]);
  });

  it("swallows an auto-inserted closing bracket", () => {
    const text = `---\ntitle: T\nshort: t\ngroup: g\nversion: "1.0"\neffectiveDate: 2024-01-01\n---\n\n[100.01] A\n\n[]`;
    const idx = indexOf({ "documents/g/t.md": text });
    const row = idx.get("documents/g/t.md")!.lines.length - 1;
    const first = provider(idx).provide("documents/g/t.md", row, 1)[0]!;
    expect(first.replace.endChar).toBe(2);
  });

  it("completes frontmatter keys and values", () => {
    const text = POLICY.replace("description: When departure release is granted.", "d");
    const idx = indexOf({ [POLICY_FILE]: text, [OTHER_FILE]: OTHER });
    const row = 6; // the lone "d" line
    const keys = provider(idx).provide(POLICY_FILE, row, 1).map((i) => i.label);
    expect(keys).toContain("description");
    expect(keys).toContain("required");
    expect(keys).not.toContain("title");

    const dateText = POLICY.replace("effectiveDate: 2023-06-06", "effectiveDate: ");
    const idx2 = indexOf({ [POLICY_FILE]: dateText });
    const dateRow = lineOf(dateText, "effectiveDate");
    expect(provider(idx2).provide(POLICY_FILE, dateRow, "effectiveDate: ".length)[0]!.label).toBe("2026-10-26");

    const groupText = POLICY.replace("group: operations", "group: ");
    const idx3 = indexOf({ [POLICY_FILE]: groupText, [OTHER_FILE]: OTHER });
    expect(provider(idx3).provide(POLICY_FILE, lineOf(groupText, "group:"), 7).map((i) => i.label)).toEqual(["operations"]);
  });

  it("returns nothing in ordinary prose", () => {
    expect(provider().provide(POLICY_FILE, lineOf(POLICY, "[100.01(1)]"), 20)).toEqual([]);
  });
});

describe("HoverProvider", () => {
  const hover = (idx = twoDocs()) => new HoverProvider(idx, assets, () => "Figure");

  it("shows the referenced provision text", () => {
    const row = lineOf(POLICY, "[200.01(1)]");
    const h = hover().provide(POLICY_FILE, row, colOf(POLICY, "[[100.01(1)]]", 3))!;
    expect(h.markdown).toContain("**Subsection 100.01(1)**");
    expect(h.markdown).toContain("automatically granted");
  });

  it("shows figure caption with a thumbnail", () => {
    const h = hover().provide(POLICY_FILE, lineOf(POLICY, "See [[fig:rvsm]]"), colOf(POLICY, "[[fig:rvsm]]", 4))!;
    expect(h.markdown).toContain("**Figure 1**: RVSM profile");
    expect(h.markdown).toContain("![RVSM profile](file:///ws/documents/operations/images/rvsm.svg)");
  });

  it("adds document title and version for cross-document references", () => {
    const h = hover().provide(OTHER_FILE, lineOf(OTHER, "Cross"), colOf(OTHER, "[[departure-release#100.01(2)]]", 5))!;
    expect(h.markdown).toContain("Should ZXAA_TWR");
    expect(h.markdown).toContain("Departure Release (DR) Authority (v1.0)");
  });

  it("reports unresolved references and ignores plain text", () => {
    const text = POLICY.replace("[[100.01(1)]]", "[[100.01(9)]]");
    const idx = indexOf({ [POLICY_FILE]: text });
    const h = new HoverProvider(idx, assets, () => "Figure").provide(POLICY_FILE, lineOf(text, "[200.01(1)]"), colOf(text, "[[100.01(9)]]", 3))!;
    expect(h.markdown).toContain("Unresolved");
    expect(hover().provide(POLICY_FILE, lineOf(POLICY, "[100.01(1)]"), 40)).toBeUndefined();
  });
});

describe("NavigationProvider", () => {
  const nav = new NavigationProvider(twoDocs());

  it("goes from a reference to the provision declaration, across documents", () => {
    const [loc] = nav.definition(OTHER_FILE, lineOf(OTHER, "Cross"), colOf(OTHER, "[[departure-release#100.01(2)]]", 20));
    expect(loc!.file).toBe(POLICY_FILE);
    expect(loc!.range.startLine).toBe(lineOf(POLICY, "[100.01(2)] Should"));
  });

  it("goes to figure declarations", () => {
    const [loc] = nav.definition(POLICY_FILE, lineOf(POLICY, "See [[fig:rvsm]]"), colOf(POLICY, "[[fig:rvsm]]", 6));
    expect(loc!.range.startLine).toBe(lineOf(POLICY, "{#fig:rvsm"));
  });

  it("finds all references repo-wide, with or without the declaration", () => {
    const at = [POLICY_FILE, lineOf(POLICY, "[100.01(2)] Should"), 2] as const;
    const all = nav.references(...at, true);
    expect(all.map((l) => l.file).sort()).toEqual([POLICY_FILE, OTHER_FILE]);
    expect(nav.references(...at, false)).toHaveLength(1);
  });

  it("finds figure usages across documents", () => {
    const refs = nav.references(POLICY_FILE, lineOf(POLICY, "{#fig:rvsm"), colOf(POLICY, "{#fig:rvsm", 4), false);
    expect(refs.map((l) => l.file).sort()).toEqual([POLICY_FILE, OTHER_FILE]);
  });
});

describe("rename", () => {
  const published = (ids: string[] | undefined): PublishedIds => ({
    idsFor: async () => (ids ? { ids: new Set(ids), version: "1.0" } : undefined),
  });

  it("renames a provision, its nested provisions and every reference repo-wide", async () => {
    const idx = twoDocs();
    const svc = new RenameService(idx, published(undefined));
    const res = await svc.rename(POLICY_FILE, lineOf(POLICY, "[100.01(2)] Should"), 2, "100.01(3)");
    expect(res.warning).toBeUndefined();
    const policy = applyEdits(POLICY, res.edits.filter((e) => e.file === POLICY_FILE));
    expect(policy).toContain("[100.01(3)] Should");
    expect(policy).toContain("[100.01(3)(a)] A nested");
    expect(policy).toContain("see Section 100.01(1) below"); // plain text untouched
    expect(applyEdits(OTHER, res.edits.filter((e) => e.file === OTHER_FILE))).toContain("[[departure-release#100.01(3)]]");
  });

  it("renames from a reference position", async () => {
    const svc = new RenameService(twoDocs(), published(undefined));
    const res = await svc.rename(OTHER_FILE, lineOf(OTHER, "Cross"), colOf(OTHER, "[[departure-release#100.01(2)]]", 20), "100.01(3)");
    expect(res.edits.length).toBe(3); // two declarations (100.2, 100.2.a) and one reference
  });

  it("prepares the rename range on the ID only", () => {
    const svc = new RenameService(twoDocs(), published(undefined));
    const p = svc.prepare(POLICY_FILE, lineOf(POLICY, "[100.01(2)] Should"), 3)!;
    expect(p.placeholder).toBe("100.01(2)");
    expect(p.range.endChar - p.range.startChar).toBe(9);
    expect(svc.prepare(POLICY_FILE, lineOf(POLICY, "[100.01(1)]"), 60)).toBeUndefined();
  });

  it("warns when the ID exists in the last published version", async () => {
    const svc = new RenameService(twoDocs(), published(["100.01", "100.01(1)", "100.01(2)"]));
    const res = await svc.rename(POLICY_FILE, lineOf(POLICY, "[100.01(2)] Should"), 2, "100.01(3)");
    expect(res.warning).toMatch(/\[100\.01\(2\)\] exists in the last published version \(v1\.0\)/);
    const fresh = await new RenameService(twoDocs(), published(["100.01"])).rename(POLICY_FILE, lineOf(POLICY, "[100.01(2)] Should"), 2, "100.01(3)");
    expect(fresh.warning).toBeUndefined();
  });

  it("rejects malformed or clashing IDs", () => {
    const idx = twoDocs();
    const target = new SymbolLocator(idx).locate(POLICY_FILE, lineOf(POLICY, "[100.01(2)] Should"), 2)!;
    const planner = new RenamePlanner(idx);
    expect(() => planner.plan(target, "100.01(x)")).toThrow(RenameError);
    expect(() => planner.plan(target, "100.01(1)")).toThrow(/already exists/);
    expect(() => planner.plan(target, "100.01(2)(a)")).toThrow(/must stay a Subsection/);
  });

  it("renames figure keys everywhere", async () => {
    const svc = new RenameService(twoDocs(), published(undefined));
    const res = await svc.rename(POLICY_FILE, lineOf(POLICY, "{#fig:rvsm"), colOf(POLICY, "{#fig:rvsm", 5), "profile");
    expect(applyEdits(POLICY, res.edits.filter((e) => e.file === POLICY_FILE))).toContain("{#fig:profile width=80%}");
    expect(applyEdits(OTHER, res.edits.filter((e) => e.file === OTHER_FILE))).toContain("[[departure-release#fig:profile]]");
    await expect(svc.rename(POLICY_FILE, lineOf(POLICY, "{#fig:rvsm"), colOf(POLICY, "{#fig:rvsm", 5), "Bad Key")).rejects.toThrow(RenameError);
  });
});

describe("structure providers", () => {
  const idx = twoDocs();

  it("builds a Part / Subpart / Section tree with figures under their provision", () => {
    const tree = new OutlineProvider(idx).provide(POLICY_FILE);
    expect(tree.map((n) => n.name)).toEqual(["[1]", "[200.01]"]);
    const part = tree[0]!;
    expect(part.children.map((n) => n.name)).toEqual(["[100]"]);
    const s100 = part.children[0]!.children[0]!;
    expect(s100.name).toBe("[100.01]");
    expect(s100.detail).toBe("ZXAA Airport");
    expect(s100.children.map((c) => c.name)).toEqual(["[100.01(1)]", "[100.01(2)]"]);
    const c102 = s100.children[1]!;
    expect(c102.children.map((c) => c.name).sort()).toEqual(["[100.01(2)(a)]", "fig:rvsm"]);
    expect(s100.range.endLine).toBeGreaterThanOrEqual(lineOf(POLICY, "[100.01(2)(a)]"));
    expect(s100.range.startLine).toBeLessThan(s100.range.endLine);
  });

  it("folds each provision over its nested provisions", () => {
    const folds = new FoldingProvider(idx).provide(POLICY_FILE);
    const s100 = folds.find((f) => f.startLine === lineOf(POLICY, "[100.01] "))!;
    expect(s100.endLine).toBe(lineOf(POLICY, "[100.01(2)(a)]"));
    expect(folds.some((f) => f.kind === "region" && f.startLine === 0)).toBe(true);
  });

  it("emits semantic tokens by depth, sorted", () => {
    const tokens = new SemanticTokensProvider(idx).provide(POLICY_FILE);
    const at = (line: number) => tokens.filter((t) => t.line === line);
    expect(at(lineOf(POLICY, "[100.01] ")).map((t) => t.type)).toEqual(["docengineSection"]);
    expect(at(lineOf(POLICY, "[100.01(1)]")).map((t) => t.type)).toEqual(["docengineSubsection"]);
    expect(at(lineOf(POLICY, "[100.01(2)(a)]"))[0]).toMatchObject({ type: "docengineParagraph", modifiers: ["declaration"] });
    const ref = at(lineOf(POLICY, "[200.01(1)]")).find((t) => t.modifiers.length === 0)!;
    expect(ref.type).toBe("docengineSubsection");
    expect(tokens.some((t) => t.type === "docengineFigure")).toBe(true);
    const sorted = [...tokens].sort((a, b) => a.line - b.line || a.startChar - b.startChar);
    expect(tokens).toEqual(sorted);
  });
});

describe("CodeActionProvider", () => {
  const FM = `---\ntitle: T\nshort: t\ngroup: g\nversion: "1.0"\neffectiveDate: 2024-01-01\n---\n\n`;
  const file = "documents/g/t.md";
  const provider = (text: string) => ({ idx: indexOf({ [file]: text }), text });

  it("inserts a missing parent", () => {
    const text = `${FM}[100.01] A\n\n[100.01(1)(a)] B\n`;
    const { idx } = provider(text);
    const row = lineOf(text, "[100.01(1)(a)]");
    const actions = new CodeActionProvider(idx).provide(file, { startLine: row, startChar: 0, endLine: row, endChar: 9 }, [
      { code: "missing-parent", severity: "error", message: "", range: { startLine: row, startChar: 0, endLine: row, endChar: 9 } },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.title).toBe("Insert missing parent [100.01(1)]");
    expect(applyEdits(text, actions[0]!.edits)).toContain("[100.01(1)] TODO\n\n[100.01(1)(a)] B");
  });

  it("fixes a sibling number, renumbering nested provisions and references", () => {
    const text = `${FM}[100.01] A\n\n[100.01(1)] B\n\n[100.01(3)] C see [[100.01(3)]]\n\n[100.01(3)(a)] D\n`;
    const { idx } = provider(text);
    const row = lineOf(text, "[100.01(3)] C");
    const diag = { code: "provision-order", severity: "error" as const, message: "", range: { startLine: row, startChar: 0, endLine: row, endChar: 7 } };
    const actions = new CodeActionProvider(idx).provide(file, diag.range, [diag]);
    expect(actions[0]!.title).toBe("Renumber Subsection 100.01(3) to [100.01(2)]");
    const fixed = applyEdits(text, actions[0]!.edits);
    expect(fixed).toContain("[100.01(2)] C see [[100.01(2)]]");
    expect(fixed).toContain("[100.01(2)(a)] D");
  });

  it("converts plain 'see Section 100.2' to a reference only for existing provisions", () => {
    const text = `${FM}[100.01] A\n\n[100.01(1)] See Section 100.01(1) and Section 100.01(9) and Section [[100.01(1)]].\n`;
    const { idx } = provider(text);
    const row = lineOf(text, "See Section");
    const provide = (c: number) => new CodeActionProvider(idx).provide(file, { startLine: row, startChar: c, endLine: row, endChar: c }, []);
    const hit = provide(text.split("\n")[row]!.indexOf("Section") + 2);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.kind).toBe("refactor.rewrite");
    expect(applyEdits(text, hit[0]!.edits)).toContain("See Section [[100.01(1)]] and Section 100.01(9)");
    expect(provide(text.split("\n")[row]!.indexOf("100.01(9)"))).toHaveLength(0);
    expect(provide(text.split("\n")[row]!.indexOf("Section [[") + 2)).toHaveLength(0);
  });
});
