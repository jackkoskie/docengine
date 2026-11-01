// SPDX-License-Identifier: MPL-2.0
import { FootnoteLocator } from "../index/footnotes.js";
import { SymbolLocator, UsageFinder } from "../index/symbols.js";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import type { Loc } from "../types.js";

/** Go-to-definition and find-all-references for provision IDs, figure keys and footnotes. */
export class NavigationProvider {
  private readonly locator: SymbolLocator;
  private readonly finder: UsageFinder;
  private readonly footnotes = new FootnoteLocator();

  constructor(private readonly index: WorkspaceIndex) {
    this.locator = new SymbolLocator(index);
    this.finder = new UsageFinder(index);
  }

  definition(file: string, line: number, char: number): Loc[] {
    const note = this.footnoteDefinition(file, line, char);
    if (note) return note;
    const target = this.locator.locate(file, line, char);
    if (!target || !target.resolved) return [];
    return this.finder.declarations(target, false).map((u) => ({ file: u.file, range: u.fullRange }));
  }

  references(file: string, line: number, char: number, includeDeclaration: boolean): Loc[] {
    const noteRefs = this.footnoteReferences(file, line, char, includeDeclaration);
    if (noteRefs) return noteRefs;
    const target = this.locator.locate(file, line, char);
    if (!target || !target.resolved) return [];
    const usages = [
      ...(includeDeclaration ? this.finder.declarations(target, false) : []),
      ...this.finder.references(target, false),
    ];
    return usages.map((u) => ({ file: u.file, range: u.fullRange }));
  }

  /** From a `[^id]` reference (or its definition) to the definition. Undefined when the cursor is not on a footnote. */
  private footnoteDefinition(file: string, line: number, char: number): Loc[] | undefined {
    const indexed = this.index.get(file);
    const target = indexed && this.footnotes.locate(indexed, line, char);
    if (!indexed || !target) return undefined;
    const def = this.footnotes.definition(indexed, target.id);
    return def ? [{ file, range: this.footnotes.labelRange(def) }] : [];
  }

  private footnoteReferences(file: string, line: number, char: number, includeDeclaration: boolean): Loc[] | undefined {
    const indexed = this.index.get(file);
    const target = indexed && this.footnotes.locate(indexed, line, char);
    if (!indexed || !target) return undefined;
    const def = this.footnotes.definition(indexed, target.id);
    return [
      ...(includeDeclaration && def ? [{ file, range: this.footnotes.labelRange(def) }] : []),
      ...this.footnotes.references(indexed, target.id).map((range) => ({ file, range })),
    ];
  }
}
