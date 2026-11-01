// SPDX-License-Identifier: MPL-2.0
import {
  DefaultConfigLoader,
  FakeGitClient,
  FakeHasher,
  FakeTypstRunner,
  FixedClock,
  InMemoryFileSystem,
  MarkdownParser,
  UploadSheetBuilder,
  Validator,
} from "@jackkoskie/docengine-core";
import type { FileWatcher, Services, WatchOptions, WatchSession } from "../src/services.js";

/** File watcher the test drives by hand. */
export class FakeFileWatcher implements FileWatcher {
  readonly sessions: { options: WatchOptions; trigger: (file: string) => void; close: () => void }[] = [];
  private onSession: (() => void) | null = null;

  watch(options: WatchOptions, onChange: (file: string) => void): WatchSession {
    let resolve!: () => void;
    const closed = new Promise<void>((r) => (resolve = r));
    const ignore = options.ignore ?? [];
    this.sessions.push({
      options,
      trigger: (file) => {
        if (!ignore.some((p) => file.startsWith(p))) onChange(file);
      },
      close: resolve,
    });
    this.onSession?.();
    return { closed, close: resolve };
  }

  /** Resolves once a watch has been started. */
  started(): Promise<void> {
    if (this.sessions.length) return Promise.resolve();
    return new Promise((r) => (this.onSession = r));
  }
}

export const DOC = `---
title: Fake Policy
short: fake
group: ops
version: "1.0"
effectiveDate: 2024-01-15
---

[100.01] Scope

[100.01(1)] See [[fig:f]].

![Fig](images/f.svg){#fig:f}
`;

export interface SetupOptions {
  files?: Record<string, string>;
  git?: FakeGitClient;
  typst?: boolean;
}

export function setup(opts: SetupOptions = {}) {
  const fs = new InMemoryFileSystem({
    "/proj/docengine.config.json": "{}",
    "/proj/documents/ops/fake.md": DOC,
    "/proj/documents/ops/images/f.svg": "<svg/>",
    "/tpl/default-letterhead.typ": "// template",
    ...(opts.files ?? {}),
  });
  const out: string[] = [];
  const err: string[] = [];
  const typst = new FakeTypstRunner({ fs, available: opts.typst ?? true });
  const git = opts.git ?? new FakeGitClient("deadbeef");
  const watcher = new FakeFileWatcher();
  const clock = new FixedClock("2025-03-04");
  const services: Services = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    fs,
    git,
    clock,
    watcher,
    hasher: new FakeHasher(),
    importer: { import: async () => ({}) },
    parser: new MarkdownParser(),
    validator: Validator.standard(),
    configLoader: new DefaultConfigLoader(),
    uploadSheet: new UploadSheetBuilder(),
    typstRunnerFor: () => typst,
    engineVersion: "9.9.9",
    defaultTemplate: "/tpl/default-letterhead.typ",
  };
  return { fs, services, out, err, typst, git, watcher, clock };
}

export const inv = (positionals: string[] = [], values: Record<string, string | boolean> = {}) => ({
  cwd: "/proj",
  positionals,
  values,
});
