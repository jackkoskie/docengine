// SPDX-License-Identifier: MPL-2.0
import type { NumberingScheme } from "../model/numbering/scheme.js";
import { ProvisionId } from "../model/provision-id.js";
import type { Document } from "../model/document.js";

export interface RenumberSource {
  /** Repo-relative path. */
  file: string;
  source: string;
  doc: Document;
}

export interface RenumberChange {
  file: string;
  line: number;
  kind: "provision" | "reference" | "tombstone";
  from: string;
  to: string;
}

export interface RenumberMapping {
  from: string;
  to: string;
}

export interface RenumberOptions {
  /** Leave `[old] [repealed] Renumbered to [[new]]` in place of each renumbered provision. */
  tombstone?: boolean;
}

export interface RenumberPlan {
  /** Files whose text changed, with the new text. */
  edits: { file: string; text: string }[];
  /** Every change, for logging. */
  changes: RenumberChange[];
  problems: string[];
}

interface Edit {
  line: number;
  column: number;
  length: number;
  text: string;
}

/** Is `id` strictly inside `from` (a heading holds everything numbered under it)? */
function isInside(id: string, from: string, scheme: NumberingScheme): boolean {
  if (id === from || !id.startsWith(from)) return false;
  return ProvisionId.parse(id, scheme).isDescendantOf(ProvisionId.parse(from, scheme));
}

/**
 * Explicit, logged renumbering. A mapping `602.60(1) -> 602.60(2)` also moves every descendant
 * (`602.60(1)(a)` becomes `602.60(2)(a)`) and rewrites all `[[refs]]` to the moved IDs in the target
 * document and in every other document that references it.
 */
export class Renumberer {
  plan(
    sources: readonly RenumberSource[],
    targetFile: string,
    mappings: readonly RenumberMapping[],
    options: RenumberOptions = {},
  ): RenumberPlan {
    const problems: string[] = [];
    const target = sources.find((s) => s.file === targetFile);
    if (!target) return { edits: [], changes: [], problems: [`Document ${targetFile} not found`] };
    const scheme = target.doc.scheme;
    const sorted = [...mappings].sort((a, b) => b.from.length - a.from.length);

    for (const m of mappings) {
      if (!target.doc.hasProvision(m.from)) problems.push(`Provision [${m.from}] does not exist in ${targetFile}`);
      const probs = ProvisionId.parse(m.to, scheme).formProblems();
      if (probs.length) problems.push(`Target [${m.to}]: ${probs[0]}`);
      if (ProvisionId.parse(m.from, scheme).depth !== ProvisionId.parse(m.to, scheme).depth) {
        problems.push(`[${m.from}] and [${m.to}] are at different depths`);
      }
    }
    const mapId = (id: string): string | null => {
      for (const m of sorted) {
        if (id === m.from) return m.to;
        if (isInside(id, m.from, scheme)) return m.to + id.slice(m.from.length);
      }
      return null;
    };

    // Collisions: a new ID may not equal an unmoved existing ID or another new ID.
    const seen = new Set<string>();
    for (const c of target.doc.provisions) {
      if (c.id.isBlank) continue;
      const next = mapId(c.id.text) ?? c.id.text;
      if (seen.has(next)) problems.push(`Renumbering would produce duplicate ID [${next}] in ${targetFile}`);
      seen.add(next);
    }
    if (problems.length) return { edits: [], changes: [], problems };

    const changes: RenumberChange[] = [];
    const edits: { file: string; text: string }[] = [];
    for (const src of sources) {
      const file = src.file;
      const doc = src.doc;
      const found: Edit[] = [];
      const isTarget = file === targetFile;
      const inserts: { line: number; text: string }[] = [];

      if (isTarget) {
        for (const c of doc.provisions) {
          const next = mapId(c.id.text);
          if (!next) continue;
          found.push({ line: c.startLine, column: 1, length: c.id.text.length + 2, text: `[${next}]` });
          changes.push({ file, line: c.startLine, kind: "provision", from: c.id.text, to: next });
          if (options.tombstone) {
            inserts.push({ line: c.startLine, text: `[${c.id.text}] [repealed] Renumbered to [[${next}]]` });
            changes.push({ file, line: c.startLine, kind: "tombstone", from: c.id.text, to: next });
          }
        }
      }
      for (const r of doc.references) {
        if (r.isFigure) continue;
        const refersToTarget = r.doc === undefined ? isTarget : target.doc.matchesName(r.doc);
        if (!refersToTarget) continue;
        const next = mapId(r.target);
        if (!next) continue;
        const prefix = r.doc !== undefined ? `${r.doc}#` : "";
        found.push({ line: r.position.line, column: r.position.column, length: r.position.length, text: `[[${prefix}${next}]]` });
        changes.push({ file, line: r.position.line, kind: "reference", from: r.target, to: next });
      }
      if (found.length === 0) continue;

      const eol = src.source.includes("\r\n") ? "\r\n" : "\n";
      const lines = src.source.split(/\r?\n/);
      for (const e of found.sort((a, b) => b.line - a.line || b.column - a.column)) {
        const l = lines[e.line - 1]!;
        lines[e.line - 1] = l.slice(0, e.column - 1) + e.text + l.slice(e.column - 1 + e.length);
      }
      for (const ins of inserts.sort((a, b) => b.line - a.line)) lines.splice(ins.line - 1, 0, ins.text, "");
      edits.push({ file, text: lines.join(eol) });
    }
    return { edits, changes: changes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line), problems };
  }
}
