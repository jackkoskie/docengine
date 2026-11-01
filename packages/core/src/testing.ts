// SPDX-License-Identifier: MPL-2.0
import type { Clock, FileInfo, FileSystem, GitClient, Hasher, Host, ProcessResult, TypstRunner } from "./ports.js";

// Core has no DOM/Node typings; these globals exist in every supported runtime.
declare class TextEncoder {
  encode(s: string): Uint8Array;
}
declare class TextDecoder {
  decode(b: Uint8Array): string;
}

const norm = (p: string): string => p.replaceAll("\\", "/").replace(/\/+$/, "");

function globToRegExp(glob: string): RegExp {
  const re = glob
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${re}$`);
}

/** In-memory `FileSystem` for tests. Paths are normalised to forward slashes. */
export class InMemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>();

  constructor(files: Record<string, string | Uint8Array> = {}) {
    for (const [p, c] of Object.entries(files)) this.writeBytes(p, typeof c === "string" ? new TextEncoder().encode(c) : c);
  }

  writeBytes(path: string, data: Uint8Array): void {
    this.files.set(norm(path), data);
  }
  readText(path: string): string {
    return new TextDecoder().decode(this.readBytes(path));
  }
  readBytes(path: string): Uint8Array {
    const f = this.files.get(norm(path));
    if (!f) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  writeText(path: string, content: string): void {
    this.writeBytes(path, new TextEncoder().encode(content));
  }
  exists(path: string): boolean {
    const p = norm(path);
    return this.files.has(p) || this.dirs.has(p);
  }
  isFile(path: string): boolean {
    return this.files.has(norm(path));
  }
  mkdirp(path: string): void {
    this.dirs.add(norm(path));
  }
  copyFile(from: string, to: string): void {
    this.writeBytes(to, this.readBytes(from));
  }
  glob(patterns: readonly string[], options: { cwd: string; ignore?: readonly string[] }): string[] {
    const cwd = norm(options.cwd) + "/";
    const include = patterns.map(globToRegExp);
    const ignore = (options.ignore ?? []).map(globToRegExp);
    return [...this.files.keys()]
      .filter((p) => p.startsWith(cwd))
      .map((p) => p.slice(cwd.length))
      .filter((p) => include.some((r) => r.test(p)) && !ignore.some((r) => r.test(p)))
      .sort();
  }
  /** Paths of every stored file (for assertions). */
  list(): string[] {
    return [...this.files.keys()].sort();
  }
}

export interface FakeGitHistory {
  /** Files per ref (branch, tag or SHA), repo-relative paths. */
  refs?: Record<string, Record<string, string | Uint8Array>>;
  tags?: string[];
}

/** In-memory `GitClient`. Tags are also refs: give a tag its files through `refs`. */
export class FakeGitClient implements GitClient {
  private readonly refs: Map<string, Map<string, Uint8Array>>;
  private readonly tags: string[];

  constructor(
    private readonly commit: string | null = null,
    history: FakeGitHistory = {},
  ) {
    this.refs = new Map();
    this.tags = [...(history.tags ?? [])];
    for (const [ref, files] of Object.entries(history.refs ?? {})) this.setRef(ref, files);
  }

  setRef(ref: string, files: Record<string, string | Uint8Array>): this {
    const m = new Map<string, Uint8Array>();
    for (const [p, c] of Object.entries(files)) m.set(norm(p), typeof c === "string" ? new TextEncoder().encode(c) : c);
    this.refs.set(ref, m);
    return this;
  }

  addTag(tag: string, files?: Record<string, string | Uint8Array>): this {
    this.tags.push(tag);
    if (files) this.setRef(tag, files);
    return this;
  }

  headCommit(): string | null {
    return this.commit;
  }
  refExists(_cwd: string, ref: string): boolean {
    return this.refs.has(ref) || this.tags.includes(ref);
  }
  readFileAt(_cwd: string, ref: string, path: string): Uint8Array | null {
    return this.refs.get(ref)?.get(norm(path)) ?? null;
  }
  listTags(_cwd: string, prefix: string): string[] {
    return this.tags.filter((t) => t.startsWith(prefix));
  }
}

/** Clock fixed to one date. */
export class FixedClock implements Clock {
  constructor(private date = "2025-01-01") {}
  today(): string {
    return this.date;
  }
  set(date: string): void {
    this.date = date;
  }
}
/** Deterministic non-cryptographic stand-in producing 64 hex characters. */
export class FakeHasher implements Hasher {
  sha256(data: Uint8Array | string): string {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    let h = 2166136261;
    for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
    return h.toString(16).padStart(8, "0").repeat(8);
  }
}

/** Fake Typst: records calls and, on `compile`, writes a stub PDF through the supplied file system. */
export class FakeTypstRunner implements TypstRunner {
  readonly calls: string[][] = [];

  constructor(
    private readonly options: { available?: boolean; fs?: FileSystem; failCompile?: boolean } = {},
  ) {}

  run(args: readonly string[]): ProcessResult {
    this.calls.push([...args]);
    if (this.options.available === false) return { status: null, stdout: "", stderr: "not found" };
    if (args[0] === "--version") return { status: 0, stdout: "typst fake 0.0.0\n", stderr: "" };
    if (args[0] === "compile") {
      if (this.options.failCompile) return { status: 1, stdout: "", stderr: "fake compile error" };
      this.options.fs?.writeText(args[args.length - 1]!, "%PDF-fake");
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unknown command" };
  }
}

/** In-memory `Host` keyed by repo-relative path. */
export class InMemoryHost implements Host {
  constructor(private readonly files: Record<string, { size: number; width?: number; height?: number; sha256?: string }> = {}) {}
  inspectFile(path: string): FileInfo | undefined {
    const f = this.files[path];
    return f ? { ...f, sha256: f.sha256 ?? "0".repeat(64) } : undefined;
  }
}
