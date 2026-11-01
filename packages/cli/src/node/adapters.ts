// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "tinyglobby";
import {
  DefaultConfigLoader,
  MarkdownParser,
  UploadSheetBuilder,
  Validator,
  type Clock,
  type FileSystem,
  type GitClient,
  type Hasher,
  type ProcessResult,
  type TypstRunner,
} from "@jackkoskie/docengine-core";
import type { FileWatcher, ModuleImporter, Io, Services, WatchOptions, WatchSession } from "../services.js";

export class NodeFileSystem implements FileSystem {
  readText(path: string): string {
    return readFileSync(path, "utf8");
  }
  readBytes(path: string): Uint8Array {
    return readFileSync(path);
  }
  writeText(path: string, content: string): void {
    writeFileSync(path, content);
  }
  exists(path: string): boolean {
    return existsSync(path);
  }
  isFile(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }
  mkdirp(path: string): void {
    mkdirSync(path, { recursive: true });
  }
  copyFile(from: string, to: string): void {
    copyFileSync(from, to);
  }
  glob(patterns: readonly string[], options: { cwd: string; ignore?: readonly string[] }): string[] {
    return globSync([...patterns], { cwd: options.cwd, onlyFiles: true, ignore: [...(options.ignore ?? [])] }).sort();
  }
}

export class NodeGitClient implements GitClient {
  headCommit(cwd: string): string | null {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  }
  refExists(cwd: string, ref: string): boolean {
    const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd, encoding: "utf8" });
    return r.status === 0;
  }
  readFileAt(cwd: string, ref: string, path: string): Uint8Array | null {
    const r = spawnSync("git", ["show", `${ref}:./${path}`], { cwd, maxBuffer: 256 * 1024 * 1024 });
    return r.status === 0 ? new Uint8Array(r.stdout) : null;
  }
  listTags(cwd: string, prefix: string): string[] {
    const r = spawnSync("git", ["tag", "--list", `${prefix}*`], { cwd, encoding: "utf8" });
    return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
  }
}

export class SystemClock implements Clock {
  today(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}

/**
 * `FileWatcher` over `fs.watch` (recursive). Events are debounced per file so editors that write
 * a file several times trigger one rebuild.
 */
export class FsFileWatcher implements FileWatcher {
  constructor(private readonly debounceMs = 150) {}

  watch(options: WatchOptions, onChange: (file: string) => void): WatchSession {
    const watchers: FSWatcher[] = [];
    const timers = new Map<string, NodeJS.Timeout>();
    let resolveClosed!: () => void;
    const closed = new Promise<void>((r) => (resolveClosed = r));
    const ignore = options.ignore ?? [];
    const emit = (file: string) => {
      if (ignore.some((p) => file === p || file.startsWith(p + sep))) return;
      clearTimeout(timers.get(file));
      timers.set(
        file,
        setTimeout(() => {
          timers.delete(file);
          onChange(file);
        }, this.debounceMs),
      );
    };
    for (const root of options.paths) {
      if (!existsSync(root)) continue;
      const isDir = statSync(root).isDirectory();
      watchers.push(
        watch(root, { recursive: isDir }, (_event, name) => {
          emit(isDir ? (name ? join(root, String(name)) : root) : root);
        }),
      );
    }
    const stop = () => {
      for (const w of watchers) w.close();
      for (const t of timers.values()) clearTimeout(t);
      process.off("SIGINT", stop);
      resolveClosed();
    };
    process.once("SIGINT", stop);
    return { closed, close: stop };
  }
}

export class NodeHasher implements Hasher {
  sha256(data: Uint8Array | string): string {
    return createHash("sha256").update(data).digest("hex");
  }
}

/** Runs a real `typst` executable. */
export class ProcessTypstRunner implements TypstRunner {
  constructor(private readonly bin: string) {}
  run(args: readonly string[]): ProcessResult {
    const r = spawnSync(this.bin, [...args], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
}

/** Loads `.ts`/`.js` config modules through jiti. */
export class JitiModuleImporter implements ModuleImporter {
  async import(path: string): Promise<unknown> {
    const { createJiti } = await import("jiti");
    const { pathToFileURL } = await import("node:url");
    const jiti = createJiti(pathToFileURL(path).href, { interopDefault: true });
    return jiti.import(path, { default: true });
  }
}

function readEngineVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return (JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** Finds the bundled default letterhead (packaged copy first, then the repo-level source). */
function locateDefaultTemplate(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "..", "templates"), join(here, "..", "..", "..", "..", "templates")];
  for (const dir of candidates) {
    const p = join(dir, "default-letterhead.typ");
    if (existsSync(p)) return p;
  }
  throw new Error("Could not locate templates/default-letterhead.typ");
}

/** Composition root: the real Node implementations. */
export function createNodeServices(io: Io): Services {
  return {
    io,
    fs: new NodeFileSystem(),
    git: new NodeGitClient(),
    clock: new SystemClock(),
    watcher: new FsFileWatcher(),
    hasher: new NodeHasher(),
    importer: new JitiModuleImporter(),
    parser: new MarkdownParser(),
    validator: Validator.standard(),
    configLoader: new DefaultConfigLoader(),
    uploadSheet: new UploadSheetBuilder(),
    typstRunnerFor: (bin) => new ProcessTypstRunner(bin),
    engineVersion: readEngineVersion(),
    get defaultTemplate() {
      return locateDefaultTemplate();
    },
  };
}
