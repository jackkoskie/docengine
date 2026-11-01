// SPDX-License-Identifier: MPL-2.0
/**
 * Ports: everything core needs from the outside world. Implementations live in the CLI
 * (Node) or in `testing.ts` (in-memory fakes). Core itself never touches the OS.
 */

export interface FileInfo {
  size: number;
  sha256: string;
  /** Pixel dimensions for raster images, when known. */
  width?: number;
  height?: number;
}

/** Read-only asset view used by validation. Paths use forward slashes, relative to the repo root. */
export interface Host {
  inspectFile(path: string): FileInfo | undefined;
}

export interface Hasher {
  sha256(data: Uint8Array | string): string;
}

export interface FileSystem {
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  writeText(path: string, content: string): void;
  exists(path: string): boolean;
  isFile(path: string): boolean;
  mkdirp(path: string): void;
  copyFile(from: string, to: string): void;
  /** Matches relative to `cwd`; returns forward-slash paths relative to `cwd`. */
  glob(patterns: readonly string[], options: { cwd: string; ignore?: readonly string[] }): string[];
}

export interface GitClient {
  /** HEAD commit SHA, or null when not a git repo / git unavailable. */
  headCommit(cwd: string): string | null;
  /** Does `ref` (branch, tag, SHA) resolve to a commit? */
  refExists(cwd: string, ref: string): boolean;
  /** File content at `ref`; `path` is repo-relative with forward slashes. Null when absent. */
  readFileAt(cwd: string, ref: string, path: string): Uint8Array | null;
  /** Names of tags starting with `prefix`. */
  listTags(cwd: string, prefix: string): string[];
}

/** Source of "today" so date-dependent commands are deterministic in tests. */
export interface Clock {
  /** Current date as `YYYY-MM-DD`. */
  today(): string;
}

export interface ProcessResult {
  /** Exit status, or null when the process could not be started. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the Typst executable with arguments. */
export interface TypstRunner {
  run(args: readonly string[]): ProcessResult;
}
