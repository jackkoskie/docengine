// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  DocVersion,
  DocumentScaffold,
  Formatter,
  Renumberer,
  VersionBumper,
  Validator,
  parse,
  loadConfig,
  FakeGitClient,
  FakeHasher,
  MarkdownParser,
  InMemoryHost,
  GitHistoryProvider,
  ChangeDetector,
  ReleaseTags,
  DocumentDiff,
  DocumentSnapshot,
  MarkdownDiffRenderer,
  TextDiffRenderer,
  JsonDiffRenderer,
  ReleaseNotesBuilder,
  ChangeSummary,
  TypstGenerator,
  findRemovedProvisionIds,
  type DocumentDiffEntry,
  type Host,
} from "../src/index.js";
import { doc } from "./helpers.js";

const fm = (body: string, extra: Record<string, string> = {}) => doc(body, extra);

describe("DocVersion and ReleaseTags", () => {
  it("parses, compares and bumps", () => {
    const v = DocVersion.parse("1.9")!;
    expect(v.bump("minor").text).toBe("1.10");
    expect(v.bump("major").text).toBe("2.0");
    expect(DocVersion.parse("1.10")!.compare(v)).toBeGreaterThan(0);
    expect(DocVersion.parse("1")).toBeNull();
  });

  it("finds the highest tag numerically, not lexically", () => {
    const git = new FakeGitClient("x", { tags: ["ops/p/v1.2", "ops/p/v1.10", "ops/other/v9.0", "ops/p/vbad"] });
    expect(new ReleaseTags(git).latest("/", "ops", "p")?.name).toBe("ops/p/v1.10");
    expect(new ReleaseTags(git).latest("/", "ops", "none")).toBeNull();
    expect(ReleaseTags.tagName("ops", "p", "2.0")).toBe("ops/p/v2.0");
  });
});

describe("Formatter: blank [] IDs", () => {
  const fmt = (body: string) => new Formatter().format(body);

  it("fills Sections, then nests by indentation", () => {
    const r = fmt(["[602] # Subpart", "", "[] First", "", "  [] a provision", "", "    [] sub", "", "    [] sub two", "", "  [] another", "", "[] Second", "", "  [] x"].join("\n"));
    expect(r.problems).toEqual([]);
    expect(r.text.split("\n").filter((l) => l.startsWith("["))).toEqual([
      "[602] # Subpart",
      "[602.01] First",
      "[602.01(1)] a provision",
      "[602.01(1)(a)] sub",
      "[602.01(1)(b)] sub two",
      "[602.01(2)] another",
      "[602.02] Second",
      "[602.02(1)] x",
    ]);
  });

  it("continues after existing IDs and never touches them", () => {
    const src = "[100.01] S\n\n[100.01(1)] a\n\n[100.01(2)] b\n\n  [] c\n\n    [] d\n\n[200.01] kept\n";
    const r = fmt(src);
    expect(r.problems).toEqual([]);
    expect(r.text).toBe("[100.01] S\n\n[100.01(1)] a\n\n[100.01(2)] b\n\n[100.01(3)] c\n\n[100.01(3)(a)] d\n\n[200.01] kept\n");
  });

  it("refuses a fill that would collide with an ID further down", () => {
    const r = fmt("[100.01] S\n\n[100.01(1)] a\n\n  [] inserted\n\n[100.01(2)] later\n");
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]!.message).toContain("renumber");
    expect(r.text).toContain("[] inserted");
    expect(r.text).toContain("[100.01(2)] later");
  });

  it("reports an indent that skips a level", () => {
    const r = fmt("[100.01] S\n\n  [] ok\n\n      [] too deep\n");
    expect(r.problems[0]!.message).toContain("Subparagraph level but there is no Paragraph");
  });

  it("continues Sections after the last one, and from a freshly declared Subpart", () => {
    const r = fmt("[602.09] a\n\n[] b\n\n[602.99] c\n\n[] d\n\n[603] # next Subpart\n\n[] e\n");
    expect(r.problems).toEqual([]);
    expect(r.text.split("\n").filter((l) => l.startsWith("[")).map((l) => l.split("]")[0] + "]")).toEqual(["[602.09]", "[602.10]", "[602.99]", "[602.100]", "[603]", "[603.01]"]);
  });

  it("needs something to continue from, and stops at the Subclause level", () => {
    expect(fmt("[] first\n").problems[0]!.message).toContain("Subpart");
    const deep = fmt("[602.01] a\n\n  [] 1\n\n    [] a\n\n      [] i\n\n        [] A\n\n          [] I\n\n            [] too deep\n");
    expect(deep.text).toContain("[602.01(1)(a)(i)(A)(I)] I");
    expect(deep.problems[0]!.message).toContain("nesting stops at Subclause");
  });

  it("uses 4-space indentation when that is the file's style", () => {
    const r = fmt("[100.01] S\n\n    [] a\n\n        [] b\n");
    expect(r.text).toContain("[100.01(1)] a");
    expect(r.text).toContain("[100.01(1)(a)] b");
  });

  it("is idempotent and ignores fenced code", () => {
    const src = "[100.01] S\n\n[100.01(1)] a\n\n```\n[] not a provision\n```\n";
    const once = fmt(src);
    expect(once.text).toBe(src);
    expect(once.changes).toEqual([]);
  });

  it("produces a document that parses cleanly", () => {
    const r = new Formatter().format(fm("[602] # Sub\n\n[] Title\n\n  [] one\n\n  [] two"));
    const d = parse(r.text, { file: "documents/g/t.md" });
    expect(d.provisions.map((c) => c.id.text)).toEqual(["602", "602.01", "602.01(1)", "602.01(2)"]);
  });

  it("preserves CRLF line endings", () => {
    expect(fmt("[602.01] A\r\n\r\n  [] b\r\n").text).toBe("[602.01] A\r\n\r\n[602.01(1)] b\r\n");
  });
});

