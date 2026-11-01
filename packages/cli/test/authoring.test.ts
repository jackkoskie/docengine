// SPDX-License-Identifier: MPL-2.0
import { join } from "node:path";
import { FakeGitClient } from "@jackkoskie/docengine-core";
import { describe, expect, it } from "vitest";
import { BuildCommand } from "../src/commands/build-command.js";
import { BumpCommand, FormatCommand, NewCommand, RenumberCommand, WatchCommand } from "../src/commands/authoring-commands.js";
import { ChangedCommand, DiffCommand, ReleaseNotesCommand } from "../src/commands/change-commands.js";
import { CheckCommand, ValidateCommand } from "../src/commands/validate-command.js";
import { GithubDiagnosticFormatter, diagnosticFormatterFor } from "../src/command.js";
import { createDefaultRegistry } from "../src/main.js";
import { CommandRunner } from "../src/registry.js";
import { DOC, inv, setup } from "./support.js";

const FILE = "documents/ops/fake.md";
const ABS = "/proj/documents/ops/fake.md";

describe("registry", () => {
  it("registers every authoring command and its documented options", () => {
    const { services } = setup();
    const reg = createDefaultRegistry(services);
    expect(reg.all.map((c) => c.name)).toEqual(
      expect.arrayContaining(["validate", "build", "schema", "check", "fmt", "renumber", "new", "bump", "watch", "diff", "changed", "release-notes"]),
    );
    const help = new CommandRunner(reg, services.io).help();
    for (const opt of ["--base", "--format", "--json", "--only-changed", "--check", "--dry-run"]) expect(help).toContain(opt);
  });
});

describe("github diagnostics", () => {
  it("formats ::error file=,line=,col=::message with escaping", () => {
    const f = new GithubDiagnosticFormatter();
    const mk = (severity: "error" | "warning", message: string, file?: string) =>
      ({ severity, code: "c", message, position: { line: 3, column: 5, length: 1 }, file }) as never;
    expect(f.format(mk("error", "bad thing", "documents/ops/fake.md"))).toBe("::error file=documents/ops/fake.md,line=3,col=5::bad thing");
    expect(f.format(mk("warning", "100% sure\nnext", "a,b:c.md"))).toBe("::warning file=a%2Cb%3Ac.md,line=3,col=5::100%25 sure%0Anext");
    expect(() => diagnosticFormatterFor("xml")).toThrow(/Unknown --format/);
  });

  it("validate --format github prints annotations to stdout", async () => {
    const { services, out, err } = setup({ files: { [ABS]: DOC.replace("[100.01(1)]", "[100.01(3)]") } });
    expect(await new ValidateCommand(services).run(inv([], { format: "github" }))).toBe(1);
    expect(out.join("\n")).toMatch(/^::error file=documents\/ops\/fake\.md,line=\d+,col=1::Subsection 100\.01\(3\) is out of sequence/m);
    expect(err).toEqual([]);
  });
});

