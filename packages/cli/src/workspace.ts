// SPDX-License-Identifier: MPL-2.0
import { isAbsolute, join } from "node:path";
import {
  type Diagnostic,
  type Document,
  FileSystemHost,
  GitHistoryProvider,
  type HistoryProvider,
  type Host,
  type RepositoryEntry,
  type ResolvedConfig,
} from "@jackkoskie/docengine-core";
import type { Invocation } from "./command.js";
import type { Services } from "./services.js";

const CONFIG_NAMES = ["docengine.config.ts", "docengine.config.mts", "docengine.config.js", "docengine.config.mjs", "docengine.config.json"];

export interface Project {
  root: string;
  configFile: string | null;
  config: ResolvedConfig;
}

export const toPosix = (p: string): string => p.replaceAll("\\", "/");
export const absolute = (root: string, p: string): string => (isAbsolute(p) ? p : join(root, p));

/** Finds and loads `docengine.config.(ts|js|json)`. Defaults apply when no file exists. */
export class ProjectLoader {
  constructor(private readonly services: Pick<Services, "fs" | "importer" | "configLoader">) {}

  async load(root: string, explicit?: string): Promise<Project> {
    const { fs, importer, configLoader } = this.services;
    const configFile = explicit
      ? absolute(root, explicit)
      : (CONFIG_NAMES.map((n) => join(root, n)).find((p) => fs.exists(p)) ?? null);
    let raw: unknown = {};
    if (configFile) raw = configFile.endsWith(".json") ? JSON.parse(fs.readText(configFile)) : await importer.import(configFile);
    return { root, configFile, config: configLoader.load(raw) };
  }
}

export interface LoadedDocument extends RepositoryEntry {
  abs: string;
}

/** Reads and parses the project's Markdown documents. */
export class DocumentRepository {
  constructor(private readonly services: Pick<Services, "fs" | "parser">) {}

  load(project: Project, only: readonly string[] = []): LoadedDocument[] {
    const patterns = only.length ? only.map(toPosix) : [project.config.documents];
    const files = this.services.fs.glob(patterns, {
      cwd: project.root,
      ignore: ["**/node_modules/**", `${project.config.outDir}/**`],
    });
    return files.map((file) => {
      const abs = join(project.root, file);
      const doc: Document = this.services.parser.parse(this.services.fs.readText(abs), { file: toPosix(file), scheme: project.config.numbering });
      return { file: toPosix(file), abs, doc };
    });
  }
}

export interface WorkspaceOptions {
  /** Prepare git history (honouring `--base`) for change detection and diffs. */
  history?: boolean;
  /** Also run the history-aware validation rules (needs `history`). */
  gitRules?: boolean;
}

/** A loaded and validated project: the shared starting point for validate and build. */
export class Workspace {
  private constructor(
    readonly project: Project,
    readonly documents: LoadedDocument[],
    readonly diagnostics: Diagnostic[],
    readonly host: Host,
    /** Git history for `--base`/tags; null unless requested. */
    readonly history: HistoryProvider | null = null,
  ) {}

  /** The `--base` ref given on the command line, if any. */
  static baseRef(invocation: Pick<Invocation, "values">): string | null {
    const b = invocation.values.base;
    return typeof b === "string" && b !== "" ? b : null;
  }

  static async open(
    services: Services,
    invocation: Pick<Invocation, "cwd" | "config" | "positionals" | "values">,
    options: WorkspaceOptions = {},
  ): Promise<Workspace> {
    const project = await new ProjectLoader(services).load(invocation.cwd, invocation.config);
    const documents = new DocumentRepository(services).load(project, invocation.positionals);
    if (documents.length === 0) {
      services.io.err(`No documents matched ${invocation.positionals.length ? invocation.positionals.join(", ") : project.config.documents}`);
    }
    const host = new FileSystemHost(services.fs, services.hasher, project.root);
    let history: HistoryProvider | null = null;
    if (options.history) {
      const baseRef = Workspace.baseRef(invocation);
      if (baseRef !== null && !services.git.refExists(project.root, baseRef)) {
        throw new Error(`Base ref "${baseRef}" does not exist (is this a git repository, and has the ref been fetched?)`);
      }
      history = new GitHistoryProvider(services.git, services.parser, services.hasher, host, project.root, baseRef, project.config.numbering);
    }
    const diagnostics = services.validator.validateRepository(documents, {
      config: project.config,
      host,
      ...(history && options.gitRules ? { history } : {}),
    });
    return new Workspace(project, documents, diagnostics, host, history);
  }

  get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.isError);
  }

  summary(): string {
    const e = this.diagnostics.filter((d) => d.severity === "error").length;
    const w = this.diagnostics.filter((d) => d.severity === "warning").length;
    return `${this.documents.length} document(s), ${e} error(s), ${w} warning(s)`;
  }
}

/** Directory part of the documents glob before the first wildcard, e.g. `documents`. */
export function documentsRoot(config: Pick<ResolvedConfig, "documents">): string {
  const segs = toPosix(config.documents).split("/");
  const fixed: string[] = [];
  for (const s of segs) {
    if (/[*?{[]/.test(s)) break;
    fixed.push(s);
  }
  if (fixed.length === segs.length) fixed.pop(); // the pattern is a single file
  return fixed.join("/") || ".";
}

/** Turns `group/short` into `documents/group/short.md`; paths and globs pass through. */
export function resolveDocumentArg(config: Pick<ResolvedConfig, "documents">, arg: string): string {
  const a = toPosix(arg);
  if (/\.md$/i.test(a) || /[*?{[]/.test(a)) return a;
  const parts = a.split("/");
  return parts.length === 2 ? `${documentsRoot(config)}/${a}.md` : a;
}

/** Finds a document by repo-relative path or by `group/short` (or bare `short`). */
export function findDocument(documents: readonly LoadedDocument[], name: string): LoadedDocument | undefined {
  const n = toPosix(name);
  return documents.find((d) => d.file === n) ?? documents.find((d) => d.doc.matchesName(n));
}
