// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DocengineCli } from "../scripts/lib/cli.mjs";
import { CommentRenderer } from "../scripts/lib/comment.mjs";
import { DiagnosticParser } from "../scripts/lib/diagnostics.mjs";
import { ManifestFile } from "../scripts/lib/documents.mjs";
import { PreviewBuilder, PreviewReportReader } from "../scripts/lib/report.mjs";
import { FakeRunner, PDF, files } from "./support.mjs";

/**
 * The files in ./captured are real output of the docengine CLI, recorded against a temporary git
 * repo made from fixtures/example-policy (base commit, then version 1.1 plus an edited section).
 * They guard the contract between the CLI and the Action scripts.
 */
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "captured");
const captured = (name) => files.read(path.join(dir, name));

async function replayCli(checkFile = "check-ok.txt") {
  const stdout = {
    check: await captured(checkFile),
    diffMd: await captured("diff.md"),
    diffJson: await captured("diff.json"),
    changed: await captured("changed.json"),
    notes: await captured("release-notes.md"),
  };
  const checkCode = checkFile === "check-ok.txt" ? 0 : 1;
  const runner = new FakeRunner([
    ["check --base", { code: checkCode, stdout: stdout.check }],
    ["diff --base b --format markdown", { stdout: stdout.diffMd }],
    ["diff --base b --format json", { stdout: stdout.diffJson }],
    ["changed --base", { stdout: stdout.changed }],
    ["release-notes", { stdout: stdout.notes }],
    ["build --only-changed", { stdout: "built dist/operations/departure-release-v1.1.pdf\n" }],
  ]);
  return { runner, cli: new DocengineCli({ runner, commandLine: { command: "docengine", args: [] }, cwd: "." }) };
}

async function builderWithManifest() {
  const root = await files.makeTempDir("de-captured-");
  const dist = path.join(root, "dist");
  await files.write(path.join(dist, "manifest.json"), await captured("manifest.json"));
  await files.write(path.join(dist, "operations", "departure-release-v1.1.pdf"), PDF);
  return { root, dist, report: path.join(root, "report") };
}

const makeBuilder = (cli, tree) =>
  new PreviewBuilder({
    cli,
    files,
    manifest: new ManifestFile(files, path.join(tree.dist, "manifest.json")),
    diagnostics: new DiagnosticParser(),
    clock: { now: () => new Date("2026-01-01T00:00:10Z") },
    log: () => {},
  });

test("real captured CLI output flows through the report builder and comment renderer", async () => {
  const { cli } = await replayCli();
  const tree = await builderWithManifest();
  const report = await makeBuilder(cli, tree).build({ base: "b", prNumber: 7, headSha: "c".repeat(40), outDir: tree.dist, reportDir: tree.report });
  assert.equal(report.status, "success");
  assert.deepEqual(report.errors, []);
  assert.equal(report.documents.length, 1);
  assert.equal(report.documents[0].group, "operations");
  assert.equal(report.documents[0].short, "departure-release");
  assert.equal(report.documents[0].version, "1.1");
  assert.match(report.diffMarkdown, /\*\*Provisions\*\*/);
  assert.match(report.diffMarkdown, /Changed Subsection 200\.01\(1\)/);

  const read = await new PreviewReportReader(files).read(tree.report);
  assert.equal(read.documents[0].title, "Departure Release (DR) Authority");
  const body = new CommentRenderer({ repository: "o/r", branch: "previews" }).renderCurrent({ prNumber: 7, report: read });
  assert.match(body, /departure-release/);
  assert.match(body, /Provision and figure diff/);
  assert.match(body, /Changed Subsection 200\.01\(1\)/);
});

test("captured github annotations parse into diagnostics, including failures", async () => {
  const parser = new DiagnosticParser();
  const bad = parser.parse(await captured("check-bad.txt"));
  assert.deepEqual(
    bad.map((d) => d.severity),
    ["warning", "error"],
  );
  assert.equal(bad[1].file, "documents/operations/departure-release.md");
  assert.equal(bad[1].line, 20);
  assert.equal(bad[1].col, 1);
  assert.match(bad[1].message, /^Subsection 200\.01\(3\) is out of sequence/);

  const { cli } = await replayCli("check-bad.txt");
  const tree = await builderWithManifest();
  const report = await makeBuilder(cli, tree).build({ base: "b", prNumber: 7, headSha: "d", outDir: tree.dist, reportDir: tree.report });
  assert.equal(report.status, "failure");
  assert.equal(report.documents.length, 0);
  assert.equal(report.diagnostics.filter((d) => d.severity === "error").length, 1);
});

test("captured `changed --json` and `release-notes` output are understood", async () => {
  const { cli, runner } = await replayCli();
  const changed = await cli.changed("b");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].ref.tag, "operations/departure-release/v1.1");
  assert.equal(changed[0].title, "Departure Release (DR) Authority");
  const notes = await cli.releaseNotes(changed[0].ref, "operations/departure-release/v1.0");
  assert.match(notes, /^# Departure Release \(DR\) Authority v1\.1/);
  assert.match(notes, /\{\{PR_URL\}\}/);
  assert.ok(runner.lines().some((l) => l.includes("release-notes operations/departure-release --base operations/departure-release/v1.0")));
});

test("captured diff --format json has the shape the Action stores", async () => {
  const diff = JSON.parse(await captured("diff.json"));
  assert.equal(diff.documents[0].key, "operations/departure-release");
  assert.deepEqual(diff.documents[0].version, { from: "1.0", to: "1.1" });
  assert.ok(Array.isArray(diff.documents[0].provisions.changed));
});
