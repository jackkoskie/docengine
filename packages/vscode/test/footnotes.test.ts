// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { CompletionProvider } from "../src/providers/completion.js";
import { HoverProvider } from "../src/providers/hover.js";
import { NavigationProvider } from "../src/providers/navigation.js";
import { OutlineProvider } from "../src/providers/structure.js";
import { colOf, indexOf, lineOf } from "./helpers.js";

const FILE = "documents/ops/notes.md";
const HEAD = `---\ntitle: Notes\nshort: notes\ngroup: ops\nversion: "1.0"\neffectiveDate: 2024-01-01\n---\n\n`;
const BODY = `[100.01] Heading\n\n[100.01(1)] Titled text with a note.[^a] More[^a] and another.[^2]\n\n[^a]: First note\n  continued here.\n\n[^2]: Second note.\n\n`;
const TEXT = HEAD + BODY;
const idx = () => indexOf({ [FILE]: TEXT });

describe("footnote editor support", () => {
  it("hover shows the footnote text, including continuation lines", () => {
    const h = new HoverProvider(idx(), { uriFor: (f: string) => f }, () => "Figure").provide(FILE, lineOf(TEXT, "[100.01(1)]"), colOf(TEXT, "[^a]", 2))!;
    expect(h.markdown).toContain("Footnote [^a]");
    expect(h.markdown).toContain("First note");
    expect(h.markdown).toContain("continued here.");
  });

  it("hover reports undefined footnotes", () => {
    const text = TEXT.replace("another.[^2]", "another.[^zz]");
    const h = new HoverProvider(indexOf({ [FILE]: text }), { uriFor: (f: string) => f }, () => "Figure").provide(FILE, lineOf(text, "[100.01(1)]"), colOf(text, "[^zz]", 2))!;
    expect(h.markdown).toContain("not defined");
  });

  it("goes from a reference to the definition and back to all references", () => {
    const nav = new NavigationProvider(idx());
    const [loc] = nav.definition(FILE, lineOf(TEXT, "[100.01(1)]"), colOf(TEXT, "[^a]", 2));
    expect(loc!.range.startLine).toBe(lineOf(TEXT, "[^a]: First"));
    const refs = nav.references(FILE, lineOf(TEXT, "[^a]: First"), 2, false);
    expect(refs).toHaveLength(2);
    expect(nav.references(FILE, lineOf(TEXT, "[^a]: First"), 2, true)).toHaveLength(3);
  });

  it("completes defined footnote ids after [^", () => {
    const text = TEXT.replace("[^2]\n", "[^\n");
    const i = indexOf({ [FILE]: text });
    const row = lineOf(text, "[100.01(1)]");
    const col = text.split("\n")[row]!.length;
    const items = new CompletionProvider(i, { extensionKeys: () => [] }, () => "2024-01-01").provide(FILE, row, col);
    const labels = items.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(["a", "2"]));
    expect(items.find((x) => x.label === "a")!.detail).toContain("First note");
    expect(items.find((x) => x.label === "a")!.insertText).toBe("a]");
  });

  it("lists footnotes in the outline", () => {
    const nodes = new OutlineProvider(idx()).provide(FILE);
    const notes = nodes.filter((n) => n.kind === "footnote");
    expect(notes.map((n) => n.name)).toEqual(["[^a]", "[^2]"]);
  });
});
