// SPDX-License-Identifier: MPL-2.0
import type { ProvisionId } from "../model/provision-id.js";
import { FootnoteReference } from "../model/footnote.js";

/** `[^id]: text` at the start of a line. */
export const FOOTNOTE_DEFINITION = /^\[\^([^\[\]\s]+)\]:[ \t]?(.*)$/;

/** Finds `[^id]` footnote references in a line of text, skipping inline code spans. */
export class FootnoteScanner {
  scan(text: string, line: number, owner: ProvisionId | null, insideFootnote: boolean): FootnoteReference[] {
    const spans: [number, number][] = [];
    const codeRe = /`+[^`]*`+/g;
    let m: RegExpExecArray | null;
    while ((m = codeRe.exec(text))) spans.push([m.index, m.index + m[0].length]);

    const out: FootnoteReference[] = [];
    const refRe = /\[\^([^\[\]\s]+)\]/g;
    while ((m = refRe.exec(text))) {
      const idx = m.index;
      if (spans.some(([s, e]) => idx >= s && idx < e)) continue;
      out.push(new FootnoteReference(m[1]!, { line, column: idx + 1, length: m[0].length }, owner, insideFootnote));
    }
    return out;
  }
}
