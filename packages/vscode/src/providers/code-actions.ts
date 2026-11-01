// SPDX-License-Identifier: MPL-2.0
import { ProvisionId } from "@jackkoskie/docengine-core";
import { IndexedDocument } from "../index/indexed-document.js";
import { SymbolLocator } from "../index/symbols.js";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import { type DiagnosticDto, type Range, type TextEdit, intersects, range } from "../types.js";
import { RenameError, RenamePlanner } from "./rename.js";

export interface CodeActionDto {
  title: string;
  kind: "quickfix" | "refactor.rewrite";
  edits: TextEdit[];
  /** Code of the diagnostic this action fixes. */
  fixes?: string;
  preferred?: boolean;
}

/** One quick fix or refactoring. */
interface ActionSource {
  actions(indexed: IndexedDocument, at: Range, diagnostics: readonly DiagnosticDto[]): CodeActionDto[];
}

/** `missing-parent`: insert the absent ancestor provisions before the provision. */
class InsertMissingParent implements ActionSource {
  actions(indexed: IndexedDocument, _at: Range, diagnostics: readonly DiagnosticDto[]): CodeActionDto[] {
    return diagnostics
      .filter((d) => d.code === "missing-parent")
      .flatMap((d) => {
        const provision = indexed.doc.provisions.find((c) => c.startLine - 1 === d.range.startLine);
        if (!provision) return [];
        const missing: ProvisionId[] = [];
        for (let p = provision.id.parent; p && !indexed.doc.hasProvision(p); p = p.parent) missing.unshift(p);
        if (!missing.length) return [];
        const text = missing.map((m) => `[${m}] TODO\n\n`).join("");
        return [
          {
            title: `Insert missing parent ${missing.map((m) => `[${m}]`).join(", ")}`,
            kind: "quickfix" as const,
            fixes: "missing-parent",
            preferred: true,
            edits: [{ file: indexed.file, range: range(d.range.startLine, 0, d.range.startLine, 0), newText: text }],
          },
        ];
      });
  }
}

/** `provision-order`: renumber the provision (and its nested provisions and references) to the expected ID. */
class FixSiblingNumber implements ActionSource {
  constructor(private readonly index: WorkspaceIndex) {}

  actions(indexed: IndexedDocument, _at: Range, diagnostics: readonly DiagnosticDto[]): CodeActionDto[] {
    const locator = new SymbolLocator(this.index);
    return diagnostics
      .filter((d) => d.code === "provision-order")
      .flatMap((d) => {
        const provision = indexed.doc.provisions.find((c) => c.startLine - 1 === d.range.startLine);
        const parent = provision?.id.parent;
        if (!provision || !parent || provision.id.depth <= provision.id.scheme.topLevels) return []; // heading levels only need to ascend
        const expected = this.expectedId(indexed, provision.id);
        const target = locator.locate(indexed.file, d.range.startLine, d.range.startChar + 1);
        if (!expected || !target) return [];
        try {
          const plan = new RenamePlanner(this.index).plan(target, expected.text);
          return [{ title: `Renumber ${provision.id.display} to [${expected}]`, kind: "quickfix" as const, fixes: "provision-order", edits: plan.edits }];
        } catch (e) {
          if (e instanceof RenameError) return [];
          throw e;
        }
      });
  }

  private expectedId(indexed: IndexedDocument, id: ProvisionId): ProvisionId | null {
    const parent = id.parent;
    if (!parent) return null;
    let highest = 0;
    for (const c of indexed.doc.usableProvisions) {
      if (c.id.equals(id)) break;
      if (c.id.isChildOf(parent)) highest = Math.max(highest, c.id.ordinal ?? 0);
    }
    return parent.child(highest + 1);
  }
}

/** Plain-text "see Section 602.60(1)" becomes "see Section [[602.60(1)]]". */
class ConvertPlainReference implements ActionSource {
  actions(indexed: IndexedDocument, at: Range): CodeActionDto[] {
    const out: CodeActionDto[] = [];
    const scheme = indexed.doc.scheme;
    const labels = scheme.levels.map((l) => l.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    for (let line = at.startLine; line <= Math.min(at.endLine, indexed.lines.length - 1); line++) {
      const text = indexed.lineText(line);
      const re = new RegExp(`\\b(?:${labels})s?\\s+(${scheme.idPattern})`, "gi");
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const id = m[1]!;
        const idStart = m.index + m[0].length - id.length;
        if (!indexed.doc.hasProvision(id) || this.insideBrackets(text, idStart, id.length)) continue;
        const idRange = range(line, idStart, line, idStart + id.length);
        if (!intersects(range(line, m.index, line, m.index + m[0].length), at)) continue;
        out.push({
          title: `Convert "${m[0]}" to a [[${id}]] reference`,
          kind: "refactor.rewrite",
          edits: [{ file: indexed.file, range: idRange, newText: `[[${id}]]` }],
        });
      }
    }
    return out;
  }

  private insideBrackets(text: string, start: number, length: number): boolean {
    return text.slice(0, start).endsWith("[") || text.slice(start + length).startsWith("]") || this.inCode(text, start);
  }

  private inCode(text: string, at: number): boolean {
    return (text.slice(0, at).match(/`/g)?.length ?? 0) % 2 === 1;
  }
}

/** Collects quick fixes and refactorings for a range. */
export class CodeActionProvider {
  private readonly sources: ActionSource[];

  constructor(private readonly index: WorkspaceIndex) {
    this.sources = [new InsertMissingParent(), new FixSiblingNumber(index), new ConvertPlainReference()];
  }

  provide(file: string, at: Range, diagnostics: readonly DiagnosticDto[]): CodeActionDto[] {
    const indexed = this.index.get(file);
    if (!indexed) return [];
    return this.sources.flatMap((s) => s.actions(indexed, at, diagnostics));
  }
}
