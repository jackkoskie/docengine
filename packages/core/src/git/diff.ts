// SPDX-License-Identifier: MPL-2.0
import { CARS } from "../model/numbering/presets.js";
import type { NumberingScheme } from "../model/numbering/scheme.js";
import type { Provision } from "../model/provision.js";
import type { Figure } from "../model/figure.js";
import { ProvisionContent, type DocumentSnapshot } from "./snapshot.js";

export interface ProvisionRef {
  id: string;
  /** Short plain-text excerpt. */
  excerpt: string;
}

export interface MovedProvision {
  from: string;
  to: string;
  excerpt: string;
}

export interface FigureChange {
  key: string | null;
  path: string;
  caption: string;
  number: number;
  /** Hash before / after (null when the file is absent or the figure is new/removed). */
  before: string | null;
  after: string | null;
  /** For "changed": what differed. */
  reason?: "image" | "caption" | "attributes";
}

export interface RenumberedFigure {
  key: string;
  from: number;
  to: number;
}

export interface DocumentDiffDto {
  provisions: { added: ProvisionRef[]; changed: ProvisionRef[]; repealed: ProvisionRef[]; removed: ProvisionRef[]; moved: MovedProvision[] };
  figures: { added: FigureChange[]; changed: FigureChange[]; removed: FigureChange[]; renumbered: RenumberedFigure[] };
}

const figureId = (f: Figure): string => (f.key !== undefined ? `fig:${f.key}` : `path:${f.path}`);

/** Provision-level and figure-level difference between two snapshots of one document. */
export class DocumentDiff {
  private constructor(
    readonly addedProvisions: readonly ProvisionRef[],
    readonly changedProvisions: readonly ProvisionRef[],
    /** Provisions that became tombstones (`[repealed]`) since `before`: reported as repealed, not as removed. */
    readonly repealedProvisions: readonly ProvisionRef[],
    readonly removedProvisions: readonly ProvisionRef[],
    readonly movedProvisions: readonly MovedProvision[],
    readonly addedFigures: readonly FigureChange[],
    readonly changedFigures: readonly FigureChange[],
    readonly removedFigures: readonly FigureChange[],
    readonly renumberedFigures: readonly RenumberedFigure[],
    /** Scheme of the document after the change, used to name IDs in reports. */
    readonly scheme: NumberingScheme = CARS,
  ) {}

  /** `before` null means the document is new: everything counts as added. */
  static compare(before: DocumentSnapshot | null, after: DocumentSnapshot): DocumentDiff {
    const beforeProvisions = DocumentDiff.provisionMap(before);
    const afterProvisions = DocumentDiff.provisionMap(after);
    const content = (s: DocumentSnapshot, c: Provision) => ProvisionContent.of(c, (f) => s.figureHash(f));
    const ref = (c: Provision): ProvisionRef => ({ id: c.id.text, excerpt: ProvisionContent.excerpt(c) });

    const added: Provision[] = [];
    const removed: Provision[] = [];
    const changed: ProvisionRef[] = [];
    const repealed: ProvisionRef[] = [];
    for (const [id, c] of afterProvisions) {
      const old = beforeProvisions.get(id);
      if (!old) added.push(c);
      else if (c.repealed && !old.repealed) repealed.push(ref(c));
      else if (content(before!, old) !== content(after, c)) changed.push(ref(c));
    }
    for (const [id, c] of beforeProvisions) if (!afterProvisions.has(id)) removed.push(c);

    // Moved / renumbered: a removed and an added provision with identical content.
    const moved: MovedProvision[] = [];
    const unmatchedAdded: Provision[] = [];
    const pool = removed.map((c) => ({ c, text: content(before!, c), used: false }));
    for (const a of added) {
      const text = content(after, a);
      const hit = hasBody(a) ? pool.find((p) => !p.used && p.text === text) : undefined;
      if (hit) {
        hit.used = true;
        moved.push({ from: hit.c.id.text, to: a.id.text, excerpt: ProvisionContent.excerpt(a) });
      } else unmatchedAdded.push(a);
    }
    const unmatchedRemoved = pool.filter((p) => !p.used).map((p) => p.c);

    const figs = DocumentDiff.compareFigures(before, after);
    return new DocumentDiff(
      unmatchedAdded.map(ref),
      changed,
      repealed,
      unmatchedRemoved.map(ref),
      moved,
      figs.added,
      figs.changed,
      figs.removed,
      figs.renumbered,
      after.doc.scheme,
    );
  }

