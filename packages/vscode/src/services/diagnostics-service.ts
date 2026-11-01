// SPDX-License-Identifier: MPL-2.0
import { type Diagnostic, type DocumentValidator, type Host, type ResolvedConfig, Validator } from "@jackkoskie/docengine-core";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import type { DiagnosticSink } from "../ports.js";
import { type DiagnosticDto, rangeOf } from "../types.js";

export interface ValidationSettings {
  config: ResolvedConfig;
  extensionsKnown: boolean;
}

export interface ValidationSummary {
  documents: number;
  errors: number;
  warnings: number;
}

/**
 * Runs the same `Validator` as the CLI over every indexed document (so cross-document references and
 * repository rules apply) and publishes the results per file.
 */
export class DiagnosticsService {
  private published = new Set<string>();

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly settings: () => ValidationSettings,
    private readonly host: Host,
    private readonly sink: DiagnosticSink,
    private readonly validator: DocumentValidator = Validator.standard(),
  ) {}

  validateAll(): ValidationSummary {
    const { config, extensionsKnown } = this.settings();
    const entries = this.index.all().map((d) => ({ file: d.file, doc: d.doc }));
    const found = this.validator.validateRepository(entries, { config, host: this.host });
    const byFile = new Map<string, DiagnosticDto[]>(entries.map((e) => [e.file, []]));
    let errors = 0;
    let warnings = 0;
    for (const d of found) {
      if (!extensionsKnown && d.code === "unknown-frontmatter-key") continue;
      const file = d.file ?? "";
      const list = byFile.get(file);
      if (!list) continue;
      list.push(this.toDto(d));
      if (d.severity === "error") errors++;
      else if (d.severity === "warning") warnings++;
    }
    for (const [file, list] of byFile) this.sink.set(file, list);
    for (const old of this.published) if (!byFile.has(old)) this.sink.clear(old);
    this.published = new Set(byFile.keys());
    return { documents: entries.length, errors, warnings };
  }

  private toDto(d: Diagnostic): DiagnosticDto {
    return { range: rangeOf(d.position), severity: d.severity, code: d.code, message: d.message };
  }
}