describe("Formatter: figures and tombstones", () => {
  it("normalizes figure attribute blocks", () => {
    const r = new Formatter().format("[100.01] S\n\n![c](a.svg){ align=center   width=80%  #fig:x }\n\n![d](b.png){}\n");
    expect(r.text).toContain("![c](a.svg){#fig:x width=80% align=center}");
    expect(r.text).toContain("![d](b.png)\n");
    expect(r.changes.filter((c) => c.kind === "figure-attributes")).toHaveLength(2);
  });

  it("normalizes tombstone case", () => {
    expect(new Formatter().format("[100.01] S\n\n[100.01(1)] [Repealed] gone\n").text).toContain("[100.01(1)] [repealed] gone");
  });

  it("restores tombstones for removed published IDs in order", () => {
    const r = new Formatter().format("[100.01] S\n\n[100.01(1)] a\n\n[100.01(4)] d\n", { restoreTombstones: ["100.01", "100.01(1)", "100.01(2)", "100.01(3)", "100.01(4)"] });
    const ids = r.text.split("\n").filter((l) => l.startsWith("["));
    expect(ids).toEqual(["[100.01] S", "[100.01(1)] a", "[100.01(2)] [repealed]", "[100.01(3)] [repealed]", "[100.01(4)] d"]);
    expect(r.changes.filter((c) => c.kind === "restore-tombstone")).toHaveLength(2);
    expect(new Formatter().format(r.text, { restoreTombstones: ["100.01(2)", "100.01(3)"] }).changes).toEqual([]);
  });

  it("appends tombstones for removed trailing provisions", () => {
    const r = new Formatter().format("[100.01] S\n\n[100.01(1)] a\n", { restoreTombstones: ["100.01(2)"] });
    expect(r.text).toBe("[100.01] S\n\n[100.01(1)] a\n\n[100.01(2)] [repealed]\n");
  });
});