describe("check", () => {
  const bumpedBase = (git: FakeGitClient) => git.setRef("origin/main", { [FILE]: DOC, "documents/ops/images/f.svg": "<svg/>" });

  it("fails on a content change without a version bump and annotates it for GitHub", async () => {
    const git = bumpedBase(new FakeGitClient("h"));
    const { services, out } = setup({ git, files: { [ABS]: DOC.replace("See", "Consult") } });
    const code = await new CheckCommand(services).run(inv([], { base: "origin/main", format: "github" }));
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/::error file=documents\/ops\/fake\.md,line=5,col=\d+::Content changed since origin\/main/);
  });

  it("fails when only a figure image changed, passes after bumping", async () => {
    const git = bumpedBase(new FakeGitClient("h"));
    const a = setup({ git, files: { "/proj/documents/ops/images/f.svg": "<svg changed/>" } });
    expect(await new CheckCommand(a.services).run(inv([], { base: "origin/main" }))).toBe(1);
    expect(a.err.join("\n")).toContain("version is still");
    const b = setup({ git, files: { "/proj/documents/ops/images/f.svg": "<svg changed/>", [ABS]: DOC.replace('"1.0"', '"1.1"') } });
    expect(await new CheckCommand(b.services).run(inv([], { base: "origin/main" }))).toBe(0);
  });

  it("passes with version-note: editorial", async () => {
    const git = bumpedBase(new FakeGitClient("h"));
    const edited = DOC.replace("version: \"1.0\"", 'version: "1.0"\nversion-note: editorial').replace("See", "Consult");
    const ok = setup({ git, files: { [ABS]: edited } });
    expect(await new CheckCommand(ok.services).run(inv([], { base: "origin/main" }))).toBe(0);

  });

  it("warns (exit 0) about a removed provision ID and errors when below the last tag", async () => {
    const two = DOC.replace("[100.01(1)] See [[fig:f]].\n\n![Fig](images/f.svg){#fig:f}\n", "[100.01(1)] Replaced.\n");
    const git = new FakeGitClient("h").addTag("ops/fake/v1.0", { [FILE]: DOC.replace("[100.01(1)]", "[100.01(1)]").replace("Scope", "Scope\n\n[100.01(2)] second"), "documents/ops/images/f.svg": "<svg/>" });
    const a = setup({ git, files: { [ABS]: two.replace('"1.0"', '"1.1"') } });
    expect(await new CheckCommand(a.services).run(inv([]))).toBe(0);
    expect(a.err.join("\n")).toMatch(/warning Provision \[100\.01\(2\)\] existed in the previous version/);

    const git2 = new FakeGitClient("h").addTag("ops/fake/v2.0", { [FILE]: DOC });
    const b = setup({ git: git2 });
    expect(await new CheckCommand(b.services).run(inv([]))).toBe(1);
    expect(b.err.join("\n")).toContain("must be greater than the last release ops/fake/v2.0");
  });

  it("reports an unknown base ref", async () => {
    const { services } = setup();
    await expect(new CheckCommand(services).run(inv([], { base: "nope" }))).rejects.toThrow(/does not exist/);
  });

  it("plain validate is unaffected by git history", async () => {
    const git = bumpedBase(new FakeGitClient("h"));
    const { services } = setup({ git, files: { [ABS]: DOC.replace("See", "Consult") } });
    expect(await new ValidateCommand(services).run(inv([], { base: "origin/main" }))).toBe(0);
  });
});

describe("fmt", () => {
  const SRC = DOC.replace("[100.01(1)] See [[fig:f]].", "[100.01(1)] See [[fig:f]].\n\n  [] filled").replace("{#fig:f}", "{ width=50%  #fig:f }");

  it("fills blanks, normalizes figures and writes the file; second run is a no-op", async () => {
    const { services, fs, out } = setup({ files: { [ABS]: SRC } });
    expect(await new FormatCommand(services).run(inv())).toBe(0);
    const text = fs.readText(ABS);
    expect(text).toContain("[100.01(2)] filled");
    expect(text).toContain("{#fig:f width=50%}");
    expect(out.join("\n")).toContain("filled blank [] with [100.01(2)]");
    out.length = 0;
    expect(await new FormatCommand(services).run(inv())).toBe(0);
    expect(out.join("\n")).toContain("0 file(s) formatted");
  });

  it("--check does not write and exits 1", async () => {
    const { services, fs } = setup({ files: { [ABS]: SRC } });
    expect(await new FormatCommand(services).run(inv([], { check: true }))).toBe(1);
    expect(fs.readText(ABS)).toBe(SRC);
  });

  it("never renumbers: a colliding blank is reported and left alone", async () => {
    const src = DOC.replace("[100.01] Scope\n", "[100.01] Scope\n\n  [] inserted\n");
    const { services, fs, err } = setup({ files: { [ABS]: src } });
    expect(await new FormatCommand(services).run(inv())).toBe(1);
    expect(fs.readText(ABS)).toContain("  [] inserted");
    expect(fs.readText(ABS)).toContain("[100.01(1)] See");
    expect(err.join("\n")).toMatch(/error Next ID \[100\.01\(1\)\] is already used/);
  });
  it("--tombstones restores removed published IDs from the last tag", async () => {
    const tagged = DOC + "\n[100.01(2)] ghost\n";
    const git = new FakeGitClient("h").addTag("ops/fake/v1.0", { [FILE]: tagged });
    const { services, fs } = setup({ git });
    expect(await new FormatCommand(services).run(inv([], { tombstones: true }))).toBe(0);
    expect(fs.readText(ABS)).toContain("[100.01(2)] [repealed]");
  });
});

