// SPDX-License-Identifier: MPL-2.0
import type { NumberingScheme } from "../model/numbering/scheme.js";
import { CARS } from "../model/numbering/presets.js";
import type { ProvisionId } from "../model/provision-id.js";
import { Reference } from "../model/reference.js";

/** Finds `[[...]]` references in a line of text, skipping inline code spans. */
export class ReferenceScanner {
  scan(text: string, line: number, owner: ProvisionId | null, scheme: NumberingScheme = owner?.scheme ?? CARS): Reference[] {
    const spans: [number, number][] = [];
    const codeRe = /`+[^`]*`+/g;
    let m: RegExpExecArray | null;
    while ((m = codeRe.exec(text))) spans.push([m.index, m.index + m[0].length]);

    const out: Reference[] = [];
    const refRe = /\[\[([^\[\]\n]*)\]\]/g;
    while ((m = refRe.exec(text))) {
      const idx = m.index;
      if (spans.some(([s, e]) => idx >= s && idx < e)) continue;
      const raw = m[0];
      const inner = m[1]!.trim();
      const hash = inner.indexOf("#");
      const doc = hash > 0 ? inner.slice(0, hash) : undefined;
      const target = hash > 0 ? inner.slice(hash + 1) : inner;
      const isFig = target.startsWith("fig:");
      const leading = m[1]!.length - m[1]!.trimStart().length;
      const targetOffset = 2 + leading + (hash > 0 ? hash + 1 : 0) + (isFig ? 4 : 0);
      out.push(
        new Reference(
          raw,
          isFig ? "figure" : "provision",
          isFig ? target.slice(4) : target,
          { line, column: idx + 1, length: raw.length },
          owner,
          doc,
          targetOffset,
          scheme,
        ),
      );
    }
    return out;
  }
}