describe("Renumberer", () => {
  const A = fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(2)] two [[100.01(1)]] and [[100.01(2)(a)]]\n\n[100.01(2)(a)] sub\n\n[100.01(3)] see [[other#100.01(2)]] [[fig:f]]");
  const B = "---\ntitle: O\nshort: other\ngroup: g\nversion: \"1.0\"\neffectiveDate: 2024-01-15\n---\n\n[100.01] S\n\n[100.01(1)] see [[t#100.01(2)(a)]] and [[g/t#100.01(2)]] and own [[100.01(2)]]\n\n[100.01(2)] x\n";
  const sources = [
    { file: "documents/g/t.md", source: A, doc: parse(A, { file: "documents/g/t.md" }) },
    { file: "documents/g/other.md", source: B, doc: parse(B, { file: "documents/g/other.md" }) },
  ];

  it("moves provision, descendants and every reference repo-wide, and logs it", () => {
    const plan = new Renumberer().plan(sources, "documents/g/t.md", [{ from: "100.01(2)", to: "100.01(4)" }]);
    expect(plan.problems).toEqual([]);
    const t = plan.edits.find((e) => e.file === "documents/g/t.md")!.text;
    expect(t).toContain("[100.01(4)] two [[100.01(1)]] and [[100.01(4)(a)]]");
    expect(t).toContain("[100.01(4)(a)] sub");
    expect(t).toContain("[[other#100.01(2)]]"); // refers to the other document: untouched
    const o = plan.edits.find((e) => e.file === "documents/g/other.md")!.text;
    expect(o).toContain("[[t#100.01(4)(a)]] and [[g/t#100.01(4)]] and own [[100.01(2)]]");
    expect(plan.changes.map((c) => `${c.kind}:${c.from}>${c.to}`)).toEqual(
      expect.arrayContaining(["provision:100.01(2)>100.01(4)", "provision:100.01(2)(a)>100.01(4)(a)", "reference:100.01(2)(a)>100.01(4)(a)", "reference:100.01(2)>100.01(4)"]),
    );
  });

  it("optionally leaves tombstones", () => {
    const plan = new Renumberer().plan(sources, "documents/g/t.md", [{ from: "100.01(1)", to: "100.01(5)" }], { tombstone: true });
    const t = plan.edits.find((e) => e.file === "documents/g/t.md")!.text;
    expect(t).toContain("[100.01(1)] [repealed] Renumbered to [[100.01(5)]]\n\n[100.01(5)] one");
  });

  it("refuses collisions, missing sources and bad targets", () => {
    const p = (from: string, to: string) => new Renumberer().plan(sources, "documents/g/t.md", [{ from, to }]).problems;
    expect(p("100.01(1)", "100.01(2)").join()).toContain("duplicate");
    expect(p("100.01(9)", "100.01(8)").join()).toContain("does not exist");
    expect(p("100.01(1)", "100.01(x)(y)").length).toBeGreaterThan(0);
    expect(p("100.01(1)", "100.01(2)(a)").join()).toContain("different depths");
  });

  it("renumbers a Section with all its subsections and the references to them, and a Subpart with its Sections", () => {
    const src = fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(1)(a)] sub\n\n[100.02] see [[100.01(1)(a)]] and [[100.01]]");
    const doc = parse(src, { file: "documents/g/t.md" });
    const one = [{ file: "documents/g/t.md", source: src, doc }];
    const plan = new Renumberer().plan(one, "documents/g/t.md", [{ from: "100.01", to: "100.05" }]);
    expect(plan.problems).toEqual([]);
    const t = plan.edits[0]!.text;
    expect(t).toContain("[100.05] S");
    expect(t).toContain("[100.05(1)] one");
    expect(t).toContain("[100.05(1)(a)] sub");
    expect(t).toContain("see [[100.05(1)(a)]] and [[100.05]]");
    const sub = new Renumberer().plan(one, "documents/g/t.md", [{ from: "100", to: "300" }]);
    expect(sub.problems.join()).toContain("does not exist"); // an undeclared Subpart has no provision to move
    const declared = fm("[100] # Sub\n\n[100.01] S\n\n[100.01(1)] a\n\n[100.02] b [[100.01(1)]]");
    const dd = [{ file: "documents/g/t.md", source: declared, doc: parse(declared, { file: "documents/g/t.md" }) }];
    const moved = new Renumberer().plan(dd, "documents/g/t.md", [{ from: "100", to: "300" }]);
    expect(moved.problems).toEqual([]);
    const m = moved.edits[0]!.text;
    expect(m).toContain("[300] # Sub");
    expect(m).toContain("[300.01(1)] a");
    expect(m).toContain("b [[300.01(1)]]");
  });

  it("can swap two IDs", () => {
    const plan = new Renumberer().plan(sources, "documents/g/t.md", [
      { from: "100.01(1)", to: "100.01(2)" },
      { from: "100.01(2)", to: "100.01(1)" },
    ]);
    expect(plan.problems).toEqual([]);
    expect(plan.edits.find((e) => e.file === "documents/g/t.md")!.text).toContain("[100.01(2)] one");
  });
});