describe("renumber", () => {
  const OTHER = `---
title: Other
short: other
group: ops
version: "1.0"
effectiveDate: 2024-01-15
---

[100.01] Top

[100.01(1)] See [[fake#100.01(1)]] and [[fake#fig:f]].
`;

  it("renumbers, rewrites references across documents and logs every change", async () => {
    const files = { "/proj/documents/ops/other.md": OTHER, [ABS]: DOC.replace("[100.01(1)] See", "[100.01(1)] Self [[100.01(1)]] See") };
    const { services, fs, out } = setup({ files });
    expect(await new RenumberCommand(services).run(inv(["ops/fake", "100.01(1)", "100.01(5)"]))).toBe(0);
    expect(fs.readText(ABS)).toContain("[100.01(5)] Self [[100.01(5)]] See");
    expect(fs.readText("/proj/documents/ops/other.md")).toContain("[[fake#100.01(5)]] and [[fake#fig:f]]");
    const log = out.join("\n");
    expect(log).toContain("documents/ops/fake.md:11 provision [100.01(1)] -> [100.01(5)]");
    expect(log).toContain("documents/ops/other.md:11 reference [100.01(1)] -> [100.01(5)]");
  });

  it("--dry-run writes nothing; bad input exits non-zero", async () => {
    const { services, fs, err } = setup();
    expect(await new RenumberCommand(services).run(inv(["ops/fake", "100.01(1)", "100.01(9)"], { "dry-run": true }))).toBe(0);
    expect(fs.readText(ABS)).toBe(DOC);
    expect(await new RenumberCommand(services).run(inv(["ops/fake", "100.01(7)", "100.01(8)"]))).toBe(1);
    expect(err.join("\n")).toContain("does not exist");
    expect(await new RenumberCommand(services).run(inv(["ops/fake", "100.01(7)"]))).toBe(2);
  });
});

describe("new", () => {
  it("scaffolds a valid document with the modeline and today's date", async () => {
    const { services, fs, out } = setup();
    expect(await new NewCommand(services).run(inv(["ops", "airspace-rules"], { title: "Airspace Rules" }))).toBe(0);
    const text = fs.readText("/proj/documents/ops/airspace-rules.md");
    expect(text).toContain("# yaml-language-server: $schema=../../schema/frontmatter.schema.json");
    expect(text).toContain('title: "Airspace Rules"');
    expect(text).toContain("effectiveDate: 2025-03-04");
    expect(out.join("\n")).toContain("created documents/ops/airspace-rules.md");
    expect(await new ValidateCommand(services).run(inv())).toBe(0);
  });

  it("refuses to overwrite and rejects bad slugs", async () => {
    const { services } = setup();
    expect(await new NewCommand(services).run(inv(["ops", "fake"]))).toBe(1);
    expect(await new NewCommand(services).run(inv(["Ops", "x"]))).toBe(2);
    expect(await new NewCommand(services).run(inv(["ops"]))).toBe(2);
  });
});

