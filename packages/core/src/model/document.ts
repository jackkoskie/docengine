// SPDX-License-Identifier: MPL-2.0
import type { Provision } from "./provision.js";
import type { ProvisionId } from "./provision-id.js";
import { CARS } from "./numbering/presets.js";
import type { NumberingScheme } from "./numbering/scheme.js";
import type { Diagnostic, Position } from "./diagnostic.js";
import type { Figure } from "./figure.js";
import type { Footnote, FootnoteReference } from "./footnote.js";
import type { Reference } from "./reference.js";

export interface FrontmatterKeyPosition {
  key: Position;
  value: Position;
}

export interface DocumentProps {
  file?: string;
  frontmatter: Record<string, unknown>;
  frontmatterPositions: Record<string, FrontmatterKeyPosition>;
  /** Position of the opening `---`, or null when absent. */
  frontmatterStart: Position | null;
  /** First line (1-based) of the body. */
  bodyStartLine: number;
  provisions: readonly Provision[];
  figures: readonly Figure[];
  references: readonly Reference[];
  /** Footnote definitions (`[^id]: text`) in source order. Optional for callers that build documents by hand. */
  footnotes?: readonly Footnote[];
  /** `[^id]` references in source order. */
  footnoteReferences?: readonly FootnoteReference[];
  /** Syntax-level diagnostics produced while parsing. */
  diagnostics: readonly Diagnostic[];
  /** Scheme used to parse provision IDs. Defaults to CARs for hand-built documents. */
  scheme?: NumberingScheme;
}

const DOC_ORIGIN: Position = { line: 1, column: 1, length: 1 };

/** A parsed policy document: frontmatter plus a tree of provisions, figures and references. */
export class Document {
  readonly file?: string;
  readonly frontmatter: Record<string, unknown>;
  readonly frontmatterPositions: Record<string, FrontmatterKeyPosition>;
  readonly frontmatterStart: Position | null;
  readonly bodyStartLine: number;
  readonly provisions: readonly Provision[];
  readonly figures: readonly Figure[];
  readonly references: readonly Reference[];
  readonly footnotes: readonly Footnote[];
  readonly footnoteReferences: readonly FootnoteReference[];
  readonly diagnostics: readonly Diagnostic[];
  readonly scheme: NumberingScheme;
  private readonly byId = new Map<string, Provision>();

  constructor(p: DocumentProps) {
    if (p.file !== undefined) this.file = p.file;
    this.frontmatter = p.frontmatter;
    this.frontmatterPositions = p.frontmatterPositions;
    this.frontmatterStart = p.frontmatterStart;
    this.bodyStartLine = p.bodyStartLine;
    this.provisions = p.provisions;
    this.figures = p.figures;
    this.references = p.references;
    this.footnotes = p.footnotes ?? [];
    this.footnoteReferences = p.footnoteReferences ?? [];
    this.diagnostics = p.diagnostics;
    this.scheme = p.scheme ?? CARS;
    for (const c of p.provisions) if (!this.byId.has(c.id.text)) this.byId.set(c.id.text, c);
  }

  // ---- metadata accessors (defensive: frontmatter may be invalid) ----

  private text(key: string): string {
    const v = this.frontmatter[key];
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  }

  get title(): string { return this.text("title"); }
  get short(): string { return this.text("short"); }
  get group(): string { return this.text("group"); }
  get version(): string { return this.text("version"); }
  get effectiveDate(): string { return this.text("effectiveDate"); }
  get expiryDate(): string | null { return typeof this.frontmatter.expiryDate === "string" ? this.frontmatter.expiryDate : null; }
  get description(): string | null { return typeof this.frontmatter.description === "string" ? this.frontmatter.description : null; }
  get isDraft(): boolean { return this.frontmatter.draft === true; }
  get subtitle(): string | null { return typeof this.frontmatter.subtitle === "string" && this.frontmatter.subtitle ? this.frontmatter.subtitle : null; }
  get effectiveTime(): string | null { return typeof this.frontmatter.effectiveTime === "string" && this.frontmatter.effectiveTime ? this.frontmatter.effectiveTime : null; }
  get notice(): string | null { return typeof this.frontmatter.notice === "string" && this.frontmatter.notice ? this.frontmatter.notice : null; }
  /** `cover:` as written, or undefined when the document defers to the config. */
  get coverFlag(): boolean | undefined { return typeof this.frontmatter.cover === "boolean" ? this.frontmatter.cover : undefined; }
  /** `toc:` as written, or undefined when the default applies. */
  get tocFlag(): boolean | undefined { return typeof this.frontmatter.toc === "boolean" ? this.frontmatter.toc : undefined; }

  /** `group/short`. */
  get repositoryKey(): string {
    return `${this.group}/${this.short}`;
  }

  /** Does `name` ("short" or "group/short") identify this document? */
  matchesName(name: string): boolean {
    const [group, short] = name.includes("/") ? name.split("/") : [undefined, name];
    return this.frontmatter.short === short && (group === undefined || this.frontmatter.group === group);
  }

  /** Frontmatter fields outside the base schema. */
  extensionFields(baseKeys: readonly string[]): Record<string, unknown> {
    const base = new Set(baseKeys);
    return Object.fromEntries(Object.entries(this.frontmatter).filter(([k]) => !base.has(k)));
  }

  frontmatterPosition(key: string, which: "key" | "value" = "value"): Position {
    return this.frontmatterPositions[key]?.[which] ?? this.frontmatterStart ?? DOC_ORIGIN;
  }

  // ---- provision tree ----

  findProvision(id: ProvisionId | string): Provision | undefined {
    return this.byId.get(typeof id === "string" ? id : id.text);
  }

  hasProvision(id: ProvisionId | string): boolean {
    return this.byId.has(typeof id === "string" ? id : id.text);
  }

  childrenOf(id: ProvisionId): Provision[] {
    return this.provisions.filter((c) => c.id.isChildOf(id));
  }

  /** Provisions with a well-formed, first-seen ID (the ones structural rules reason about). */
  get usableProvisions(): Provision[] {
    const seen = new Set<string>();
    const out: Provision[] = [];
    for (const c of this.provisions) {
      if (c.id.isBlank || !c.id.isWellFormed || seen.has(c.id.text)) continue;
      seen.add(c.id.text);
      out.push(c);
    }
    return out;
  }

  // ---- footnotes ----

  /** The first definition for `id` (duplicates are reported by a rule). */
  findFootnote(id: string): Footnote | undefined {
    return this.footnotes.find((f) => f.id === id);
  }

  // ---- figures ----

  findFigure(key: string): Figure | undefined {
    return this.figures.find((f) => f.key === key);
  }

  /** Keys of figures referenced from within this document. */
  get referencedFigureKeys(): Set<string> {
    return new Set(this.references.filter((r) => r.isFigure && !r.isCrossDocument).map((r) => r.target));
  }

  /** Repo-relative paths of all figure files. */
  get figureSources(): string[] {
    return this.figures.map((f) => f.sourcePath(this.file));
  }
}

