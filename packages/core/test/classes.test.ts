// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  ProvisionId,
  Diagnostic,
  FakeHasher,
  FakeTypstRunner,
  FileSystemHost,
  InMemoryFileSystem,
  Manifest,
  ManifestBuilder,
  MarkdownParser,
  TypstCompiler,
  UploadSheetBuilder,
  Validator,
  loadConfig,
  type Rule,
  type RuleContext,
} from "../src/index.js";
import { config, doc, fixture, parseDoc } from "./helpers.js";

describe("ProvisionId", () => {
  it("parses without throwing and exposes structure", () => {
    const id = ProvisionId.parse("100.01(2)(a)(iii)");
    expect(id.depth).toBe(6);
    expect(id.parent?.text).toBe("100.01(2)(a)");
    expect(id.parent?.parent?.parent?.parent?.parent?.parent).toBeNull();
    expect(id.kind.name).toBe("lower-roman");
    expect(id.ordinal).toBe(3);
    expect(id.isWellFormed).toBe(true);
    expect(ProvisionId.parse("100.01(a)").isWellFormed).toBe(false);
    expect(ProvisionId.parse("").isBlank).toBe(true);
  });

  it("builds children and siblings by ordinal across kinds", () => {
    expect(ProvisionId.parse("100.01").child(2).text).toBe("100.01(2)");
    expect(ProvisionId.parse("100.01(2)").child(27).text).toBe("100.01(2)(aa)");
    expect(ProvisionId.parse("100.01(2)(a)").child(4).text).toBe("100.01(2)(a)(iv)");
    expect(ProvisionId.parse("100.01(2)(a)").sibling(3)?.text).toBe("100.01(2)(c)");
    expect(ProvisionId.parse("100.01").sibling(2)).toBeNull();
  });

  it("relates ancestors and descendants", () => {
    const a = ProvisionId.parse("100.01(2)");
    expect(ProvisionId.parse("100.01(2)(a)").isChildOf(a)).toBe(true);
    expect(ProvisionId.parse("100.01(2)(a)(i)").isChildOf(a)).toBe(false);
    expect(ProvisionId.parse("100.01(2)(a)(i)").isDescendantOf(a)).toBe(true);
    expect(ProvisionId.parse("100.01(22)").isDescendantOf(a)).toBe(false);
  });

  it("compares by ordinal, not text", () => {
    const sorted = ["100.01(10)", "100.01(2)", "100.01(1)(b)", "100.01(1)(a)", "100.01(1)", "200.01"].map((s) => ProvisionId.parse(s)).sort((x, y) => x.compare(y));
    expect(sorted.map(String)).toEqual(["100.01(1)", "100.01(1)(a)", "100.01(1)(b)", "100.01(2)", "100.01(10)", "200.01"]);
  });

  it("is immutable and serialises to its text", () => {
    const id = ProvisionId.parse("100.01(1)");
    expect(Object.isFrozen(id)).toBe(true);
    expect(JSON.stringify({ id })).toBe('{"id":"100.01(1)"}');
    expect(id.typstLabel).toBe("p100-01-1");
  });
});

describe("Document and Diagnostic", () => {
  it("exposes metadata and the provision tree", () => {
    const d = parseDoc("[100.01] S\n\n[100.01(1)] a\n\n[100.01(2)] b\n\n[100.01(2)(a)] c");
    expect(d.repositoryKey).toBe("g/t");
    expect(d.matchesName("t")).toBe(true);
    expect(d.matchesName("g/t")).toBe(true);
    expect(d.matchesName("h/t")).toBe(false);
    expect(d.childrenOf(ProvisionId.parse("100.01")).map((c) => c.id.text)).toEqual(["100.01(1)", "100.01(2)"]);
    expect(d.findProvision("100.01(2)(a)")?.parentId?.text).toBe("100.01(2)");
  });

  it("formats diagnostics and is immutable", () => {
    const x = Diagnostic.error("c", "m", { line: 3, column: 4, length: 1 });
    expect(x.format("f.md")).toBe("f.md:3:4 error m");
    expect(x.withFile("g.md").format()).toBe("g.md:3:4 error m");
    expect(Object.isFrozen(x)).toBe(true);
  });
});