describe("bump", () => {
  it("bumps minor and major, setting effectiveDate", async () => {
    const { services, fs, out } = setup();
    expect(await new BumpCommand(services).run(inv(["ops/fake", "minor"]))).toBe(0);
    expect(fs.readText(ABS)).toContain('version: "1.1"');
    expect(fs.readText(ABS)).toContain("effectiveDate: 2025-03-04");
    expect(out.join("\n")).toContain("ops/fake: version 1.0 -> 1.1");
    expect(await new BumpCommand(services).run(inv(["fake", "major"], { date: "2026-01-01" }))).toBe(0);
    expect(fs.readText(ABS)).toContain('version: "2.0"');
    expect(fs.readText(ABS)).toContain("effectiveDate: 2026-01-01");
  });

  it("validates arguments", async () => {
    const { services } = setup();
    expect(await new BumpCommand(services).run(inv(["ops/fake", "patch"]))).toBe(2);
    expect(await new BumpCommand(services).run(inv(["ops/fake", "minor"], { date: "yesterday" }))).toBe(2);
    expect(await new BumpCommand(services).run(inv(["ops/missing", "minor"]))).toBe(1);
  });
});

describe("watch", () => {
  it("builds once, rebuilds on change (ignoring the output dir) and stops when closed", async () => {
    const { services, watcher, out, fs } = setup();
    const run = new WatchCommand(services).run(inv(["ops/fake"], { "no-compile": true }));
    await watcher.started();
    const session = watcher.sessions[0]!;
    expect(session.options.paths.some((p) => p.endsWith("documents"))).toBe(true);
    expect(session.options.paths.some((p) => p.endsWith("docengine.config.json"))).toBe(true);
    expect(fs.isFile("/proj/dist/ops/fake-v1.0.typ")).toBe(true);
    const builds = () => out.filter((l) => l.includes("rebuilding")).length;
    expect(builds()).toBe(1);

    fs.writeText(ABS, DOC.replace("See", "Consult"));
    session.trigger(join("/proj", "documents", "ops", "fake.md"));
    await new Promise((r) => setTimeout(r, 20));
    expect(builds()).toBe(2);
    expect(fs.readText("/proj/dist/ops/fake-v1.0.typ")).toContain("Consult");

    session.trigger(join("/proj", "dist", "ops", "fake-v1.0.typ"));
    await new Promise((r) => setTimeout(r, 20));
    expect(builds()).toBe(2);

    session.close();
    expect(await run).toBe(0);
  });

  it("keeps watching after a failed build", async () => {
    const { services, watcher, out, fs } = setup();
    const run = new WatchCommand(services).run(inv([], { "no-compile": true }));
    await watcher.started();
    fs.writeText(ABS, DOC.replace("[100.01(1)]", "[100.01(3)]"));
    watcher.sessions[0]!.trigger(join("/proj", "documents", "ops", "fake.md"));
    await new Promise((r) => setTimeout(r, 20));
    expect(out.join("\n")).toContain("build failed");
    watcher.sessions[0]!.close();
    await run;
  });
});

describe("diff", () => {
  const git = () =>
    new FakeGitClient("h").setRef("main", { [FILE]: DOC, "documents/ops/images/f.svg": "<svg/>" });
  const changedDoc = DOC.replace('"1.0"', '"1.1"').replace("See", "Consult").replace("{#fig:f}", "{#fig:f}\n\n[100.01(2)] added provision");

  it("markdown diff by provision ID and figure", async () => {
    const { services, out } = setup({ git: git(), files: { [ABS]: changedDoc, "/proj/documents/ops/images/f.svg": "<svg v2/>" } });
    expect(await new DiffCommand(services).run(inv([], { base: "main", format: "markdown" }))).toBe(0);
    const md = out.join("\n");
    expect(md).toContain("## Fake Policy (`ops/fake`, v1.0 -> v1.1)");
    expect(md).toContain("- Added Subsection 100.01(2) added provision");
    expect(md).toContain("- Changed Subsection 100.01(1) Consult");
    expect(md).toContain("- Changed figure `f` (image)");
  });

  it("json diff is machine readable; unchanged documents are omitted", async () => {
    const { services, out } = setup({ git: git(), files: { [ABS]: changedDoc } });
    await new DiffCommand(services).run(inv([], { base: "main", format: "json" }));
    const json = JSON.parse(out.join("\n"));
    expect(json.base).toBe("main");
    expect(json.documents[0]).toMatchObject({ key: "ops/fake", isNew: false, version: { from: "1.0", to: "1.1" } });
    expect(json.documents[0].provisions.added.map((c: { id: string }) => c.id)).toEqual(["100.01(2)"]);

    const same = setup({ git: git() });
    await new DiffCommand(same.services).run(inv([], { base: "main", format: "text" }));
    expect(same.out.join("\n")).toBe("No document changes.");
  });

  it("detects a moved (renumbered) provision", async () => {
    const base = DOC + "\n[100.01(2)] Keep me exactly.\n";
    const moved = base.replace("[100.01(2)] Keep", "[100.01(4)] Keep").replace('"1.0"', '"1.1"');
    const g = new FakeGitClient("h").setRef("main", { [FILE]: base, "documents/ops/images/f.svg": "<svg/>" });
    const { services, out } = setup({ git: g, files: { [ABS]: moved } });
    await new DiffCommand(services).run(inv([], { base: "main", format: "text" }));
    expect(out.join("\n")).toContain("> Subsection 100.01(2) -> 100.01(4)");
  });

  it("rejects unknown formats", async () => {
    const { services } = setup({ git: git() });
    await expect(new DiffCommand(services).run(inv([], { base: "main", format: "pdf" }))).rejects.toThrow(/Unknown --format/);
  });
});