describe("VersionBumper and DocumentScaffold", () => {
  it("bumps version and effectiveDate, keeping quotes and everything else", () => {
    const src = fm("[100.01] S\n\n[100.01(1)] a");
    const d = parse(src, { file: "documents/g/t.md" });
    const r = new VersionBumper().bump(src, d, "minor", "2025-02-02");
    expect(r.text).toContain('version: "1.1"');
    expect(r.text).toContain("effectiveDate: 2025-02-02");
    expect(r.text.replace('"1.1"', '"1.0"').replace("2025-02-02", "2024-01-15")).toBe(src);
    expect(new VersionBumper().bump(src, d, "major", "2025-02-02").to).toBe("2.0");
  });

  it("scaffolds a document that validates cleanly with the modeline", () => {
    const text = new DocumentScaffold().create({
      group: "ops",
      short: "departure-release",
      effectiveDate: "2025-01-01",
      schema: "../../schema/frontmatter.schema.json",
      extensionKeys: ["required"],
    });
    expect(text.split("\n")[1]).toBe("# yaml-language-server: $schema=../../schema/frontmatter.schema.json");
    expect(text).toContain('title: "Departure Release"');
    const d = parse(text, { file: "documents/ops/departure-release.md" });
    const diags = Validator.standard().validate(d, { config: loadConfig({}) });
    expect(diags.filter((x) => x.isError)).toEqual([]);
    expect(DocumentScaffold.validate("Bad Group", "ok")).toHaveLength(1);
  });
});

// ---- git-aware ----

