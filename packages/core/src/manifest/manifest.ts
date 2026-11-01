// SPDX-License-Identifier: MPL-2.0
import type { ResolvedConfig } from "../config/config.js";
import type { ProvisionIndexEntry } from "../model/provision.js";
import type { Document } from "../model/document.js";
import type { FigureIndexEntry } from "../model/figure.js";
import { BASE_KEYS } from "../schema.js";

export interface PdfInfo {
  filename: string;
  path: string;
  sha256: string;
}

/** Serialised shape of one manifest entry (what `manifest.json` contains). */
export interface ManifestEntryDto {
  group: string;
  short: string;
  title: string;
  version: string;
  effectiveDate: string;
  expiryDate: string | null;
  description: string | null;
  draft: boolean;
  /** Frontmatter fields beyond the base schema (supplied by the FIR's extensions). */
  extensions: Record<string, unknown>;
  source: string | null;
  pdf: PdfInfo | null;
  gitCommit: string | null;
  /** null = unknown. Later phase: derive from the previous release tag. */
  changed: boolean | null;
  provisions: ProvisionIndexEntry[];
  figures: FigureIndexEntry[];
}

export interface ManifestDto {
  schemaVersion: 1;
  generator: { name: "docengine"; version: string };
  gitCommit: string | null;
  documents: ManifestEntryDto[];
}

export interface ManifestEntryInput {
  /** Built PDF, when typst compiled it. */
  pdf?: PdfInfo | null;
  /** SHA-256 of figure files keyed by repo-relative path. */
  fileHashes?: Record<string, string>;
  gitCommit?: string | null;
}

/** One document's release facts. Immutable; derive changed copies with `with*`. */
export class ManifestEntry {
  constructor(private readonly data: Readonly<ManifestEntryDto>) {}

  static fromDocument(doc: Document, config: ResolvedConfig, input: ManifestEntryInput = {}): ManifestEntry {
    return new ManifestEntry({
      group: doc.group,
      short: doc.short,
      title: doc.title,
      version: doc.version,
      effectiveDate: doc.effectiveDate,
      expiryDate: doc.expiryDate,
      description: doc.description,
      draft: doc.isDraft,
      extensions: doc.extensionFields(BASE_KEYS),
      source: doc.file ?? null,
      pdf: input.pdf ?? null,
      gitCommit: input.gitCommit ?? null,
      changed: null,
      provisions: doc.provisions.filter((c) => !c.id.isBlank).map((c) => c.toIndexEntry()),
      figures: doc.figures.map((f) => f.toIndexEntry(doc.file, input.fileHashes)),
    });
  }

  get group() { return this.data.group; }
  get short() { return this.data.short; }
  get title() { return this.data.title; }
  get version() { return this.data.version; }
  get effectiveDate() { return this.data.effectiveDate; }
  get expiryDate() { return this.data.expiryDate; }
  get description() { return this.data.description; }
  get draft() { return this.data.draft; }
  get extensions() { return this.data.extensions; }
  get source() { return this.data.source; }
  get pdf() { return this.data.pdf; }
  get gitCommit() { return this.data.gitCommit; }
  get changed() { return this.data.changed; }
  get provisions() { return this.data.provisions; }
  get figures() { return this.data.figures; }

  get key(): string {
    return `${this.group}/${this.short}`;
  }

  withChanged(changed: boolean | null): ManifestEntry {
    return new ManifestEntry({ ...this.data, changed });
  }

  withPdf(pdf: PdfInfo | null): ManifestEntry {
    return new ManifestEntry({ ...this.data, pdf });
  }

  toJSON(): ManifestEntryDto {
    return { ...this.data };
  }
}

export interface ManifestOptions {
  gitCommit?: string | null;
  engineVersion?: string;
  /**
   * Hook for changed-only marking. TODO(phase: action): wire to the previous release tag
   * (`<group>/<short>/v<version>`) so only new or changed versions are flagged.
   * Return null when unknown.
   */
  isChanged?: (entry: ManifestEntry) => boolean | null;
}

export class Manifest {
  private constructor(
    readonly generator: { name: "docengine"; version: string },
    readonly gitCommit: string | null,
    readonly documents: readonly ManifestEntry[],
  ) {}

  static create(entries: readonly ManifestEntry[], options: ManifestOptions = {}): Manifest {
    const documents = entries
      .map((e) => (options.isChanged ? e.withChanged(options.isChanged(e)) : e))
      .sort((a, b) => a.key.localeCompare(b.key));
    return new Manifest({ name: "docengine", version: options.engineVersion ?? "0.0.0" }, options.gitCommit ?? null, documents);
  }

  find(group: string, short: string): ManifestEntry | undefined {
    return this.documents.find((d) => d.group === group && d.short === short);
  }

  /** Non-draft documents that are new/changed or of unknown status. */
  releasable(changedOnly = false): ManifestEntry[] {
    return this.documents.filter((d) => !d.draft && (!changedOnly || d.changed !== false));
  }

  toJSON(): ManifestDto {
    return {
      schemaVersion: 1,
      generator: this.generator,
      gitCommit: this.gitCommit,
      documents: this.documents.map((d) => d.toJSON()),
    };
  }
}
