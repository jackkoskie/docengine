// SPDX-License-Identifier: MPL-2.0
import type { ResolvedConfig } from "../config/config.js";
import type { Document } from "../model/document.js";
import { Manifest, ManifestEntry, type ManifestEntryInput, type ManifestOptions } from "./manifest.js";

/** Builds manifest entries and manifests for a given config. */
export class ManifestBuilder {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly options: ManifestOptions = {},
  ) {}

  entry(doc: Document, input: ManifestEntryInput = {}): ManifestEntry {
    return ManifestEntry.fromDocument(doc, this.config, input);
  }

  build(entries: readonly ManifestEntry[]): Manifest {
    return Manifest.create(entries, this.options);
  }
}

export interface UploadSheetOptions {
  /** List only documents with changed === true or unknown (null). Default false. */
  changedOnly?: boolean;
}

/** Renders the upload sheet. */
export interface UploadSheetRenderer {
  build(manifest: Manifest, options?: UploadSheetOptions): string;
}

const cell = (s: string) => s.replaceAll("|", "\\|");

/** Human-readable table of the values staff enter in the DMS. Drafts are excluded. */
export class UploadSheetBuilder implements UploadSheetRenderer {
  build(manifest: Manifest, options: UploadSheetOptions = {}): string {
    const docs = manifest.releasable(options.changedOnly ?? false);
    const lines = ["# Upload sheet", ""];
    if (manifest.gitCommit) lines.push(`Built from commit \`${manifest.gitCommit}\`.`, "");
    if (docs.length === 0) {
      lines.push("No documents to upload.", "");
      return lines.join("\n");
    }
    lines.push(
      "| Group | Document | Version | Effective | Expiry | PDF | SHA-256 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const d of docs) {
      lines.push(
        `| ${cell(d.group)} | ${cell(d.short)} | ${cell(d.version)} | ${d.effectiveDate} | ${d.expiryDate ?? "none"} | ${
          d.pdf ? cell(d.pdf.filename) : "(not built)"
        } | ${d.pdf ? `\`${d.pdf.sha256}\`` : "n/a"} |`,
      );
    }
    lines.push("");
    const withExt = docs.filter((d) => Object.keys(d.extensions).length > 0);
    if (withExt.length) {
      lines.push("## Extension fields", "");
      for (const d of withExt) {
        lines.push(`- **${d.key}**: ${Object.entries(d.extensions).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}

// ---- facades ----

export function buildManifestEntry(doc: Document, config: ResolvedConfig, input: ManifestEntryInput = {}): ManifestEntry {
  return new ManifestBuilder(config).entry(doc, input);
}

export function buildManifest(entries: readonly ManifestEntry[], options: ManifestOptions = {}): Manifest {
  return Manifest.create(entries, options);
}

export function buildUploadSheet(manifest: Manifest, options: UploadSheetOptions = {}): string {
  return new UploadSheetBuilder().build(manifest, options);
}
