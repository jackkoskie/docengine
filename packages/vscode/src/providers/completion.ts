// SPDX-License-Identifier: MPL-2.0
import { BASE_KEYS, ProvisionId } from "@jackkoskie/docengine-core";
import { ProvisionText, type IndexedDocument } from "../index/indexed-document.js";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import { type Range, range } from "../types.js";

export type CompletionKind = "provision" | "figure" | "document" | "field" | "value" | "footnote";

export interface CompletionItemDto {
  label: string;
  kind: CompletionKind;
  detail?: string;
  documentation?: string;
  /** Text to insert; defaults to the label. */
  insertText: string;
  /** Range replaced by the insertion. */
  replace: Range;
  /** Text VS Code filters on (what the user has typed so far must prefix-match it). */
  filterText?: string;
  sortText?: string;
  /** Re-open the suggest widget after inserting (used for `other-doc#`). */
  retrigger?: boolean;
}

/** Source of the extension frontmatter keys for key completion. */
export interface FrontmatterKeys {
  extensionKeys(): readonly string[];
}

const REF_PREFIX = /\[\[([^\[\]\n]*)$/;
const FOOTNOTE_PREFIX = /\[\^([^\[\]\s]*)$/;
const PROVISION_START = /^\[([^\[\]\s]*)$/;
const KEY_LINE = /^([A-Za-z][\w-]*)?$/;
const VALUE_LINE = /^([A-Za-z][\w-]*):\s*(.*)$/;

/** Completion for `[[` references, new provision IDs and frontmatter. */
export class CompletionProvider {
  constructor(
    private readonly index: WorkspaceIndex,
    private readonly keys: FrontmatterKeys,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  provide(file: string, line: number, char: number): CompletionItemDto[] {
    const indexed = this.index.get(file);
    if (!indexed) return [];
    const prefix = indexed.lineText(line).slice(0, char);
    if (indexed.isFrontmatterLine(line)) return this.frontmatter(indexed, prefix, line, char);
    const ref = REF_PREFIX.exec(prefix);
    if (ref) return this.references(indexed, ref[1]!, line, char);
    const note = FOOTNOTE_PREFIX.exec(prefix);
    if (note) return this.footnotes(indexed, note[1]!, prefix.startsWith("[^"), line, char);
    const start = PROVISION_START.exec(prefix);
    if (start && prefix.startsWith("[")) return this.nextIds(indexed, start[1]!, line, char);
    return [];
  }

  // ---- [[ references ----

  private references(from: IndexedDocument, typed: string, line: number, char: number): CompletionItemDto[] {
    const replaceFrom = char - typed.length;
    const hash = typed.indexOf("#");
    if (hash > 0) {
      const target = this.index.resolve(from, typed.slice(0, hash));
      if (!target) return [];
      const afterHash = typed.slice(hash + 1);
      const replaceAfterHash = range(line, replaceFrom + hash + 1, line, char);
      return afterHash.startsWith("fig:")
        ? this.figureItems(target, range(line, replaceFrom + hash + 5, line, char))
        : [...this.provisionItems(target, replaceAfterHash), ...this.figureLabelItems(target, replaceAfterHash)];
    }
    const here = range(line, replaceFrom, line, char);
    if (typed.startsWith("fig:")) return this.figureItems(from, range(line, replaceFrom + 4, line, char));
    return [...this.provisionItems(from, here), ...this.figureLabelItems(from, here), ...this.documentItems(from, here)];
  }

  private provisionItems(target: IndexedDocument, replace: Range): CompletionItemDto[] {
    return target.doc.usableProvisions.map((c) => ({
      label: c.id.text,
      kind: "provision" as const,
      detail: ProvisionText.summary(c),
      documentation: ProvisionText.full(c),
      insertText: c.id.text,
      replace,
      sortText: this.sortKey(c.id),
    }));
  }

  /** `fig:key` labels offered alongside provision IDs. */
  private figureLabelItems(target: IndexedDocument, replace: Range): CompletionItemDto[] {
    return target.doc.figures
      .filter((f) => f.key)
      .map((f) => ({
        label: `fig:${f.key}`,
        kind: "figure" as const,
        detail: `Figure ${f.number}: ${f.caption}`,
        insertText: `fig:${f.key}`,
        replace,
        sortText: `z-${String(f.number).padStart(4, "0")}`,
      }));
  }

  /** Bare figure keys, after `fig:` has been typed. */
  private figureItems(target: IndexedDocument, replace: Range): CompletionItemDto[] {
    return target.doc.figures
      .filter((f) => f.key)
      .map((f) => ({
        label: f.key!,
        kind: "figure" as const,
        detail: `Figure ${f.number}: ${f.caption}`,
        documentation: f.path,
        insertText: f.key!,
        replace,
        sortText: String(f.number).padStart(4, "0"),
      }));
  }

  private documentItems(from: IndexedDocument, replace: Range): CompletionItemDto[] {
    return this.index
      .all()
      .filter((d) => d.file !== from.file && d.doc.short)
      .map((d) => ({
        label: `${this.index.nameFor(d)}#`,
        kind: "document" as const,
        detail: d.label,
        documentation: d.doc.description ?? "",
        insertText: `${this.index.nameFor(d)}#`,
        replace,
        sortText: `zz-${d.file}`,
        retrigger: true,
      }));
  }

  private sortKey(id: ProvisionId): string {
    return id.sortKey;
  }

  // ---- [^ footnotes ----

  /** Defined footnote ids after `[^`; at the start of a line also the next unused id, to write a new definition. */
  private footnotes(indexed: IndexedDocument, typed: string, atLineStart: boolean, line: number, char: number): CompletionItemDto[] {
    // The closing bracket may have been auto-inserted by the editor; swallow it.
    const end = indexed.lineText(line).charAt(char) === "]" ? char + 1 : char;
    const replace = range(line, char - typed.length, line, end);
    const items: CompletionItemDto[] = indexed.doc.footnotes
      .filter((f, i, all) => all.findIndex((o) => o.id === f.id) === i)
      .map((f) => ({
        label: f.id,
        kind: "footnote" as const,
        detail: f.text.length > 80 ? `${f.text.slice(0, 79)}…` : f.text,
        documentation: f.text,
        insertText: atLineStart && indexed.lineText(line).trim() === `[^${typed}` + (end > char ? "]" : "") ? `${f.id}]: ` : `${f.id}]`,
        filterText: f.id,
        replace,
        sortText: `0-${f.id}`,
      }));
    const used = new Set(indexed.doc.footnotes.map((f) => f.id));
    let n = 1;
    while (used.has(String(n))) n++;
    const next = String(n);
    if (next.startsWith(typed) && !used.has(next)) {
      const definition = atLineStart && indexed.lineText(line).trim() === `[^${typed}` + (end > char ? "]" : "");
      items.push({
        label: next,
        kind: "footnote",
        detail: definition ? "new footnote definition" : "new footnote (add its definition afterwards)",
        insertText: definition ? `${next}]: ` : `${next}]`,
        filterText: next,
        replace,
        sortText: "1-new",
      });
    }
    return items.filter((i) => i.label.startsWith(typed));
  }

  // ---- new provision IDs ----

  private nextIds(indexed: IndexedDocument, typed: string, line: number, char: number): CompletionItemDto[] {
    const existing = new Set(indexed.doc.provisions.map((c) => c.id.text));
    const prev = [...indexed.doc.usableProvisions].filter((c) => c.startLine - 1 < line).pop();
    const candidates: { id: ProvisionId; detail: string }[] = [];
    const add = (id: ProvisionId | null, detail: string): void => {
      if (id) candidates.push({ id, detail });
    };

    if (prev) {
      const { id } = prev;
      const top = id.scheme.topLevels;
      add(id.depth > top ? id.sibling((id.ordinal ?? 0) + 1) : id.depth === top ? id.nextSection() : null, `next ${id.level.label.toLowerCase()}`);
      if (id.depth >= top && id.depth < id.scheme.maxLevel) {
        const child = id.child(1);
        add(child, `first ${child.level.label.toLowerCase()}`);
      }
      for (let a = id.parent; a; a = a.parent) {
        if (a.depth > a.scheme.topLevels) add(a.sibling((a.ordinal ?? 0) + 1), `next ${a.level.label.toLowerCase()} after [${a}]`);
        else if (a.depth === a.scheme.topLevels) add(a.nextSection(), `next ${a.level.label} after [${a}]`);
      }
    }
    add(this.nextSection(indexed), "new Section");

    // The closing bracket may have been auto-inserted by the editor; swallow it.
    const after = indexed.lineText(line).charAt(char);
    const end = after === "]" ? char + 1 : char;
    const replace = range(line, char - typed.length, line, end);
    const seen = new Set<string>();
    return candidates
      .filter(({ id }) => id.text.startsWith(typed) && !existing.has(id.text) && !seen.has(id.text) && seen.add(id.text))
      .map(({ id, detail }, i) => ({
        label: id.text,
        kind: "provision" as const,
        detail,
        insertText: `${id.text}] `,
        filterText: id.text,
        replace,
        sortText: String(i).padStart(2, "0"),
      }));
  }

  /** The next section-level ID after the highest section (or the division above it) in the document. */
  private nextSection(indexed: IndexedDocument): ProvisionId | null {
    const scheme = indexed.doc.scheme;
    const top = scheme.topLevels;
    let anchor: ProvisionId | null = null;
    for (const c of indexed.doc.usableProvisions) {
      if ((c.depth === top - 1 || c.depth === top) && (!anchor || c.id.compare(anchor) > 0)) anchor = c.id;
    }
    if (!anchor) return null;
    return anchor.depth === top - 1 ? ProvisionId.parse(scheme.compose(anchor.text, top, 1), scheme) : anchor.nextSection();
  }

  // ---- frontmatter ----

  private frontmatter(indexed: IndexedDocument, prefix: string, line: number, char: number): CompletionItemDto[] {
    if (indexed.doc.frontmatterStart && line === indexed.doc.frontmatterStart.line - 1) return [];
    const value = VALUE_LINE.exec(prefix);
    if (value) return this.values(indexed, value[1]!, value[2]!, line, char);
    if (!KEY_LINE.test(prefix)) return [];
    const present = new Set(Object.keys(indexed.doc.frontmatter));
    return [...new Set([...BASE_KEYS, ...this.keys.extensionKeys()])]
      .filter((k) => !present.has(k))
      .map((k) => ({
        label: k,
        kind: "field" as const,
        detail: BASE_KEYS.includes(k) ? "docengine frontmatter" : "extension field",
        insertText: `${k}: `,
        filterText: k,
        replace: range(line, char - prefix.length, line, char),
        retrigger: true,
      }));
  }

  private values(indexed: IndexedDocument, key: string, typed: string, line: number, char: number): CompletionItemDto[] {
    const replace = range(line, char - typed.length, line, char);
    const item = (v: string, detail?: string): CompletionItemDto => ({
      label: v,
      kind: "value",
      insertText: v,
      replace,
      ...(detail ? { detail } : {}),
    });
    switch (key) {
      case "group":
        return [...new Set(this.index.all().map((d) => d.doc.group).filter(Boolean))].map((g) => item(g));
      case "short":
        return [item(indexed.file.split("/").pop()!.replace(/\.md$/i, ""), "file name")];
      case "effectiveDate":
      case "expiryDate":
        return [item(this.today(), "today")];
      case "version":
        return [item('"1.0"')];
      case "draft":
        return [item("true"), item("false")];
      case "version-note":
        return [item("editorial", "editorial-only change; skips the version-bump check")];
      default:
        return [];
    }
  }
}