describe("changed", () => {
  const BUMPED = DOC.replace('"1.0"', '"1.1"');
  const other = (draft: boolean) => `---
title: Other
short: other
group: ops
version: "3.0"
effectiveDate: 2024-01-15
${draft ? "draft: true\n" : ""}---

[100.01] Top

[100.01(1)] text
`;

  it("uses the tag when present and the base ref otherwise; unchanged docs are omitted", async () => {
    const git = new FakeGitClient("h")
      .addTag("ops/fake/v1.0", { [FILE]: DOC })
      .setRef("main", { [FILE]: DOC, "documents/ops/other.md": other(false).replace("3.0", "2.0") });
    const { services, out } = setup({ git, files: { [ABS]: BUMPED, "/proj/documents/ops/other.md": other(false) } });
    await new ChangedCommand(services).run(inv([], { base: "main", json: true }));
    const list = JSON.parse(out.join("\n"));
    expect(list.map((c: { key: string }) => c.key).sort()).toEqual(["ops/fake", "ops/other"]);
    expect(list.find((c: { key: string }) => c.key === "ops/fake")).toMatchObject({
      version: "1.1",
      previousVersion: "1.0",
      tag: "ops/fake/v1.1",
      draft: false,
      file: FILE,
    });
    expect(list.find((c: { key: string }) => c.key === "ops/other")).toMatchObject({ previousVersion: "2.0" });

    const none = setup({ git });
    out.length = 0;
    await new ChangedCommand(none.services).run(inv(["documents/ops/fake.md"], { base: "main" }));
    expect(none.out.join("\n")).toBe("No changed documents.");
  });

  it("excludes drafts from the release list unless asked, and treats new documents as changed", async () => {
    const git = new FakeGitClient("h").setRef("main", { [FILE]: DOC });
    const files = { "/proj/documents/ops/other.md": other(true) };
    const a = setup({ git, files });
    await new ChangedCommand(a.services).run(inv([], { base: "main", json: true }));
    expect(JSON.parse(a.out.join("\n"))).toEqual([]);
    const b = setup({ git, files });
    await new ChangedCommand(b.services).run(inv([], { base: "main", json: true, "include-drafts": true }));
    expect(JSON.parse(b.out.join("\n"))).toMatchObject([{ key: "ops/other", draft: true, previousVersion: null }]);
  });
});

