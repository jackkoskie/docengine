// SPDX-License-Identifier: MPL-2.0
import { DocVersion, type BumpKind } from "../git/version.js";
import type { Document } from "../model/document.js";

export interface BumpResult {
  text: string;
  from: string;
  to: string;
  effectiveDate: string;
}

/** Rewrites scalar frontmatter values in place, keeping everything else byte-for-byte. */
export class FrontmatterEditor {
  /** Replaces the value of `key`. `quote` forces double quotes; otherwise the existing style is kept. */
  setScalar(source: string, doc: Document, key: string, value: string, quote?: boolean): string {
    const pos = doc.frontmatterPositions[key]?.value;
    if (!pos) throw new Error(`Frontmatter key "${key}" not found`);
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const lines = source.split(/\r?\n/);
    const line = lines[pos.line - 1] ?? "";
    const existing = line.slice(pos.column - 1, pos.column - 1 + pos.length);
    const q = quote ?? /^["']/.test(existing);
    lines[pos.line - 1] = line.slice(0, pos.column - 1) + (q ? `"${value}"` : value) + line.slice(pos.column - 1 + pos.length);
    return lines.join(eol);
  }
}

/** `docengine bump`: raises `version` and sets `effectiveDate`. */
export class VersionBumper {
  constructor(private readonly editor = new FrontmatterEditor()) {}

  bump(source: string, doc: Document, kind: BumpKind, effectiveDate: string): BumpResult {
    const current = DocVersion.parse(doc.version);
    if (!current) throw new Error(`Cannot bump: version "${doc.version}" is not of the form <major>.<minor>`);
    const next = current.bump(kind).text;
    let text = this.editor.setScalar(source, doc, "version", next, true);
    // Positions are line-based and the edits do not change line counts, so the document still applies.
    text = this.editor.setScalar(text, doc, "effectiveDate", effectiveDate);
    return { text, from: current.text, to: next, effectiveDate };
  }
}
