// SPDX-License-Identifier: MPL-2.0
import type { ResolvedConfig } from "../config/config.js";
import { Diagnostic, DiagnosticCollector } from "../model/diagnostic.js";
import type { Document } from "../model/document.js";
import type { HistoryProvider } from "../git/history.js";
import type { Host } from "../ports.js";
import { findRemovedProvisionIds } from "./removed-ids.js";
import type { Rule, RepositoryEntry, RuleContext } from "./rule.js";
import { RemovedIdsRule, VersionBumpRule, VersionAfterTagRule } from "./rules/git-rules.js";
import { DivisionConsistencyRule, ProvisionIdFormatRule, ProvisionParentRule, ProvisionOrderRule, DuplicateProvisionRule, EmptyTitleRule, HasProvisionsRule, MisplacedTitleMarkerRule } from "./rules/provision-rules.js";
import { FootnoteDefinitionRule, FootnoteReferenceRule } from "./rules/footnote-rules.js";
import { FigureDeclarationRule, FigureFileRule } from "./rules/figure-rules.js";
import { CoverFieldsRule, FrontmatterDateRule, FrontmatterSchemaRule } from "./rules/frontmatter-rules.js";
import { ReferenceRule } from "./rules/reference-rule.js";
import { PathMatchesFrontmatterRule, UniqueShortRule } from "./rules/repository-rules.js";

export interface ValidationOptions {
  config: ResolvedConfig;
  host?: Host;
  /** Other documents in the repo, enabling cross-document reference checks. */
  documents?: readonly Document[];
  /** Git knowledge enabling the history-aware rules; they do nothing without it. */
  history?: HistoryProvider;
}

/** Validates documents by running a list of `Rule`s. */
export interface DocumentValidator {
  validate(doc: Document, options: ValidationOptions & { file?: string }): Diagnostic[];
  validateRepository(entries: readonly RepositoryEntry[], options: ValidationOptions): Diagnostic[];
}

export class Validator implements DocumentValidator {
  constructor(private readonly rules: readonly Rule[]) {}

  /** The built-in rule set. Pass extra rules to extend it. */
  static standard(extra: readonly Rule[] = []): Validator {
    return new Validator([
      new FrontmatterSchemaRule(),
      new FrontmatterDateRule(),
      new CoverFieldsRule(),
      new HasProvisionsRule(),
      new ProvisionIdFormatRule(),
      new DuplicateProvisionRule(),
      new ProvisionParentRule(),
      new ProvisionOrderRule(),
      new DivisionConsistencyRule(),
      new EmptyTitleRule(),
      new MisplacedTitleMarkerRule(),
      new ReferenceRule(),
      new FootnoteReferenceRule(),
      new FootnoteDefinitionRule(),
      new FigureDeclarationRule(),
      new FigureFileRule(),
      new PathMatchesFrontmatterRule(),
      new UniqueShortRule(),
      new VersionBumpRule(),
      new VersionAfterTagRule(),
      new RemovedIdsRule(),
      ...extra,
    ]);
  }

  /** Syntax diagnostics from the parser plus every rule's findings, ordered by position. */
  validate(doc: Document, options: ValidationOptions & { file?: string }): Diagnostic[] {
    return this.run({
      doc,
      config: options.config,
      host: options.host,
      documents: options.documents,
      history: options.history,
      file: options.file ?? doc.file,
      repository: undefined,
    });
  }

  validateRepository(entries: readonly RepositoryEntry[], options: ValidationOptions): Diagnostic[] {
    const documents = entries.map((e) => e.doc);
    return entries.flatMap(({ file, doc }) =>
      this.run({ doc, config: options.config, host: options.host, documents, history: options.history, file, repository: entries }),
    );
  }

  private run(base: Omit<RuleContext, "report">): Diagnostic[] {
    const report = new DiagnosticCollector(base.file);
    const ctx: RuleContext = { ...base, report };
    for (const rule of this.rules) rule.check(ctx);
    const all = [...base.doc.diagnostics.map((d) => (d.file === undefined && base.file ? d.withFile(base.file) : d)), ...report.items];
    return all
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d.position.line - b.d.position.line || a.d.position.column - b.d.position.column || a.i - b.i)
      .map((x) => x.d);
  }
}

export interface ValidateContext extends ValidationOptions {}

/** Facade: validate one document with the standard rules. */
export function validate(doc: Document, ctx: ValidateContext): Diagnostic[] {
  return Validator.standard().validate(doc, ctx);
}

/** Facade: repo-level checks plus per-document validation with cross-document resolution. */
export function validateRepository(entries: readonly RepositoryEntry[], ctx: ValidateContext): Diagnostic[] {
  return Validator.standard().validateRepository(entries, ctx);
}

export { findRemovedProvisionIds };
