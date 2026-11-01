// SPDX-License-Identifier: MPL-2.0
import type { ResolvedConfig } from "../config/config.js";
import type { DiagnosticCollector, Position } from "../model/diagnostic.js";
import type { Document } from "../model/document.js";
import type { HistoryProvider } from "../git/history.js";
import type { Host } from "../ports.js";

export interface RepositoryEntry {
  /** Path relative to the repo root, forward slashes, e.g. documents/operations/departure-release.md */
  file: string;
  doc: Document;
}

/** Everything a rule may look at. Rules report through `report` and never mutate anything else. */
export interface RuleContext {
  readonly doc: Document;
  readonly config: ResolvedConfig;
  readonly report: DiagnosticCollector;
  /** File path used for asset resolution and diagnostics (repo-relative when known). */
  readonly file: string | undefined;
  readonly host: Host | undefined;
  /** Other documents in the repo; undefined when validating a document alone. */
  readonly documents: readonly Document[] | undefined;
  /** All repository entries, only set for repository validation. */
  readonly repository: readonly RepositoryEntry[] | undefined;
  /** Git history of the repository; undefined unless history-aware checks were requested. */
  readonly history?: HistoryProvider | undefined;
}

/**
 * One validation concern. Add a rule by implementing this interface and registering it with
 * the `Validator`; existing rules never need editing.
 */
export interface Rule {
  readonly name: string;
  check(ctx: RuleContext): void;
}

export type { Position };