  private static provisionMap(s: DocumentSnapshot | null): Map<string, Provision> {
    const m = new Map<string, Provision>();
    if (!s) return m;
    for (const c of s.doc.provisions) if (!c.id.isBlank && !m.has(c.id.text)) m.set(c.id.text, c);
    return m;
  }

  private static compareFigures(before: DocumentSnapshot | null, after: DocumentSnapshot) {
    const change = (f: Figure, b: string | null, a: string | null, reason?: FigureChange["reason"]): FigureChange => ({
      key: f.key ?? null,
      path: f.path,
      caption: f.caption,
      number: f.number,
      before: b,
      after: a,
      ...(reason ? { reason } : {}),
    });
    const old = new Map<string, Figure>();
    for (const f of before?.doc.figures ?? []) if (!old.has(figureId(f))) old.set(figureId(f), f);
    const seen = new Set<string>();
    const out = {
      added: [] as FigureChange[],
      changed: [] as FigureChange[],
      removed: [] as FigureChange[],
      renumbered: [] as RenumberedFigure[],
    };
    for (const f of after.doc.figures) {
      const id = figureId(f);
      if (seen.has(id)) continue;
      seen.add(id);
      const o = old.get(id);
      const hashAfter = after.figureHash(f);
      if (!o) {
        out.added.push(change(f, null, hashAfter));
        continue;
      }
      const hashBefore = before!.figureHash(o);
      if (hashBefore !== hashAfter) out.changed.push(change(f, hashBefore, hashAfter, "image"));
      else if (o.caption !== f.caption) out.changed.push(change(f, hashBefore, hashAfter, "caption"));
      else if (o.width !== f.width || o.align !== f.align || o.placement !== f.placement || o.path !== f.path) {
        out.changed.push(change(f, hashBefore, hashAfter, "attributes"));
      } else if (o.number !== f.number && f.key !== undefined) out.renumbered.push({ key: f.key, from: o.number, to: f.number });
    }
    for (const [id, o] of old) if (!seen.has(id)) out.removed.push(change(o, before!.figureHash(o), null));
    return out;
  }

  get isEmpty(): boolean {
    return this.contentChanged === false && this.renumberedFigures.length === 0;
  }

  /**
   * Did the document's content change in a way that needs a version bump? Provision content, added or
   * removed provisions, moves, and any figure change (including a changed image hash) count.
   */
  get contentChanged(): boolean {
    return (
      this.addedProvisions.length + this.changedProvisions.length + this.repealedProvisions.length + this.removedProvisions.length + this.movedProvisions.length > 0 ||
      this.addedFigures.length + this.changedFigures.length + this.removedFigures.length > 0
    );
  }

  toJSON(): DocumentDiffDto {
    return {
      provisions: {
        added: [...this.addedProvisions],
        changed: [...this.changedProvisions],
        repealed: [...this.repealedProvisions],
        removed: [...this.removedProvisions],
        moved: [...this.movedProvisions],
      },
      figures: {
        added: [...this.addedFigures],
        changed: [...this.changedFigures],
        removed: [...this.removedFigures],
        renumbered: [...this.renumberedFigures],
      },
    };
  }
}

/** A provision with something to compare (moves of empty provisions are ambiguous, so they are not matched). */
function hasBody(c: Provision): boolean {
  return !c.repealed && (c.blocks.length > 0 || c.title !== undefined);
}
