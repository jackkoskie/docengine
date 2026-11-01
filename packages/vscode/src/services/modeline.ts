// SPDX-License-Identifier: MPL-2.0
import type { IndexedDocument } from "../index/indexed-document.js";
import { type TextEdit, range } from "../types.js";

const MODELINE = /^#\s*yaml-language-server:\s*\$schema=/;

/** Builds the `# yaml-language-server: $schema=...` edit that gives frontmatter autocomplete in YAML-aware editors. */
export class SchemaModeline {
  /** The edit to apply, or undefined when the document has no frontmatter or already has a modeline. */
  edit(indexed: IndexedDocument, schemaRef: string): TextEdit | undefined {
    const start = indexed.doc.frontmatterStart;
    if (!start) return undefined;
    const bodyStart = indexed.bodyStartLine;
    for (let i = start.line; i < bodyStart; i++) if (MODELINE.test(indexed.lineText(i))) return undefined;
    return { file: indexed.file, range: range(start.line, 0, start.line, 0), newText: `# yaml-language-server: $schema=${schemaRef}\n` };
  }
}
