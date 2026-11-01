// SPDX-License-Identifier: MPL-2.0
import { type NumberingScheme, ProvisionId } from "@jackkoskie/docengine-core";
import { type Range, contains, rangeOf, subRange, type Loc } from "../types.js";
import type { IndexedDocument } from "./indexed-document.js";
import type { WorkspaceIndex } from "./workspace-index.js";

export type SymbolKind = "provision" | "figure";

/** The provision ID or figure key under a position, and the document that owns it. */
export interface SymbolTarget {
  kind: SymbolKind;
  /** Provision ID text or figure key. */
  name: string;
  /** Workspace file of the document that declares it ("" when the referenced document is unknown). */
  docFile: string;
  /** Does the declaration exist? */
  resolved: boolean;
  /** Range of the name itself (what rename replaces). */
  nameRange: Range;
  /** Range of the whole token (`[[...]]`, `[id]` or `#fig:key`). */
  fullRange: Range;
  origin: "reference" | "declaration";
  /** Document name given in a cross-document reference. */
  docName?: string;
}

export interface Usage {
  file: string;
  name: string;
  nameRange: Range;
  fullRange: Range;
}

/** Finds the symbol at a cursor position. */
export class SymbolLocator {
  constructor(private readonly index: WorkspaceIndex) {}

  locate(file: string, line: number, char: number): SymbolTarget | undefined {
    const indexed = this.index.get(file);
    if (!indexed) return undefined;
    return this.locateReference(indexed, line, char) ?? this.locateProvision(indexed, line, char) ?? this.locateFigure(indexed, line, char);
  }

  private locateReference(indexed: IndexedDocument, line: number, char: number): SymbolTarget | undefined {
    for (const r of indexed.doc.references) {
      const full = rangeOf(r.position);
      if (full.startLine !== line || !contains(full, line, char)) continue;
      const target = this.index.resolve(indexed, r.doc);
      const nameOffset = r.targetOffset;
      return {
        kind: r.isFigure ? "figure" : "provision",
        name: r.target,
        docFile: target?.file ?? "",
        resolved: target !== undefined && (r.isFigure ? target.doc.findFigure(r.target) !== undefined : target.doc.hasProvision(r.target)),
        nameRange: subRange(r.position, nameOffset, r.target.length),
        fullRange: full,
        origin: "reference",
        ...(r.doc !== undefined ? { docName: r.doc } : {}),
      };
    }
    return undefined;
  }

  private locateProvision(indexed: IndexedDocument, line: number, char: number): SymbolTarget | undefined {
    for (const c of indexed.doc.provisions) {
      const full = rangeOf(c.position);
      if (full.startLine !== line || !contains(full, line, char) || c.id.isBlank) continue;
      return {
        kind: "provision",
        name: c.id.text,
        docFile: indexed.file,
        resolved: true,
        nameRange: subRange(c.position, 1, c.id.text.length),
        fullRange: full,
        origin: "declaration",
      };
    }
    return undefined;
  }

  private locateFigure(indexed: IndexedDocument, line: number, char: number): SymbolTarget | undefined {
    for (const f of indexed.doc.figures) {
      if (!f.key || !f.keyPosition) continue;
      const full = rangeOf(f.keyPosition);
      if (full.startLine !== line || !contains(full, line, char)) continue;
      return {
        kind: "figure",
        name: f.key,
        docFile: indexed.file,
        resolved: true,
        nameRange: subRange(f.keyPosition, 5, f.key.length),
        fullRange: full,
        origin: "declaration",
      };
    }
    return undefined;
  }
}

/** Finds declarations and usages of a symbol across the whole workspace. */
export class UsageFinder {
  constructor(private readonly index: WorkspaceIndex) {}

  /** Where the symbol is declared (first match), if it exists. */
  definition(target: SymbolTarget): Loc | undefined {
    const first = this.declarations(target, false)[0];
    return first ? this.toLoc(first) : undefined;
  }

  /** Declarations; with `includeDescendants`, provisions nested under the ID as well. */
  declarations(target: SymbolTarget, includeDescendants: boolean): Usage[] {
    const owner = this.index.get(target.docFile);
    if (!owner) return [];
    const out: Usage[] = [];
    if (target.kind === "figure") {
      for (const f of owner.doc.figures) {
        if (f.key !== target.name || !f.keyPosition) continue;
        out.push({ file: owner.file, name: f.key, nameRange: subRange(f.keyPosition, 5, f.key.length), fullRange: rangeOf(f.keyPosition) });
      }
      return out;
    }
    for (const c of owner.doc.provisions) {
      if (c.id.isBlank || !matchesId(c.id.text, target.name, includeDescendants, owner.doc.scheme)) continue;
      out.push({ file: owner.file, name: c.id.text, nameRange: subRange(c.position, 1, c.id.text.length), fullRange: rangeOf(c.position) });
    }
    return out;
  }

  /** `[[...]]` usages in every document that resolve to the target. */
  references(target: SymbolTarget, includeDescendants: boolean): Usage[] {
    const out: Usage[] = [];
    for (const from of this.index.all()) {
      for (const r of from.doc.references) {
        if (r.isFigure !== (target.kind === "figure")) continue;
        const scheme = this.index.get(target.docFile)?.doc.scheme ?? from.doc.scheme;
        const matches = r.isFigure ? r.target === target.name : matchesId(r.target, target.name, includeDescendants, scheme);
        if (!matches) continue;
        if (this.index.resolve(from, r.doc)?.file !== target.docFile) continue;
        out.push({
          file: from.file,
          name: r.target,
          nameRange: subRange(r.position, r.targetOffset, r.targetLength),
          fullRange: rangeOf(r.position),
        });
      }
    }
    return out;
  }

  private toLoc(u: Usage): Loc {
    return { file: u.file, range: u.fullRange };
  }
}

function matchesId(candidate: string, id: string, includeDescendants: boolean, scheme: NumberingScheme): boolean {
  return candidate === id || (includeDescendants && ProvisionId.parse(candidate, scheme).isDescendantOf(ProvisionId.parse(id, scheme)));
}
