// SPDX-License-Identifier: MPL-2.0
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import * as vscode from "vscode";
import type { ProjectRegistry, ProjectServices } from "./project-services.js";
import { toPosix } from "./ports-impl.js";
import { toWorkspaceEdit } from "./convert.js";

/** The `docengine:` commands. */
export class Commands {
  constructor(
    private readonly projects: ProjectRegistry,
    private readonly extensionPath: string,
  ) {}

  register(): vscode.Disposable[] {
    const c = vscode.commands;
    return [
      c.registerCommand("docengine.buildPreview", () => this.buildPreview()),
      c.registerCommand("docengine.validateWorkspace", () => this.validateWorkspace()),
      c.registerCommand("docengine.insertSchemaModeline", () => this.insertModeline()),
    ];
  }

  private async buildPreview(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const hit = editor && this.projects.resolve(editor.document.uri);
    if (!hit) {
      void vscode.window.showWarningMessage("Open a document under your docengine documents folder to build a preview.");
      return;
    }
    await editor.document.save();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "docengine: building PDF preview…" }, () =>
      hit.services.preview.build(hit.file),
    );
  }

  private validateWorkspace(): void {
    const all = this.projects.all();
    if (all.length === 0) {
      void vscode.window.showInformationMessage("docengine: no documents found in this workspace.");
      return;
    }
    for (const p of all) {
      const s = p.project.validateWorkspace();
      void vscode.window.showInformationMessage(`docengine: ${s.documents} document(s), ${s.errors} error(s), ${s.warnings} warning(s)`);
    }
  }

  private async insertModeline(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const hit = editor && this.projects.resolve(editor.document.uri);
    if (!hit) return;
    const edit = hit.services.modeline.edit(hit.services.index.get(hit.file)!, this.schemaRef(hit.services, editor.document.uri));
    if (!edit) {
      void vscode.window.showInformationMessage("docengine: no frontmatter, or a schema modeline is already present.");
      return;
    }
    await vscode.workspace.applyEdit(toWorkspaceEdit(hit.services.root, [edit]));
  }

  /** The workspace's own generated schema when it has one, else the copy bundled with the extension. */
  private schemaRef(services: ProjectServices, doc: vscode.Uri): string {
    const local = join(services.root, "schema", "frontmatter.schema.json");
    if (existsSync(local)) return toPosix(relative(join(doc.fsPath, ".."), local));
    return vscode.Uri.file(join(this.extensionPath, "schema", "frontmatter.schema.json")).toString();
  }
}
