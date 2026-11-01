// SPDX-License-Identifier: MPL-2.0
import type { Document } from "../model/document.js";
import { escapeTypst, typstString } from "./text.js";

/** One inline Markdown construct: a pattern anchored at the current position and its Typst rendering. */
interface InlinePattern {
  readonly re: RegExp;
  render(m: RegExpExecArray, converter: InlineConverter): string;
}

/** Characters a Markdown backslash can escape (CommonMark ASCII punctuation). */
const ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

const PATTERNS: readonly InlinePattern[] = [
  { re: /^`([^`]+)`/, render: (m) => `#raw(${typstString(m[1]!)})` },
  { re: /^\[\[([^\[\]]*)\]\]/, render: (m, c) => c.reference(m[1]!, m[0]!) },
  { re: /^\[\^([^\[\]\s]+)\]/, render: (m, c) => c.footnote(m[1]!, m[0]!) },
  { re: /^\[([^\[\]]+)\]\(([^)\s]+)\)/, render: (m, c) => `#link(${typstString(m[2]!)})[${c.convert(m[1]!)}]` },
  { re: /^(\*\*|__)(?=\S)(.+?)(?<=\S)\1/, render: (m, c) => `#strong[${c.convert(m[2]!)}]` },
  { re: /^~~(?=\S)(.+?)(?<=\S)~~/, render: (m, c) => `#strike[${c.convert(m[1]!)}]` },
  { re: /^\+\+(?=\S)(.+?)(?<=\S)\+\+/, render: (m, c) => `#underline[${c.convert(m[1]!)}]` },
  { re: /^==(?=\S)(.+?)(?<=\S)==/, render: (m, c) => `#highlight[${c.convert(m[1]!)}]` },
  { re: /^\*(?=\S)([^*]+?)(?<=\S)\*/, render: (m, c) => `#emph[${c.convert(m[1]!)}]` },
  { re: /^_(?=\S)([^_]+?)(?<=\S)_(?![A-Za-z0-9])/, render: (m, c) => `#emph[${c.convert(m[1]!)}]` },
];

/** Typst label for a footnote, so later references can point at the first one. */
export function footnoteLabel(id: string): string {
  return `fn-${id.replace(/[^\w.:-]/g, "_")}`;
}

/** Converts inline Markdown (with docengine references) to Typst markup for one document. */
export class InlineConverter {
  /** Footnote ids already written out: the first use carries the text, later uses point back at it. */
  private readonly emittedFootnotes = new Set<string>();

  constructor(private readonly doc: Document) {}

  convert(text: string): string {
    let out = "";
    let i = 0;
    let afterExpr = false;
    while (i < text.length) {
      const rest = text.slice(i);
      const wasAfterExpr = afterExpr;
      afterExpr = false;
      let matched = false;
      if (rest[0] === "\\" && rest.length > 1 && ASCII_PUNCT.includes(rest[1]!)) {
        const ch = rest[1]!;
        out += wasAfterExpr && /[;(.]/.test(ch) ? "\\" + ch : escapeTypst(ch);
        i += 2;
        continue;
      }
      if ("`[*_~+=".includes(rest[0]!)) {
        for (const p of PATTERNS) {
          const m = p.re.exec(rest);
          if (!m) continue;
          const rendered = p.render(m, this);
          out += rendered;
          afterExpr = rendered.startsWith("#");
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // A `;`, `(` or `.` straight after a #expression would be parsed as part of that expression.
        out += wasAfterExpr && /[;(.]/.test(rest[0]!) ? "\\" + rest[0] : escapeTypst(rest[0]!);
        i += 1;
      }
    }
    return out;
  }

  /** Renders a `[^id]` footnote reference. */
  footnote(id: string, raw: string): string {
    const note = this.doc.findFootnote(id);
    if (!note) return escapeTypst(raw);
    const label = footnoteLabel(id);
    if (this.emittedFootnotes.has(id)) return `#footnote(<${label}>)`;
    this.emittedFootnotes.add(id);
    return `#footnote[${this.convert(note.text)}]<${label}>`;
  }

  /** Renders `[[...]]` content (without the brackets). */
  reference(inner: string, raw: string): string {
    const t = inner.trim();
    const hash = t.indexOf("#");
    const docName = hash > 0 ? t.slice(0, hash) : undefined;
    const target = hash > 0 ? t.slice(hash + 1) : t;
    const isFig = target.startsWith("fig:");

    if (docName) {
      // Cross-document links cannot point into another PDF: render plain text.
      return escapeTypst(isFig ? `${docName} ${target}` : `${docName} [${target}]`);
    }
    if (isFig) {
      const figure = this.doc.findFigure(target.slice(4));
      return figure?.typstLabel ? `#ref(<${figure.typstLabel}>)` : escapeTypst(raw);
    }
    const provision = this.doc.findProvision(target);
    if (provision) return `#link(<${provision.id.typstLabel}>)[\\[${escapeTypst(target)}\\]]`;
    return escapeTypst(`[${target}]`);
  }
}
