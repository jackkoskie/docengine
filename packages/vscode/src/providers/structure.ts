// SPDX-License-Identifier: MPL-2.0
import type { Provision } from "@jackkoskie/docengine-core";
import { ProvisionText, type IndexedDocument } from "../index/indexed-document.js";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import { type Range, range, rangeOf, subRange } from "../types.js";

export interface OutlineNode {
  name: string;
  detail: string;
  kind: "provision" | "figure" | "footnote";
  /** Provision level (1 = Part ... 8 = Subclause); 0 for figures. */
  depth: number;
  range: Range;
  selectionRange: Range;
  children: OutlineNode[];
}

/** Provision tree (Part, Subpart, Section, ...) for the outline view and breadcrumbs. */
export class OutlineProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provide(file: string): OutlineNode[] {
    const indexed = this.index.get(file);
    if (!indexed) return [];
    const ends = new SubtreeEnds(indexed);
    const roots: OutlineNode[] = [];
    const byId = new Map<string, OutlineNode>();
    for (const c of indexed.doc.provisions) {
      if (c.id.isBlank) continue;
      const node: OutlineNode = {
        name: `[${c.id}]`,
        detail: ProvisionText.summary(c, 60),
        kind: "provision",
        depth: c.depth,
        range: range(c.startLine - 1, 0, ends.endOf(c) - 1, indexed.lineText(ends.endOf(c) - 1).length),
        selectionRange: rangeOf(c.position),
        children: [],
      };
      const parent = this.nearestParent(c, byId);
      (parent ? parent.children : roots).push(node);
      if (!byId.has(c.id.text)) byId.set(c.id.text, node);
    }
    for (const f of indexed.doc.figures) {
      const owner = f.provisionId ? byId.get(f.provisionId.text) : undefined;
      const node: OutlineNode = {
        name: f.key ? `fig:${f.key}` : `Figure ${f.number}`,
        detail: f.caption,
        kind: "figure",
        depth: 0,
        range: rangeOf(f.position),
        selectionRange: f.keyPosition ? rangeOf(f.keyPosition) : rangeOf(f.position),
        children: [],
      };
      (owner ? owner.children : roots).push(node);
    }
    for (const f of indexed.doc.footnotes) {
      roots.push({
        name: `[^${f.id}]`,
        detail: ProvisionText.truncate(f.text, 60),
        kind: "footnote",
        depth: 0,
        range: range(f.position.line - 1, 0, f.endLine - 1, indexed.lineText(f.endLine - 1).length),
        selectionRange: rangeOf(f.position),
        children: [],
      });
    }
    return roots;
  }

  private nearestParent(c: Provision, byId: Map<string, OutlineNode>): OutlineNode | undefined {
    for (let p = c.id.parent; p; p = p.parent) {
      const node = byId.get(p.text);
      if (node) return node;
    }
    return undefined;
  }
}

/** Last line (1-based) of each provision including its nested provisions. */
class SubtreeEnds {
  private readonly ends = new Map<Provision, number>();

  constructor(indexed: IndexedDocument) {
    const provisions = indexed.doc.provisions;
    provisions.forEach((c, i) => {
      let end = c.endLine;
      for (let j = i + 1; j < provisions.length && provisions[j]!.id.isDescendantOf(c.id); j++) end = Math.max(end, provisions[j]!.endLine);
      this.ends.set(c, end);
    });
  }

  endOf(c: Provision): number {
    return this.ends.get(c) ?? c.endLine;
  }
}

export interface FoldDto {
  startLine: number;
  endLine: number;
  kind?: "region" | "comment";
}

/** One folding range per provision (covering nested provisions) plus the frontmatter. */
export class FoldingProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provide(file: string): FoldDto[] {
    const indexed = this.index.get(file);
    if (!indexed) return [];
    const ends = new SubtreeEnds(indexed);
    const out: FoldDto[] = [];
    const fmStart = indexed.doc.frontmatterStart;
    if (fmStart && indexed.bodyStartLine - 1 > fmStart.line - 1) {
      out.push({ startLine: fmStart.line - 1, endLine: indexed.bodyStartLine - 1, kind: "region" });
    }
    for (const c of indexed.doc.provisions) {
      const start = c.startLine - 1;
      const end = ends.endOf(c) - 1;
      if (end > start) out.push({ startLine: start, endLine: end });
    }
    return out;
  }
}

export interface SemanticTokenDto {
  line: number;
  startChar: number;
  length: number;
  type: string;
  modifiers: string[];
}

export const TOKEN_TYPES = [
  "docenginePart",
  "docengineSubpart",
  "docengineSection",
  "docengineSubsection",
  "docengineParagraph",
  "docengineSubparagraph",
  "docengineClause",
  "docengineSubclause",
  "docengineFigure",
] as const;
export const TOKEN_MODIFIERS = ["declaration"] as const;

/** Semantic highlighting of provision IDs by depth, and figure keys. */
export class SemanticTokensProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provide(file: string): SemanticTokenDto[] {
    const indexed = this.index.get(file);
    if (!indexed) return [];
    const tokens: SemanticTokenDto[] = [];
    for (const c of indexed.doc.provisions) {
      if (c.id.isBlank || !c.id.isWellFormed) continue;
      tokens.push(this.token(rangeOf(c.position), this.typeForDepth(c.depth), true));
    }
    for (const f of indexed.doc.figures) {
      if (f.keyPosition) tokens.push(this.token(rangeOf(f.keyPosition), "docengineFigure", true));
    }
    for (const r of indexed.doc.references) {
      if (r.isFigure) {
        tokens.push(this.token(subRange(r.position, r.targetOffset - 4, r.targetLength + 4), "docengineFigure", false));
      } else if (r.targetId.isWellFormed) {
        tokens.push(this.token(subRange(r.position, r.targetOffset, r.targetLength), this.typeForDepth(r.targetId.depth), false));
      }
    }
    return tokens.sort((a, b) => a.line - b.line || a.startChar - b.startChar);
  }

  /** Levels 1..8 map to Part..Subclause. */
  private typeForDepth(depth: number): string {
    return TOKEN_TYPES[Math.min(Math.max(depth, 1), 8) - 1]!;
  }

  private token(r: Range, type: string, declaration: boolean): SemanticTokenDto {
    return { line: r.startLine, startChar: r.startChar, length: r.endChar - r.startChar, type, modifiers: declaration ? ["declaration"] : [] };
  }
}
