// SPDX-License-Identifier: MPL-2.0
import { LineCounter, isMap, isScalar, parseDocument } from "yaml";
import type { DiagnosticCollector, Position } from "../model/diagnostic.js";
import type { FrontmatterKeyPosition } from "../model/document.js";

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  positions: Record<string, FrontmatterKeyPosition>;
  start: Position | null;
  /** 0-based index of the first body line. */
  bodyStart: number;
}

const pos = (line: number, column: number, length: number): Position => ({ line, column, length });

/** Parses the leading `---` YAML block, recording line/column of every key and value. */
export class FrontmatterParser {
  parse(lines: readonly string[], sink: DiagnosticCollector): FrontmatterResult {
    if (lines[0]?.trim() !== "---") {
      sink.error("missing-frontmatter", "Document must start with a '---' frontmatter block", pos(1, 1, 1));
      return { frontmatter: {}, positions: {}, start: null, bodyStart: 0 };
    }
    const start = pos(1, 1, 3);
    const end = lines.findIndex((l, i) => i >= 1 && (l.trim() === "---" || l.trim() === "..."));
    if (end === -1) {
      sink.error("unterminated-frontmatter", "Frontmatter is not closed with a '---' line", pos(1, 1, 3));
      return { frontmatter: {}, positions: {}, start, bodyStart: lines.length };
    }

    const text = lines.slice(1, end).join("\n");
    const lc = new LineCounter();
    const ydoc = parseDocument(text, { lineCounter: lc });
    for (const e of ydoc.errors) {
      const lp = e.linePos?.[0];
      sink.error("frontmatter-yaml", e.message.split("\n")[0]!, pos((lp?.line ?? 1) + 1, lp?.col ?? 1, 1));
    }

    let frontmatter: Record<string, unknown> = {};
    if (ydoc.errors.length === 0 || ydoc.contents) {
      try {
        const js = ydoc.toJS();
        if (js !== null && js !== undefined) {
          if (typeof js === "object" && !Array.isArray(js)) frontmatter = js as Record<string, unknown>;
          else sink.error("frontmatter-not-mapping", "Frontmatter must be a YAML mapping of keys to values", pos(2, 1, 1));
        }
      } catch {
        /* already reported */
      }
    }

    const positions: Record<string, FrontmatterKeyPosition> = {};
    if (isMap(ydoc.contents)) {
      const span = (range: [number, number, number] | null | undefined): Position => {
        if (!range) return pos(2, 1, 1);
        const p = lc.linePos(range[0]);
        return pos(p.line + 1, p.col, Math.max(1, range[1] - range[0]));
      };
      for (const pair of ydoc.contents.items) {
        if (!isScalar(pair.key)) continue;
        const keyPos = span(pair.key.range);
        const valRange = pair.value && typeof pair.value === "object" && "range" in pair.value ? pair.value.range : null;
        positions[String(pair.key.value)] = { key: keyPos, value: valRange ? span(valRange) : keyPos };
      }
    }
    return { frontmatter, positions, start, bodyStart: end + 1 };
  }
}
