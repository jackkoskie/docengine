// SPDX-License-Identifier: MPL-2.0
import * as vscode from "vscode";
import { Commands } from "./vscode/commands.js";
import { LanguageFeatures } from "./vscode/language-features.js";
import { ProjectRegistry, ProjectServices } from "./vscode/project-services.js";

const CONFIG_GLOB = "docengine.config.*";
const ASSET_GLOB = "**/*.{png,jpg,jpeg,svg}";

/** Extension entry point: builds one `ProjectServices` per workspace folder and wires editor events to them. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const projects = new ProjectRegistry();
  const collection = vscode.languages.createDiagnosticCollection("docengine");
  context.subscriptions.push(collection);

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const services = new ProjectServices(folder, collection);
    projects.add(services);
    context.subscriptions.push({ dispose: () => services.project.dispose() }, ...watch(services));
  }

  context.subscriptions.push(...new LanguageFeatures(projects).register(), ...new Commands(projects, context.extensionPath).register(), ...editorEvents(projects));
  await Promise.all(projects.all().map((p) => p.project.initialize()));
}

export function deactivate(): void {}

function watch(services: ProjectServices): vscode.Disposable[] {
  const { folder, project } = services;
  const fileOf = (uri: vscode.Uri): string => services.relative(uri);
  const docs = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*.md"));
  const config = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, CONFIG_GLOB));
  const assets = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, ASSET_GLOB));
  return [
    docs,
    config,
    assets,
    docs.onDidCreate((u) => project.fileChangedOnDisk(fileOf(u))),
    docs.onDidChange((u) => project.fileChangedOnDisk(fileOf(u))),
    docs.onDidDelete((u) => project.fileDeleted(fileOf(u))),
    config.onDidCreate(() => void project.reloadConfig()),
    config.onDidChange(() => void project.reloadConfig()),
    config.onDidDelete(() => void project.reloadConfig()),
    assets.onDidCreate(() => project.assetsChanged()),
    assets.onDidChange(() => project.assetsChanged()),
    assets.onDidDelete(() => project.assetsChanged()),
  ];
}

function editorEvents(projects: ProjectRegistry): vscode.Disposable[] {
  const w = vscode.workspace;
  return [
    w.onDidOpenTextDocument((d) => {
      const hit = projects.owner(d.uri);
      hit?.services.project.textChanged(hit.file);
    }),
    w.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      const hit = projects.owner(e.document.uri);
      hit?.services.project.textChanged(hit.file);
    }),
    w.onDidSaveTextDocument((d) => {
      const hit = projects.owner(d.uri);
      hit?.services.project.saved(hit.file);
    }),
    w.onDidCloseTextDocument((d) => {
      const hit = projects.owner(d.uri);
      hit?.services.project.fileChangedOnDisk(hit.file);
    }),
  ];
}