const FILE = "documents/g/t.md";
const BASE_DOC = fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(2)] two\n\n![Pic](images/p.svg){#fig:p}");

function history(opts: { files?: Record<string, string>; base?: string | null; tags?: Record<string, string>; images?: Record<string, string> } = {}) {
  const git = new FakeGitClient("head");
  git.setRef("main", { [FILE]: BASE_DOC, "documents/g/images/p.svg": "<svg a/>" });
  for (const [tag, text] of Object.entries(opts.tags ?? {})) git.addTag(tag, { [FILE]: text, "documents/g/images/p.svg": "<svg a/>" });
  const hasher = new FakeHasher();
  const host: Host = new InMemoryHost({});
  const hostWith = (img: string): Host => ({
    inspectFile: (p) => (p === "documents/g/images/p.svg" ? { size: 1, sha256: hasher.sha256(img) } : undefined),
  });
  const make = (current: string, image = "<svg a/>") => {
    const d = parse(current, { file: FILE });
    const provider = new GitHistoryProvider(git, new MarkdownParser(), hasher, hostWith(image), "/", opts.base === undefined ? "main" : opts.base);
    return { d, provider, git, host };
  };
  return make;
}

const codesOf = (current: string, make: ReturnType<typeof history>, image?: string) => {
  const { d, provider } = make(current, image);
  return Validator.standard().validate(d, { config: loadConfig({}), history: provider, file: FILE });
};

describe("version-bump rule", () => {
  const make = history();

  it("errors when the body changed but version did not", () => {
    const diags = codesOf(BASE_DOC.replace("one", "ONE changed"), make);
    const e = diags.find((x) => x.code === "version-not-bumped")!;
    expect(e.severity).toBe("error");
    expect(e.position.line).toBe(5); // the version line
    expect(e.message).toContain("docengine bump");
  });

  it("passes when the version was bumped, or nothing changed, or whitespace only", () => {
    expect(codesOf(BASE_DOC.replace("one", "ONE").replace('"1.0"', '"1.1"'), make).map((d) => d.code)).not.toContain("version-not-bumped");
    expect(codesOf(BASE_DOC, make).map((d) => d.code)).not.toContain("version-not-bumped");
    expect(codesOf(BASE_DOC.replace("[100.01(1)] one", "[100.01(1)]    one   "), make).map((d) => d.code)).not.toContain("version-not-bumped");
  });

  it("errors when only an image hash changed", () => {
    const diags = codesOf(BASE_DOC, make, "<svg b/>");
    expect(diags.map((d) => d.code)).toContain("version-not-bumped");
  });

  it("honours version-note: editorial", () => {
    const diags = codesOf(fm("[100.01] S\n\n[100.01(1)] one!\n\n[100.01(2)] two\n\n![Pic](images/p.svg){#fig:p}", { "version-note": "editorial" }), make);
    expect(diags.map((d) => d.code)).not.toContain("version-not-bumped");
  });

  it("skips documents that are new at the base ref", () => {
    const m = history({ base: "main" });
    const { d, provider } = m(fm("[100.01] S\n\n[100.01(1)] x", { short: "brand-new" }));
    const diags = Validator.standard().validate(d, { config: loadConfig({}), history: provider, file: "documents/g/brand-new.md" });
    expect(diags.map((x) => x.code)).not.toContain("version-not-bumped");
  });

  it("does nothing without history", () => {
    const d = parse(BASE_DOC, { file: FILE });
    expect(Validator.standard().validate(d, { config: loadConfig({}), file: FILE }).map((x) => x.code)).not.toContain("version-not-bumped");
  });

  it("falls back to the last tag when no base ref is given", () => {
    const m = history({ base: null, tags: { "g/t/v1.0": BASE_DOC } });
    expect(codesOf(BASE_DOC.replace("one", "changed"), m).map((d) => d.code)).toContain("version-not-bumped");
  });
});

describe("removed IDs and version-after-tag rules", () => {
  it("warns about provision IDs and figure keys that disappeared (via findRemovedProvisionIds)", () => {
    const make = history();
    const diags = codesOf(fm("[100.01] S\n\n[100.01(1)] one").replace('"1.0"', '"1.1"'), make);
    const removed = diags.filter((d) => d.code === "removed-provision-id");
    expect(removed.map((d) => d.message)).toEqual([expect.stringContaining("[100.01(2)]")]);
    expect(removed[0]!.severity).toBe("warning");
    expect(removed[0]!.file).toBe(FILE);
    expect(diags.find((d) => d.code === "removed-figure-key")?.message).toContain("fig:p");
  });

  it("a tombstone satisfies the persistent-ID check", () => {
    const make = history();
    const diags = codesOf(fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(2)] [repealed]\n\n![Pic](images/p.svg){#fig:p}").replace('"1.0"', '"1.1"'), make);
    expect(diags.map((d) => d.code)).not.toContain("removed-provision-id");
  });

  it("compares against the last tag when there is one", () => {
    const make = history({ base: null, tags: { "g/t/v1.0": fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(9)] ninth") } });
    expect(codesOf(fm("[100.01] S\n\n[100.01(1)] one").replace('"1.0"', '"1.1"'), make).map((d) => d.message).join()).toContain("[100.01(9)]");
  });

  it("errors when the version is below the last tag, not when equal", () => {
    const make = history({ base: null, tags: { "g/t/v2.0": BASE_DOC, "g/t/v1.5": BASE_DOC } });
    const low = codesOf(BASE_DOC, make).find((d) => d.code === "version-below-tag")!;
    expect(low.message).toContain("g/t/v2.0");
    expect(codesOf(BASE_DOC.replace('"1.0"', '"2.0"'), make).map((d) => d.code)).not.toContain("version-below-tag");
  });

  it("findRemovedProvisionIds still works standalone", () => {
    expect(findRemovedProvisionIds(["100.01", "100.01(7)"], parse(BASE_DOC)).map((d) => d.code)).toEqual(["removed-provision-id"]);
  });
});

describe("DocumentDiff", () => {
  const hasher = new FakeHasher();
  const snap = (src: string, imgs: Record<string, string> = {}) =>
    new DocumentSnapshot(parse(src, { file: FILE }), "ref", (p) => (imgs[p] === undefined ? undefined : hasher.sha256(imgs[p]!)));
  const IMG = "documents/g/images/p.svg";

  it("reports added, changed, removed and moved provisions", () => {
    const before = snap(fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(2)] two\n\n[100.01(3)] three\n\n[100.01(4)] four"));
    const after = snap(fm("[100.01] S\n\n[100.01(1)] ONE\n\n[100.01(2)] two\n\n[100.01(5)] three\n\n[100.01(6)] brand new"));
    const d = DocumentDiff.compare(before, after).toJSON().provisions;
    expect(d.changed.map((c) => c.id)).toEqual(["100.01(1)"]);
    expect(d.moved).toEqual([{ from: "100.01(3)", to: "100.01(5)", excerpt: "three" }]);
    expect(d.added.map((c) => c.id)).toEqual(["100.01(6)"]);
    expect(d.removed.map((c) => c.id)).toEqual(["100.01(4)"]);
  });

  it("reports a newly repealed provision as repealed, not as removed or changed", () => {
    const before = snap(fm("[602.60] # S\n\n[602.60(1)] one\n\n[602.60(2)] two\n\n[602.60(3)] three"));
    const after = snap(fm("[602.60] # S\n\n[602.60(1)] one\n\n[602.60(2)] [repealed] No longer needed\n\n[602.60(3)] THREE"));
    const diff = DocumentDiff.compare(before, after);
    const d = diff.toJSON().provisions;
    expect(d.repealed.map((c) => c.id)).toEqual(["602.60(2)"]);
    expect(d.changed.map((c) => c.id)).toEqual(["602.60(3)"]);
    expect(d.removed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(diff.contentChanged).toBe(true);
    // a tombstone whose note is edited later is a plain change; a reinstated provision is a change too
    const edited = DocumentDiff.compare(after, snap(fm("[602.60] # S\n\n[602.60(1)] one\n\n[602.60(2)] [repealed] Other note\n\n[602.60(3)] THREE"))).toJSON().provisions;
    expect(edited.changed.map((c) => c.id)).toEqual(["602.60(2)"]);
    expect(edited.repealed).toEqual([]);
    expect(DocumentDiff.compare(after, before).toJSON().provisions.changed.map((c) => c.id)).toContain("602.60(2)");
    // deleting without a tombstone is still a removal
    const gone = snap(fm("[602.60] # S\n\n[602.60(1)] one\n\n[602.60(3)] three"));
    expect(DocumentDiff.compare(before, gone).toJSON().provisions.removed.map((c) => c.id)).toEqual(["602.60(2)"]);
  });

  it("renders a repealed provision in every report format", () => {
    const diff = DocumentDiff.compare(
      snap(fm("[602.60] # S\n\n[602.60(1)] one\n\n[602.60(2)] two")),
      snap(fm("[602.60] # S\n\n[602.60(1)] one\n\n[602.60(2)] [repealed] No longer needed")),
    );
    const entry: DocumentDiffEntry = { group: "g", short: "t", title: "T", file: FILE, draft: false, version: { from: "1.0", to: "1.1" }, against: "g/t/v1.0", isNew: false, diff };
    const report = { base: null, documents: [entry] };
    expect(new TextDiffRenderer().render(report)).toContain("  x Subsection 602.60(2) repealed No longer needed");
    expect(new MarkdownDiffRenderer().render(report)).toContain("- Repealed Subsection 602.60(2) No longer needed");
    expect(new MarkdownDiffRenderer().render(report)).not.toContain("Removed");
    expect(JSON.parse(new JsonDiffRenderer().render(report)).documents[0].provisions.repealed[0].id).toBe("602.60(2)");
    const notes = new ReleaseNotesBuilder().render(entry);
    expect(notes).toContain("Repealed Subsection 602.60(2)");
    expect(notes).not.toContain("Removed");
    expect(ChangeSummary.from(diff, "1.0").items).toEqual(["Repealed Subsection 602.60(2): No longer needed"]);
  });

  it("reports figures: added, changed hash, removed, renumbered", () => {
    const a = fm("[100.01] S\n\n[100.01(1)] x\n\n![A](a.svg){#fig:a}\n\n![B](b.svg){#fig:b}\n\n![C](c.svg){#fig:c}");
    const b = fm("[100.01] S\n\n[100.01(1)] x\n\n![B](b.svg){#fig:b}\n\n![C](c.svg){#fig:c}\n\n![D](d.svg){#fig:d}");
    const f = DocumentDiff.compare(
      snap(a, { "documents/g/a.svg": "1", "documents/g/b.svg": "1", "documents/g/c.svg": "1" }),
      snap(b, { "documents/g/b.svg": "1", "documents/g/c.svg": "CHANGED", "documents/g/d.svg": "1" }),
    ).toJSON().figures;
    expect(f.removed.map((x) => x.key)).toEqual(["a"]);
    expect(f.added.map((x) => x.key)).toEqual(["d"]);
    expect(f.changed.map((x) => [x.key, x.reason])).toEqual([["c", "image"]]);
    expect(f.changed[0]!.before).not.toBe(f.changed[0]!.after);
    expect(f.renumbered).toEqual([
      { key: "b", from: 2, to: 1 },
    ]);
  });

  it("treats a changed image as a content change and a new document as all-added", () => {
    const src = fm(`[100.01] S\n\n[100.01(1)] x\n\n![P](images/p.svg){#fig:p}`);
    expect(DocumentDiff.compare(snap(src, { [IMG]: "1" }), snap(src, { [IMG]: "2" })).contentChanged).toBe(true);
    expect(DocumentDiff.compare(snap(src, { [IMG]: "1" }), snap(src, { [IMG]: "1" })).isEmpty).toBe(true);
    const fresh = DocumentDiff.compare(null, snap(src, { [IMG]: "1" }));
    expect(fresh.addedProvisions.map((c) => c.id)).toEqual(["100.01", "100.01(1)"]);
    expect(fresh.addedFigures).toHaveLength(1);
  });

  it("renders text, markdown, json and release notes", () => {
    const diff = DocumentDiff.compare(snap(fm("[100.01] S\n\n[100.01(1)] one")), snap(fm("[100.01] S\n\n[100.01(1)] ONE\n\n[100.01(2)] two")));
    const entry: DocumentDiffEntry = {
      group: "g",
      short: "t",
      title: "T",
      file: FILE,
      draft: false,
      version: { from: "1.0", to: "1.1" },
      against: "g/t/v1.0",
      isNew: false,
      diff,
    };
    const report = { base: "main", documents: [entry] };
    expect(new TextDiffRenderer().render(report)).toContain("  ~ Subsection 100.01(1) ONE");
    const md = new MarkdownDiffRenderer().render(report);
    expect(md).toContain("## T (`g/t`, v1.0 -> v1.1)");
    expect(md).toContain("- Added Subsection 100.01(2) two");
    expect(md).toContain("- Changed Subsection 100.01(1) ONE");
    const json = JSON.parse(new JsonDiffRenderer().render(report));
    expect(json.documents[0]).toMatchObject({ key: "g/t", version: { from: "1.0", to: "1.1" } });
    expect(json.documents[0].provisions.added[0].id).toBe("100.01(2)");
    const notes = new ReleaseNotesBuilder().render(entry);
    expect(notes).toContain("# T v1.1");
    expect(notes).toContain("Changes since g/t/v1.0.");
    expect(notes).toContain("Pull request: {{PR_URL}}");
    expect(new ReleaseNotesBuilder().render({ ...entry, isNew: true, against: null })).toContain("Initial release.");
    expect(new MarkdownDiffRenderer().render({ base: null, documents: [] })).toContain("No document changes");
  });

  it("generates the optional summary page only when asked", () => {
    const diff = DocumentDiff.compare(snap(fm("[100.01] S\n\n[100.01(1)] one")), snap(fm("[100.01] S\n\n[100.01(1)] one\n\n[100.01(2)] new [x]")));
    const d = parse(fm("[100.01] S\n\n[100.01(1)] one"));
    const gen = (summary?: ChangeSummary) =>
      new TypstGenerator(loadConfig({}), { templateImport: "/t.typ", ...(summary ? { changeSummary: summary } : {}) }).generate(d);
    expect(gen()).not.toContain("Summary of changes");
    const typ = gen(ChangeSummary.from(diff, "1.0"));
    expect(typ).toContain("#pagebreak()");
    expect(typ).toContain("Summary of changes");
    expect(typ).toContain("Changes since version 1.0.");
    expect(typ).toContain("Added");
    expect(gen(ChangeSummary.from(DocumentDiff.compare(snap(fm("[100.01] S")), snap(fm("[100.01] S"))), "1.0"))).not.toContain("Summary of changes");
    expect(loadConfig({}).summaryOfChanges).toBe(false);
    expect(loadConfig({ summaryOfChanges: true }).summaryOfChanges).toBe(true);
    expect(() => loadConfig({ summaryOfChanges: "yes" })).toThrow();
  });
});

describe("ChangeDetector", () => {
  const make = (opts: Parameters<typeof history>[0], current = BASE_DOC) => {
    const { d, provider } = history(opts)(current);
    return { d, h: provider.of({ file: FILE, doc: d }) };
  };

  it("uses the last tag first: changed when the version differs from it", () => {
    const a = make({ base: "main", tags: { "g/t/v1.0": BASE_DOC } });
    expect(new ChangeDetector().isChanged(a.h, a.d)).toBe(false);
    const b = make({ base: "main", tags: { "g/t/v0.9": BASE_DOC } });
    expect(new ChangeDetector().isChanged(b.h, b.d)).toBe(true);
    expect(new ChangeDetector().previousVersion(b.h)).toBe("0.9");
  });

  it("falls back to the base ref without a tag, and treats new documents as changed", () => {
    const same = make({ base: "main" });
    expect(new ChangeDetector().isChanged(same.h, same.d)).toBe(false);
    const bumped = make({ base: "main" }, BASE_DOC.replace('"1.0"', '"1.1"'));
    expect(new ChangeDetector().isChanged(bumped.h, bumped.d)).toBe(true);
    const missing = history({ base: "main" })(fm("[100.01] S\n\n[100.01(1)] z", { short: "new-one" }));
    expect(new ChangeDetector().isChanged(missing.provider.of({ file: "documents/g/new-one.md", doc: missing.d }), missing.d)).toBe(true);
  });

  it("base-only mode ignores tags", () => {
    const a = make({ base: "main", tags: { "g/t/v0.1": BASE_DOC } });
    expect(new ChangeDetector(true).isChanged(a.h, a.d)).toBe(false);
  });
});
