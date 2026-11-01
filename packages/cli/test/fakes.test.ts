// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
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
import { BuildCommand } from "../src/commands/build-command.js";
import { ValidateCommand } from "../src/commands/validate-command.js";
import { Command } from "../src/command.js";
import { CommandRegistry, CommandRunner } from "../src/registry.js";
import type { Services } from "../src/services.js";
import { FakeFileWatcher } from "./support.js";

const DOC = `---
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

function setup(opts: { typst?: boolean; doc?: string } = {}) {
  const fs = new InMemoryFileSystem({
    "/proj/docengine.config.json": "{}",
    "/proj/documents/ops/fake.md": opts.doc ?? DOC,
    "/proj/documents/ops/images/f.svg": "<svg/>",
    "/tpl/default-letterhead.typ": "// template",
  });
  const out: string[] = [];
  const err: string[] = [];
  const typst = new FakeTypstRunner({ fs, available: opts.typst ?? true });
  const services: Services = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    fs,
    git: new FakeGitClient("deadbeef"),
    clock: new FixedClock(),
    watcher: new FakeFileWatcher(),
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
  return { fs, services, out, err, typst };
}

const inv = (values: Record<string, string | boolean> = {}) => ({ cwd: "/proj", positionals: [], values });

describe("commands with in-memory fakes (no disk, no typst)", () => {
  it("validate runs against the fake file system", async () => {
    const { services, out } = setup();
    expect(await new ValidateCommand(services).run(inv())).toBe(0);
    expect(out.join("\n")).toContain("1 document(s), 0 error(s)");
  });

  it("build writes typ, pdf, manifest and upload sheet through the ports", async () => {
    const { services, fs, typst } = setup();
    expect(await new BuildCommand(services).run(inv())).toBe(0);
    expect(fs.list()).toEqual(expect.arrayContaining([
      "/proj/dist/_template/letterhead.typ",
      "/proj/dist/ops/fake-v1.0.typ",
      "/proj/dist/ops/fake-v1.0.pdf",
      "/proj/dist/manifest.json",
      "/proj/dist/upload-sheet.md",
    ]));
    const manifest = JSON.parse(fs.readText("/proj/dist/manifest.json"));
    expect(manifest.gitCommit).toBe("deadbeef");
    expect(manifest.generator.version).toBe("9.9.9");
    expect(manifest.documents[0].pdf.sha256).toHaveLength(64);
    expect(manifest.documents[0].figures[0].sha256).toHaveLength(64);
    expect(typst.calls.map((c) => c[0])).toEqual(["--version", "compile"]);
  });

  it("build passes configured font directories and ignoreSystemFonts to typst", async () => {
    const { services, fs, typst } = setup();
    fs.writeText("/proj/docengine.config.json", JSON.stringify({ fonts: { paths: ["assets/fonts"], ignoreSystemFonts: true } }));
    expect(await new BuildCommand(services).run(inv())).toBe(0);
    const call = typst.calls.find((c) => c[0] === "compile")!;
    expect(call).toEqual(expect.arrayContaining(["--font-path", "--ignore-system-fonts"]));
    expect(call[call.indexOf("--font-path") + 1]).toMatch(/[\\/]proj[\\/]assets[\\/]fonts$/);
  });

  it("build adds no font arguments when fonts are not configured", async () => {
    const { services, typst } = setup();
    await new BuildCommand(services).run(inv());
    const call = typst.calls.find((c) => c[0] === "compile")!;
    expect(call).not.toContain("--font-path");
    expect(call).not.toContain("--ignore-system-fonts");
  });

  it("build skips compilation with a message when typst is unavailable", async () => {
    const { services, fs, err } = setup({ typst: false });
    expect(await new BuildCommand(services).run(inv())).toBe(0);
    expect(err.join("\n")).toContain("typst CLI not found");
    expect(fs.isFile("/proj/dist/ops/fake-v1.0.typ")).toBe(true);
    expect(fs.isFile("/proj/dist/ops/fake-v1.0.pdf")).toBe(false);
  });

  it("build installs the default cover template next to the letterhead when it exists", async () => {
    const { services, fs } = setup();
    fs.writeText("/tpl/default-cover.typ", "// cover");
    expect(await new BuildCommand(services).run(inv())).toBe(0);
    expect(fs.readText("/proj/dist/_template/cover.typ")).toBe("// cover");
  });

  it("build installs a configured cover template and fails when it is missing", async () => {
    const { services, fs, err } = setup();
    fs.writeText("/proj/docengine.config.json", JSON.stringify({ cover: { template: "tpl/my-cover.typ" } }));
    expect(await new BuildCommand(services).run(inv())).toBe(1);
    expect(err.join("\n")).toContain("Cover template not found");
    fs.writeText("/proj/tpl/my-cover.typ", "// mine");
    expect(await new BuildCommand(services).run(inv())).toBe(0);
    expect(fs.readText("/proj/dist/_template/cover.typ")).toBe("// mine");
  });

  it("build aborts on validation errors before writing anything", async () => {
    const { services, fs } = setup({ doc: DOC.replace("[100.01(1)]", "[100.01(3)]") });
    expect(await new BuildCommand(services).run(inv())).toBe(1);
    expect(fs.isFile("/proj/dist/manifest.json")).toBe(false);
  });
});

describe("command registry", () => {
  it("lets new commands be added as classes only", async () => {
    class HelloCommand extends Command {
      readonly name = "hello";
      readonly summary = "Say hello";
      override readonly options = { name: { type: "string" as const, description: "Who" } };
      async run(i: { values: Record<string, unknown> }) {
        out.push(`hello ${String(i.values.name)}`);
        return 0;
      }
    }
    const out: string[] = [];
    const registry = new CommandRegistry().register(new HelloCommand());
    const runner = new CommandRunner(registry, { out: (s) => out.push(s), err: (s) => out.push(s) }, () => "/");
    expect(await runner.run(["hello", "--name", "world"])).toBe(0);
    expect(out).toEqual(["hello world"]);
    expect(() => registry.register(new HelloCommand())).toThrow(/already registered/);
    expect(await runner.run(["nope"])).toBe(2);
  });
});
