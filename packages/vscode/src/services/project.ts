// SPDX-License-Identifier: MPL-2.0
import { WorkspaceIndex } from "../index/workspace-index.js";
import type { DiagnosticSink, FileLister, Scheduler, TextSource } from "../ports.js";
import { Debouncer } from "./debouncer.js";
import { DiagnosticsService, type ValidationSettings, type ValidationSummary } from "./diagnostics-service.js";
import { GlobMatcher } from "./glob.js";
import type { ProjectConfig } from "./project-config.js";

export interface ProjectDeps {
  index: WorkspaceIndex;
  texts: TextSource;
  lister: FileLister;
  scheduler: Scheduler;
  debounceMs: () => number;
  /** Builds the diagnostics service for this project's settings. */
  diagnostics: (settings: () => ValidationSettings) => DiagnosticsService;
  loadConfig: () => ProjectConfig;
  /** Overrides the config's document glob when non-empty. */
  documentGlobOverride: () => string;
}

/**
 * One docengine project (a workspace folder): keeps the index in sync with the editor and the file
 * system, and schedules validation. This is the single entry point the VS Code glue talks to.
 */
export class Project {
  readonly index: WorkspaceIndex;
  private config: ProjectConfig;
  private matcher: GlobMatcher;
  private readonly diagnostics: DiagnosticsService;
  private readonly debouncer: Debouncer;

  constructor(private readonly deps: ProjectDeps) {
    this.index = deps.index;
    this.config = deps.loadConfig();
    this.matcher = new GlobMatcher(this.glob());
    this.diagnostics = deps.diagnostics(() => this.config);
    this.debouncer = new Debouncer(deps.scheduler, deps.debounceMs, () => this.diagnostics.validateAll());
  }

  get current(): ProjectConfig {
    return this.config;
  }

  private glob(): string {
    return this.deps.documentGlobOverride() || this.config.config.documents;
  }

  isDocument(file: string): boolean {
    return this.matcher.matches(file);
  }

  /** Initial scan of every document. */
  async initialize(): Promise<ValidationSummary> {
    const files = await this.deps.lister.list(this.glob());
    for (const f of files) this.load(f);
    return this.diagnostics.validateAll();
  }

  /** Re-reads `docengine.config.*` and re-indexes everything. */
  async reloadConfig(): Promise<ValidationSummary> {
    this.config = this.deps.loadConfig();
    this.matcher = new GlobMatcher(this.glob());
    for (const f of this.index.files()) this.index.remove(f);
    return this.initialize();
  }

  /** Editor buffer changed: re-parse immediately (providers need fresh data), validate after the debounce. */
  textChanged(file: string): void {
    if (!this.isDocument(file) || !this.load(file)) return;
    this.debouncer.trigger();
  }

  /** Saved: validate immediately. */
  saved(file: string): void {
    if (!this.isDocument(file) || !this.load(file)) return;
    this.debouncer.flush();
  }

  /** File watcher event for a created or changed file. */
  fileChangedOnDisk(file: string): void {
    this.textChanged(file);
  }

  fileDeleted(file: string): void {
    if (this.index.remove(file)) this.debouncer.trigger();
  }

  /** An image or other asset changed: figure checks may now differ. */
  assetsChanged(): void {
    this.debouncer.trigger();
  }

  /** Validate everything now (command). */
  validateWorkspace(): ValidationSummary {
    return this.diagnostics.validateAll();
  }

  dispose(): void {
    this.debouncer.dispose();
  }

  private load(file: string): boolean {
    const text = this.deps.texts.read(file);
    if (text === undefined) {
      this.index.remove(file);
      return false;
    }
    this.index.update(file, text, this.config.config.numbering);
    return true;
  }
}
