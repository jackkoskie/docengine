// SPDX-License-Identifier: MPL-2.0
import { relative } from "node:path";
import { extensionKeys, MarkdownParser } from "@jackkoskie/docengine-core";
import * as vscode from "vscode";
import { WorkspaceIndex } from "../index/workspace-index.js";
import { CodeActionProvider } from "../providers/code-actions.js";
import { CompletionProvider } from "../providers/completion.js";
import { HoverProvider } from "../providers/hover.js";
import { NavigationProvider } from "../providers/navigation.js";
import { RenameService } from "../providers/rename.js";
import { FoldingProvider, OutlineProvider, SemanticTokensProvider } from "../providers/structure.js";
import { CachingAssetHost } from "../services/asset-host.js";
import { DiagnosticsService } from "../services/diagnostics-service.js";
import { SchemaModeline } from "../services/modeline.js";
import { PdfPreviewService } from "../services/pdf-preview.js";
import { Project } from "../services/project.js";
import { ProjectConfigLoader } from "../services/project-config.js";
import { GitPublishedIds } from "../services/published-ids.js";
import {
  CollectionDiagnosticSink,
  EditorTextSource,
  ExternalFileOpener,
  FileUriResolver,
  NodeAssetReader,
  NodeConfigFiles,
  NodeHasher,
  NodeProcessRunner,
  TimerScheduler,
  VsUserPrompt,
  WorkspaceFileLister,
  toPosix,
} from "./ports-impl.js";

/** Everything the extension needs for one workspace folder, wired together (composition root for a project). */
export class ProjectServices {
  readonly root: string;
  readonly project: Project;
  readonly completion: CompletionProvider;
  readonly hover: HoverProvider;
  readonly navigation: NavigationProvider;
  readonly rename: RenameService;
  readonly outline: OutlineProvider;
  readonly folding: FoldingProvider;
  readonly semantic: SemanticTokensProvider;
  readonly codeActions: CodeActionProvider;
  readonly preview: PdfPreviewService;
  readonly modeline = new SchemaModeline();
  readonly prompt = new VsUserPrompt();

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    collection: vscode.DiagnosticCollection,
  ) {
    const root = (this.root = folder.uri.fsPath);
    const settings = () => vscode.workspace.getConfiguration("docengine", folder.uri);
    const index = new WorkspaceIndex();
    const configLoader = new ProjectConfigLoader(new NodeConfigFiles(root));
    const runner = new NodeProcessRunner();
    const host = new CachingAssetHost(new NodeAssetReader(root), new NodeHasher());

    this.project = new Project({
      index,
      texts: new EditorTextSource(root),
      lister: new WorkspaceFileLister(folder),
      scheduler: new TimerScheduler(),
      debounceMs: () => settings().get<number>("validation.debounceMs", 150),
      diagnostics: (s) => new DiagnosticsService(index, s, host, new CollectionDiagnosticSink(collection, root)),
      loadConfig: () => configLoader.load(),
      documentGlobOverride: () => settings().get<string>("documents", ""),
    });

    const config = () => this.project.current.config;
    this.completion = new CompletionProvider(index, { extensionKeys: () => extensionKeys(config().extensions) });
    this.hover = new HoverProvider(index, new FileUriResolver(root), () => config().images.label);
    this.navigation = new NavigationProvider(index);
    this.rename = new RenameService(index, new GitPublishedIds(runner, root, new MarkdownParser(), () => config().numbering));
    this.outline = new OutlineProvider(index);
    this.folding = new FoldingProvider(index);
    this.semantic = new SemanticTokensProvider(index);
    this.codeActions = new CodeActionProvider(index);
    this.preview = new PdfPreviewService(
      index,
      runner,
      new ExternalFileOpener(),
      this.prompt,
      root,
      () => settings().get<string>("cli.command", "docengine"),
      () => config().outDir,
    );
  }

  get index(): WorkspaceIndex {
    return this.project.index;
  }

  /** Workspace-relative path of a file URI. */
  relative(uri: vscode.Uri): string {
    return toPosix(relative(this.root, uri.fsPath));
  }

  contains(uri: vscode.Uri): boolean {
    const rel = this.relative(uri);
    return uri.scheme === "file" && !rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel);
  }
}

/** All projects, with URI lookup. */
export class ProjectRegistry {
  private readonly items: ProjectServices[] = [];

  add(p: ProjectServices): void {
    this.items.push(p);
  }

  all(): readonly ProjectServices[] {
    return this.items;
  }

  /** The project owning a URI, with the file's workspace-relative path, if it is one of its documents. */
  resolve(uri: vscode.Uri): { services: ProjectServices; file: string } | undefined {
    for (const services of this.items) {
      if (!services.contains(uri)) continue;
      const file = services.relative(uri);
      if (services.index.has(file)) return { services, file };
    }
    return undefined;
  }

  /** Like `resolve`, but also for files that match the document glob and are not indexed yet. */
  owner(uri: vscode.Uri): { services: ProjectServices; file: string } | undefined {
    for (const services of this.items) {
      if (!services.contains(uri)) continue;
      const file = services.relative(uri);
      if (services.project.isDocument(file)) return { services, file };
    }
    return undefined;
  }
}
