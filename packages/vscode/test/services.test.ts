// SPDX-License-Identifier: MPL-2.0
import { FakeHasher, InMemoryFileSystem, loadConfig, type Host } from "@jackkoskie/docengine-core";
import { describe, expect, it } from "vitest";
import { WorkspaceIndex } from "../src/index/workspace-index.js";
import type { AssetReader, ConfigFiles, DiagnosticSink, FileOpener, ProcessResult, ProcessRunner, Scheduler, UserPrompt } from "../src/ports.js";
import { CachingAssetHost } from "../src/services/asset-host.js";
import { Debouncer } from "../src/services/debouncer.js";
import { DiagnosticsService } from "../src/services/diagnostics-service.js";
import { GlobMatcher } from "../src/services/glob.js";
import { SchemaModeline } from "../src/services/modeline.js";
import { PdfPreviewService } from "../src/services/pdf-preview.js";
import { Project } from "../src/services/project.js";
import { ProjectConfigLoader } from "../src/services/project-config.js";
import { GitPublishedIds } from "../src/services/published-ids.js";
import type { DiagnosticDto } from "../src/types.js";
import { OTHER, OTHER_FILE, POLICY, POLICY_FILE, twoDocs } from "./helpers.js";

class ManualScheduler implements Scheduler {
  tasks: { cb: () => void; delay: number; cancelled: boolean }[] = [];
  schedule(cb: () => void, delay: number) {
    const task = { cb, delay, cancelled: false };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  }
  runAll(): void {
    for (const t of this.tasks.splice(0)) if (!t.cancelled) t.cb();
  }
  get pending(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}

class RecordingSink implements DiagnosticSink {
  byFile = new Map<string, readonly DiagnosticDto[]>();
  set(file: string, d: readonly DiagnosticDto[]) {
    this.byFile.set(file, d);
  }
  clear(file: string) {
    this.byFile.delete(file);
  }
  codes(file: string): string[] {
    return (this.byFile.get(file) ?? []).map((d) => d.code);
  }
}

const noHost: Host = { inspectFile: () => ({ size: 10, sha256: "x", width: 800, height: 600 }) };
const settings = () => ({ config: loadConfig({}), extensionsKnown: true });

describe("Debouncer", () => {
  it("collapses bursts into one trailing run and flushes immediately", () => {
    const s = new ManualScheduler();
    let runs = 0;
    const d = new Debouncer(s, () => 150, () => runs++);
    d.trigger();
    d.trigger();
    d.trigger();
    expect(s.pending).toBe(1);
    expect(s.tasks.at(-1)!.delay).toBe(150);
    s.runAll();
    expect(runs).toBe(1);
    d.trigger();
    d.flush();
    s.runAll();
    expect(runs).toBe(2);
  });
});

describe("GlobMatcher", () => {
  it("matches the default document glob", () => {
    const g = new GlobMatcher("documents/**/*.md");
    expect(g.matches("documents/a.md")).toBe(true);
    expect(g.matches("documents/ops/x/y.md")).toBe(true);
    expect(g.matches("docs/a.md")).toBe(false);
    expect(g.matches("documents/a.txt")).toBe(false);
    expect(new GlobMatcher("{a,b}/*.md").matches("b/x.md")).toBe(true);
  });
});

describe("DiagnosticsService", () => {
  it("uses the core validator, including cross-document references", () => {
    const sink = new RecordingSink();
    const text = OTHER.replace("[[departure-release#100.01(2)]]", "[[departure-release#900.01(1)]]");
    const idx = new WorkspaceIndex();
    idx.update(POLICY_FILE, POLICY);
    idx.update(OTHER_FILE, text);
    const summary = new DiagnosticsService(idx, settings, noHost, sink).validateAll();
    expect(sink.codes(OTHER_FILE)).toContain("unresolved-reference");
    expect(summary.errors).toBeGreaterThan(0);
    const d = sink.byFile.get(OTHER_FILE)!.find((x) => x.code === "unresolved-reference")!;
    expect(d.range.startLine).toBe(text.split("\n").findIndex((l) => l.includes("900.01(1)")));
    expect(d.range.endChar - d.range.startChar).toBe("[[departure-release#900.01(1)]]".length);
  });

  it("clears diagnostics for removed documents and republishes fixed ones", () => {
    const sink = new RecordingSink();
    const idx = twoDocs();
    const svc = new DiagnosticsService(idx, settings, noHost, sink);
    svc.validateAll();
    expect(sink.byFile.has(OTHER_FILE)).toBe(true);
    idx.remove(OTHER_FILE);
    svc.validateAll();
    expect(sink.byFile.has(OTHER_FILE)).toBe(false);
  });

  it("suppresses unknown-key findings when the config cannot be executed", () => {
    const idx = new WorkspaceIndex();
    idx.update(POLICY_FILE, POLICY.replace("version:", "required: true\nversion:"));
    const known = new RecordingSink();
    new DiagnosticsService(idx, settings, noHost, known).validateAll();
    expect(known.codes(POLICY_FILE)).toContain("unknown-frontmatter-key");
    const unknown = new RecordingSink();
    new DiagnosticsService(idx, () => ({ config: loadConfig({}), extensionsKnown: false }), noHost, unknown).validateAll();
    expect(unknown.codes(POLICY_FILE)).not.toContain("unknown-frontmatter-key");
  });
});

describe("Project", () => {
  function make(files: Record<string, string>) {
    const scheduler = new ManualScheduler();
    const sink = new RecordingSink();
    const index = new WorkspaceIndex();
    const project = new Project({
      index,
      texts: { read: (f) => files[f] },
      lister: { list: async (glob) => Object.keys(files).filter((f) => new GlobMatcher(glob).matches(f)) },
      scheduler,
      debounceMs: () => 150,
      diagnostics: (s) => new DiagnosticsService(index, s, noHost, sink),
      loadConfig: () => ({ config: loadConfig({}), extensionsKnown: true, source: null }),
      documentGlobOverride: () => "",
    });
    return { project, scheduler, sink, files, index };
  }

  it("indexes at start, and validates on change after the debounce and on save immediately", async () => {
    const { project, scheduler, sink, files, index } = make({ [POLICY_FILE]: POLICY, [OTHER_FILE]: OTHER });
    await project.initialize();
    expect(sink.byFile.size).toBe(2);

    files[OTHER_FILE] = OTHER.replace("[[departure-release#100.01(2)]]", "[[departure-release#999.01]]");
    project.textChanged(OTHER_FILE);
    expect(index.get(OTHER_FILE)!.text).toContain("#999"); // index is fresh immediately
    expect(sink.codes(OTHER_FILE)).not.toContain("unresolved-reference"); // validation is debounced
    scheduler.runAll();
    expect(sink.codes(OTHER_FILE)).toContain("unresolved-reference");

    files[OTHER_FILE] = OTHER;
    project.saved(OTHER_FILE);
    expect(sink.codes(OTHER_FILE)).not.toContain("unresolved-reference");
  });

  it("revalidates dependents when a referenced document changes or is deleted", async () => {
    const { project, scheduler, sink, files } = make({ [POLICY_FILE]: POLICY, [OTHER_FILE]: OTHER });
    await project.initialize();
    expect(sink.codes(OTHER_FILE)).not.toContain("unresolved-reference");
    delete files[POLICY_FILE];
    project.fileDeleted(POLICY_FILE);
    scheduler.runAll();
    expect(sink.codes(OTHER_FILE)).toContain("unresolved-reference");
  });

  it("ignores files outside the document glob", async () => {
    const { project, index } = make({ [POLICY_FILE]: POLICY, "README.md": "# hi" });
    await project.initialize();
    project.textChanged("README.md");
    expect(index.has("README.md")).toBe(false);
  });
});

describe("ProjectConfigLoader", () => {
  const files = (map: Record<string, string>): ConfigFiles => ({ existing: () => Object.keys(map), read: (n) => map[n] });

  it("loads JSON config including extension fields", () => {
    const c = new ProjectConfigLoader(files({ "docengine.config.json": '{"documents":"docs/**/*.md","extensions":{"required":"boolean"}}' })).load();
    expect(c.config.documents).toBe("docs/**/*.md");
    expect(c.extensionsKnown).toBe(true);
  });

  it("falls back to defaults for executable configs and reports bad JSON", () => {
    const ts = new ProjectConfigLoader(files({ "docengine.config.ts": "export default {}" })).load();
    expect(ts.extensionsKnown).toBe(false);
    expect(ts.problem).toMatch(/not executed/);
    const bad = new ProjectConfigLoader(files({ "docengine.config.json": "{" })).load();
    expect(bad.problem).toBeTruthy();
    expect(new ProjectConfigLoader(files({})).load().source).toBeNull();
  });
});

describe("CachingAssetHost", () => {
  it("re-reads only when the file changes", () => {
    let reads = 0;
    let mtime = 1;
    const reader: AssetReader = {
      stat: () => ({ size: 3, mtimeMs: mtime }),
      read: () => (reads++, new Uint8Array([1, 2, 3])),
    };
    const host = new CachingAssetHost(reader, new FakeHasher());
    expect(host.inspectFile("a.png")?.size).toBe(3);
    host.inspectFile("a.png");
    expect(reads).toBe(1);
    mtime = 2;
    host.inspectFile("a.png");
    expect(reads).toBe(2);
    expect(new CachingAssetHost({ stat: () => undefined, read: () => new Uint8Array() }, new FakeHasher()).inspectFile("x")).toBeUndefined();
    void InMemoryFileSystem;
  });
});

describe("GitPublishedIds", () => {
  const runner = (calls: string[][], tags: string, shown: string, status = 0): ProcessRunner => ({
    run: async (_c, args): Promise<ProcessResult> => {
      calls.push([...args]);
      return args[0] === "tag" ? { status: 0, stdout: tags, stderr: "" } : { status, stdout: shown, stderr: "" };
    },
  });

  it("reads provision IDs from the newest release tag", async () => {
    const calls: string[][] = [];
    const ids = new GitPublishedIds(runner(calls, "operations/departure-release/v1.1\noperations/departure-release/v1.0\n", POLICY), "/ws");
    const r = await ids.idsFor(POLICY_FILE, { group: "operations", short: "departure-release" });
    expect(r!.version).toBe("1.1");
    expect(r!.ids.has("100.01(2)(a)")).toBe(true);
    expect(calls[1]).toEqual(["show", `operations/departure-release/v1.1:./${POLICY_FILE}`]);
  });

  it("returns undefined without tags or when git fails", async () => {
    expect(await new GitPublishedIds(runner([], "", ""), "/ws").idsFor(POLICY_FILE, { group: "g", short: "s" })).toBeUndefined();
    expect(await new GitPublishedIds(runner([], "g/s/v1.0\n", "", 128), "/ws").idsFor(POLICY_FILE, { group: "g", short: "s" })).toBeUndefined();
  });
});

describe("PdfPreviewService", () => {
  function make(result: ProcessResult) {
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const opened: string[] = [];
    const errors: string[] = [];
    const prompt: UserPrompt = { confirm: async () => true, info: () => {}, error: (m) => errors.push(m) };
    const opener: FileOpener = { open: async (p) => void opened.push(p) };
    const runner: ProcessRunner = { run: async (cmd, args) => (calls.push({ cmd, args }), result) };
    const svc = new PdfPreviewService(twoDocs(), runner, opener, prompt, "/ws", () => "pnpm exec docengine", () => "dist");
    return { svc, calls, opened, errors };
  }

  it("runs the CLI build for the document and opens the PDF", async () => {
    const { svc, calls, opened } = make({ status: 0, stdout: "", stderr: "" });
    expect(await svc.build(POLICY_FILE)).toBe(true);
    expect(calls[0]).toEqual({ cmd: "pnpm", args: ["exec", "docengine", "build", POLICY_FILE, "--out", "dist/preview", "--cwd", "/ws"] });
    expect(opened).toEqual(["/ws/dist/preview/operations/departure-release-v1.0.pdf"]);
  });

  it("reports build failures and a missing CLI or typst without opening anything", async () => {
    for (const [res, msg] of [
      [{ status: 1, stdout: "", stderr: "boom" }, /build failed:\nboom/],
      [{ status: null, stdout: "", stderr: "" }, /Could not run/],
      [{ status: 0, stdout: "", stderr: "typst CLI not found" }, /typst CLI is not installed/],
    ] as const) {
      const { svc, opened, errors } = make(res);
      expect(await svc.build(POLICY_FILE)).toBe(false);
      expect(errors[0]).toMatch(msg);
      expect(opened).toEqual([]);
    }
  });
});

describe("SchemaModeline", () => {
  it("inserts the modeline inside the frontmatter once", () => {
    const idx = twoDocs();
    const edit = new SchemaModeline().edit(idx.get(POLICY_FILE)!, "../../schema/frontmatter.schema.json")!;
    expect(edit.range.startLine).toBe(1);
    expect(edit.newText).toBe("# yaml-language-server: $schema=../../schema/frontmatter.schema.json\n");
    const again = new WorkspaceIndex();
    again.update(POLICY_FILE, POLICY.replace("---\n", `---\n${edit.newText}`));
    expect(new SchemaModeline().edit(again.get(POLICY_FILE)!, "x")).toBeUndefined();
  });
});
