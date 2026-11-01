// SPDX-License-Identifier: MPL-2.0
import type { Provision, Document } from "@jackkoskie/docengine-core";

/** Extracts readable text from provisions (for completion detail, hover and outline). */
export class ProvisionText {
  /** One-line summary: the Section title or the first paragraph. */
  static summary(provision: Provision, max = 100): string {
    const first = provision.title ?? ProvisionText.paragraphs(provision)[0] ?? (provision.repealed ? "(repealed)" : "");
    return ProvisionText.truncate(first, max);
  }

  /** Whole provision text (title, paragraphs and list items), truncated. */
  static full(provision: Provision, max = 600): string {
    const parts: string[] = [];
    if (provision.title) parts.push(provision.title);
    parts.push(...ProvisionText.paragraphs(provision, true));
    if (provision.repealed) parts.push(`(repealed${provision.repealNote ? `: ${provision.repealNote}` : ""})`);
    return ProvisionText.truncate(parts.join("\n\n"), max);
  }

  private static paragraphs(provision: Provision, includeLists = false): string[] {
    const out: string[] = [];
    for (const b of provision.blocks) {
      if (b.type === "paragraph") out.push(b.text);
      else if (includeLists && b.type === "list") out.push(b.items.map((i) => `- ${i}`).join("\n"));
    }
    return out;
  }

  static truncate(text: string, max: number): string {
    const t = text.trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }
}

/** A parsed document together with its source text and file path. */
export class IndexedDocument {
  private cachedLines: string[] | undefined;

  constructor(
    readonly file: string,
    readonly text: string,
    readonly doc: Document,
  ) {}

  get lines(): string[] {
    this.cachedLines ??= this.text.split(/\r?\n/);
    return this.cachedLines;
  }

  lineText(line: number): string {
    return this.lines[line] ?? "";
  }

  /** 0-based index of the first body line; lines before it are frontmatter. */
  get bodyStartLine(): number {
    return this.doc.bodyStartLine - 1;
  }

  isFrontmatterLine(line: number): boolean {
    return this.doc.frontmatterStart !== null && line < this.bodyStartLine;
  }

  get label(): string {
    const d = this.doc;
    const title = d.title || d.short || this.file;
    return d.version ? `${title} (v${d.version})` : title;
  }

  /** The provision whose lines contain `line` (0-based), if any. */
  provisionAtLine(line: number): Provision | undefined {
    const n = line + 1;
    let found: Provision | undefined;
    for (const c of this.doc.provisions) if (c.startLine <= n) found = c;
    return found && n <= Math.max(found.endLine, found.startLine) ? found : undefined;
  }

  /** The provision that starts at or before `line` (0-based), regardless of blank trailing lines. */
  provisionStartingAtOrBefore(line: number): Provision | undefined {
    let found: Provision | undefined;
    for (const c of this.doc.provisions) if (c.startLine <= line + 1) found = c;
    return found;
  }
}