describe("release-notes", () => {
  it("prints markdown with the provision diff since a tag and a PR placeholder", async () => {
    const git = new FakeGitClient("h").addTag("ops/fake/v1.0", { [FILE]: DOC, "documents/ops/images/f.svg": "<svg/>" });
    const { services, out } = setup({ git, files: { [ABS]: DOC.replace('"1.0"', '"1.1"').replace("See", "Consult") } });
    expect(await new ReleaseNotesCommand(services).run(inv(["ops/fake"], { base: "ops/fake/v1.0" }))).toBe(0);
    const md = out.join("\n");
    expect(md).toContain("# Fake Policy v1.1");
    expect(md).toContain("Changes since ops/fake/v1.0.");
    expect(md).toContain("- Changed Subsection 100.01(1) Consult");
    expect(md).toContain("Pull request: {{PR_URL}}");
  });

  it("is an initial release without a tag, and needs a document name", async () => {
    const { services, out } = setup();
    await new ReleaseNotesCommand(services).run(inv(["ops/fake"]));
    expect(out.join("\n")).toContain("Initial release.");
    expect(await new ReleaseNotesCommand(services).run(inv([]))).toBe(2);
    expect(await new ReleaseNotesCommand(services).run(inv(["ops/none"]))).toBe(1);
  });
});

describe("build --only-changed", () => {
  const other = `---
title: Other
short: other
group: ops
version: "1.0"
effectiveDate: 2024-01-15
draft: true
---

[100.01] Top

[100.01(1)] text
`;

  it("builds only changed documents, marks them in the manifest, and keeps drafts out of the upload sheet", async () => {
    const git = new FakeGitClient("h")
      .addTag("ops/fake/v1.0", { [FILE]: DOC })
      .setRef("main", { [FILE]: DOC });
    const { services, fs, out } = setup({ git, files: { [ABS]: DOC.replace('"1.0"', '"1.1"'), "/proj/documents/ops/other.md": other } });
    expect(await new BuildCommand(services).run(inv([], { "only-changed": true, base: "main" }))).toBe(0);
    expect(out.join("\n")).toContain("2 changed document(s) to build, 0 unchanged skipped");
    const manifest = JSON.parse(fs.readText("/proj/dist/manifest.json"));
    expect(manifest.documents.map((d: { short: string; changed: boolean; draft: boolean }) => [d.short, d.changed, d.draft])).toEqual([
      ["fake", true, false],
      ["other", true, true],
    ]);
    const sheet = fs.readText("/proj/dist/upload-sheet.md");
    expect(sheet).toContain("| ops | fake | 1.1 |");
    expect(sheet).not.toContain("other");
    expect(fs.isFile("/proj/dist/ops/other-v1.0.pdf")).toBe(true); // drafts are still built
  });

  it("skips unchanged documents entirely", async () => {
    const git = new FakeGitClient("h").addTag("ops/fake/v1.0", { [FILE]: DOC });
    const { services, fs, out } = setup({ git });
    expect(await new BuildCommand(services).run(inv([], { "only-changed": true }))).toBe(0);
    expect(out.join("\n")).toContain("0 changed document(s) to build, 1 unchanged skipped");
    expect(fs.isFile("/proj/dist/ops/fake-v1.0.typ")).toBe(false);
    expect(fs.readText("/proj/dist/upload-sheet.md")).toContain("No documents to upload");
  });

  it("without the flag every document is built and changed is null (unknown)", async () => {
    const { services, fs } = setup();
    await new BuildCommand(services).run(inv());
    expect(JSON.parse(fs.readText("/proj/dist/manifest.json")).documents[0].changed).toBeNull();
  });

  it("appends a Summary of changes page only when configured", async () => {
    const tagged = DOC.replace("See", "Old text. See");
    const git = new FakeGitClient("h").addTag("ops/fake/v1.0", { [FILE]: tagged });
    const files = { [ABS]: DOC.replace('"1.0"', '"1.1"') };
    const off = setup({ git, files });
    await new BuildCommand(off.services).run(inv());
    expect(off.fs.readText("/proj/dist/ops/fake-v1.1.typ")).not.toContain("Summary of changes");

    const on = setup({ git, files: { ...files, "/proj/docengine.config.json": '{"summaryOfChanges": true}' } });
    await new BuildCommand(on.services).run(inv());
    const typ = on.fs.readText("/proj/dist/ops/fake-v1.1.typ");
    expect(typ).toContain("Summary of changes");
    expect(typ).toContain("Changed");
  });
});