describe("Validator rules", () => {
  it("runs custom rules added without editing existing ones", () => {
    class NoTodoRule implements Rule {
      readonly name = "no-todo";
      check({ doc, report }: RuleContext) {
        for (const c of doc.provisions) {
          if (c.blocks.some((b) => b.type === "paragraph" && b.text.includes("TODO"))) report.warning("todo", "Resolve TODO", c.position);
        }
      }
    }
    const d = parseDoc("[100.01] S\n\n[100.01(1)] TODO write this");
    expect(Validator.standard().validate(d, { config }).map((x) => x.code)).toEqual([]);
    expect(Validator.standard([new NoTodoRule()]).validate(d, { config }).map((x) => x.code)).toEqual(["todo"]);
  });

  it("can run an arbitrary subset of rules", () => {
    const only = new Validator([]);
    expect(only.validate(parseDoc("[100.01] S\n\n[100.01(9)] gap"), { config })).toEqual([]);
  });
});

describe("TypstCompiler with a fake runner", () => {
  it("reports availability and compile results without a typst install", () => {
    const fs = new InMemoryFileSystem();
    const runner = new FakeTypstRunner({ fs });
    const compiler = new TypstCompiler(runner);
    expect(compiler.version()).toBe("typst fake 0.0.0");
    expect(compiler.compile({ root: "/r", input: "/r/a.typ", output: "/r/a.pdf" })).toEqual({ ok: true });
    expect(fs.isFile("/r/a.pdf")).toBe(true);
    expect(runner.calls[1]).toEqual(["compile", "--root", "/r", "/r/a.typ", "/r/a.pdf"]);
  });

  it("passes --font-path per directory and --ignore-system-fonts when requested", () => {
    const runner = new FakeTypstRunner({ fs: new InMemoryFileSystem() });
    new TypstCompiler(runner).compile({
      root: "/r",
      input: "/r/a.typ",
      output: "/r/a.pdf",
      fontPaths: ["/r/fonts", "/r/more"],
      ignoreSystemFonts: true,
    });
    expect(runner.calls[0]).toEqual([
      "compile", "--root", "/r", "--font-path", "/r/fonts", "--font-path", "/r/more", "--ignore-system-fonts", "/r/a.typ", "/r/a.pdf",
    ]);
  });

  it("handles a missing executable and compile failures", () => {
    expect(new TypstCompiler(new FakeTypstRunner({ available: false })).version()).toBeNull();
    const r = new TypstCompiler(new FakeTypstRunner({ failCompile: true })).compile({ root: "/", input: "a", output: "b" });
    expect(r).toEqual({ ok: false, error: "fake compile error" });
  });
});

describe("FileSystemHost", () => {
  it("inspects files through the injected file system and hasher", () => {
    const fs = new InMemoryFileSystem({ "/repo/documents/g/a.svg": "<svg/>" });
    const host = new FileSystemHost(fs, new FakeHasher(), "/repo");
    expect(host.inspectFile("documents/g/a.svg")).toMatchObject({ size: 6 });
    expect(host.inspectFile("documents/g/a.svg")!.sha256).toHaveLength(64);
    expect(host.inspectFile("missing.svg")).toBeUndefined();
  });
});

describe("Manifest classes", () => {
  it("serialises through toJSON and derives immutable copies", () => {
    const d = new MarkdownParser().parse(fixture("sample-repo/documents/operations/sample-policy.md"), { file: "documents/operations/sample-policy.md" });
    const entry = new ManifestBuilder(loadConfig({})).entry(d);
    const changed = entry.withChanged(true);
    expect(entry.changed).toBeNull();
    expect(changed.changed).toBe(true);
    const manifest = new ManifestBuilder(loadConfig({}), { gitCommit: "abc", engineVersion: "1.2.3" }).build([changed]);
    expect(manifest).toBeInstanceOf(Manifest);
    const json = JSON.parse(JSON.stringify(manifest));
    expect(json).toMatchObject({ schemaVersion: 1, generator: { name: "docengine", version: "1.2.3" }, gitCommit: "abc" });
    expect(json.documents[0]).toMatchObject({ short: "sample-policy", changed: true });
    expect(new UploadSheetBuilder().build(manifest, { changedOnly: true })).toContain("sample-policy");
  });

  it("keeps drafts out of the releasable set", () => {
    const draft = new ManifestBuilder(config).entry(new MarkdownParser().parse(doc("[100.01] S", { draft: "true" })));
    expect(Manifest.create([draft]).releasable()).toEqual([]);
  });
});
