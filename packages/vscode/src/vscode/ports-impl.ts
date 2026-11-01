// SPDX-License-Identifier: MPL-2.0
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Hasher } from "@jackkoskie/docengine-core";
import * as vscode from "vscode";
import type {
  AssetReader,
  AssetUriResolver,
  ConfigFiles,
  DiagnosticSink,
  FileLister,
  FileOpener,
  ProcessResult,
  ProcessRunner,
  Scheduler,
  TextSource,
  UserPrompt,
} from "../ports.js";
import type { DiagnosticDto } from "../types.js";
import { toDiagnostic } from "./convert.js";

export const toPosix = (p: string): string => p.replaceAll("\\", "/");

/** Open editor buffers win over disk, so validation sees unsaved edits. */
export class EditorTextSource implements TextSource {
  constructor(private readonly root: string) {}

  read(file: string): string | undefined {
    const abs = join(this.root, file);
    const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && d.uri.fsPath === abs);
    if (open) return open.getText();
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  }
}

export class WorkspaceFileLister implements FileLister {
  constructor(private readonly folder: vscode.WorkspaceFolder) {}

  async list(glob: string): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder, glob), "**/node_modules/**");
    return uris.map((u) => toPosix(relative(this.folder.uri.fsPath, u.fsPath))).sort();
  }
}

export class CollectionDiagnosticSink implements DiagnosticSink {
  constructor(
    private readonly collection: vscode.DiagnosticCollection,
    private readonly root: string,
  ) {}

  set(file: string, diagnostics: readonly DiagnosticDto[]): void {
    this.collection.set(vscode.Uri.file(join(this.root, file)), diagnostics.map(toDiagnostic));
  }

  clear(file: string): void {
    this.collection.delete(vscode.Uri.file(join(this.root, file)));
  }
}

export class NodeAssetReader implements AssetReader {
  constructor(private readonly root: string) {}

  stat(file: string): { size: number; mtimeMs: number } | undefined {
    try {
      const s = statSync(join(this.root, file));
      return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : undefined;
    } catch {
      return undefined;
    }
  }

  read(file: string): Uint8Array {
    return readFileSync(join(this.root, file));
  }
}

export class NodeHasher implements Hasher {
  sha256(data: Uint8Array | string): string {
    return createHash("sha256").update(data).digest("hex");
  }
}

export class FileUriResolver implements AssetUriResolver {
  constructor(private readonly root: string) {}

  uriFor(file: string): string {
    return vscode.Uri.file(join(this.root, file)).toString();
  }
}

export class NodeConfigFiles implements ConfigFiles {
  private static readonly NAMES = ["docengine.config.json", "docengine.config.ts", "docengine.config.mts", "docengine.config.js", "docengine.config.mjs"];

  constructor(private readonly root: string) {}

  existing(): string[] {
    return NodeConfigFiles.NAMES.filter((n) => existsSync(join(this.root, n)));
  }

  read(name: string): string | undefined {
    try {
      return readFileSync(join(this.root, name), "utf8");
    } catch {
      return undefined;
    }
  }
}

/** Spawns processes. On Windows, uses a shell so `.cmd` shims such as `docengine` and `pnpm` resolve. */
export class NodeProcessRunner implements ProcessRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<ProcessResult> {
    const windows = process.platform === "win32";
    const quoted = windows ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)) : [...args];
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(command, quoted, { cwd, shell: windows, windowsHide: true });
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", () => resolve({ status: null, stdout, stderr }));
      child.on("close", (code) => resolve({ status: code, stdout, stderr }));
    });
  }
}

export class TimerScheduler implements Scheduler {
  schedule(callback: () => void, delayMs: number): { cancel(): void } {
    const handle = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(handle) };
  }
}

export class VsUserPrompt implements UserPrompt {
  async confirm(message: string, action: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;
  }

  info(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  error(message: string): void {
    void vscode.window.showErrorMessage(message);
  }
}

export class ExternalFileOpener implements FileOpener {
  async open(absolutePath: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.file(absolutePath));
  }
}
