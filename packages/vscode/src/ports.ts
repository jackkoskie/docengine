// SPDX-License-Identifier: MPL-2.0
import type { DiagnosticDto } from "./types.js";

/** Reads document text. The VS Code implementation prefers unsaved editor buffers over disk. */
export interface TextSource {
  /** Text of a workspace-relative file, or undefined when it cannot be read. */
  read(file: string): string | undefined;
}

/** Lists workspace files matching a glob (workspace-relative, forward-slash paths). */
export interface FileLister {
  list(glob: string): Promise<string[]>;
}

/** Receives validation results. One call per file replaces that file's diagnostics. */
export interface DiagnosticSink {
  set(file: string, diagnostics: readonly DiagnosticDto[]): void;
  clear(file: string): void;
}

/** Binary reads and stat for assets (figure files). */
export interface AssetReader {
  stat(file: string): { size: number; mtimeMs: number } | undefined;
  read(file: string): Uint8Array;
}

/** Turns a workspace-relative asset path into a URI string usable in hover markdown. */
export interface AssetUriResolver {
  uriFor(file: string): string;
}

export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs an external command. */
export interface ProcessRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<ProcessResult>;
}

/** Schedules a callback, cancellable. Lets the debouncer be tested with a manual clock. */
export interface Scheduler {
  schedule(callback: () => void, delayMs: number): { cancel(): void };
}

/** User interaction used by commands and rename. */
export interface UserPrompt {
  confirm(message: string, action: string): Promise<boolean>;
  info(message: string): void;
  error(message: string): void;
}

/** Opens a generated file (PDF) for the user. */
export interface FileOpener {
  open(absolutePath: string): Promise<void>;
}

/** Reads config file text for the project root. */
export interface ConfigFiles {
  /** Names of docengine.config.* files that exist, in priority order. */
  existing(): string[];
  read(name: string): string | undefined;
}
