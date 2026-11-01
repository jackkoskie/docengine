// SPDX-License-Identifier: MPL-2.0
import type {
  Clock,
  ConfigLoader,
  DocumentValidator,
  FileSystem,
  GitClient,
  Hasher,
  Parser,
  TypstRunner,
  UploadSheetRenderer,
} from "@jackkoskie/docengine-core";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Loads a TS/JS config module and returns its default export. */
export interface ModuleImporter {
  import(path: string): Promise<unknown>;
}

export interface WatchOptions {
  /** Absolute directory or file paths to watch. */
  paths: readonly string[];
  /** Absolute path prefixes whose changes are ignored (e.g. the output directory). */
  ignore?: readonly string[];
}

/** A running watch. `closed` settles once `close()` has been called. */
export interface WatchSession {
  readonly closed: Promise<void>;
  close(): void;
}

/** Reports changed files (absolute paths). Debouncing is the implementation's job. */
export interface FileWatcher {
  watch(options: WatchOptions, onChange: (file: string) => void): WatchSession;
}

/**
 * Everything the commands depend on. The composition root (`createNodeServices`) wires the real
 * implementations; tests pass in-memory fakes.
 */
export interface Services {
  io: Io;
  fs: FileSystem;
  git: GitClient;
  clock: Clock;
  watcher: FileWatcher;
  hasher: Hasher;
  importer: ModuleImporter;
  parser: Parser;
  validator: DocumentValidator;
  configLoader: ConfigLoader;
  uploadSheet: UploadSheetRenderer;
  /** Creates a runner for the given Typst executable (`--typst` overrides the default `typst`). */
  typstRunnerFor(bin: string): TypstRunner;
  engineVersion: string;
  /** Absolute path of the bundled default letterhead. */
  defaultTemplate: string;
}
