// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { CommentRenderer, StickyComment } from "../scripts/lib/comment.mjs";
import { PreviewPublishCommand, PreviewPruneCommand, ReleaseCommand } from "../scripts/lib/commands.mjs";
import { DiagnosticParser } from "../scripts/lib/diagnostics.mjs";
import { DocumentRef, ManifestFile } from "../scripts/lib/documents.mjs";
import { PreviewBranch } from "../scripts/lib/previews.mjs";
import { ReleasePublisher, TagIndex } from "../scripts/lib/releases.mjs";
import { PreviewBuilder, PreviewReportReader } from "../scripts/lib/report.mjs";
import { NodeCommandRunner } from "../scripts/lib/runner.mjs";
import { FakeRunner, MemoryOutputs, PDF, files } from "./support.mjs";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const silent = () => {};

async function fakeBuildTree() {
  const root = await files.makeTempDir("de-test-");
  const dist = path.join(root, "dist");
  await files.write(path.join(dist, "ops", "relief-v2.1.pdf"), PDF);
  await files.write(
    path.join(dist, "manifest.json"),
    JSON.stringify({ documents: [{ group: "ops", short: "relief", version: "2.1", title: "Relief", sha256: "ab12", effectiveDate: "2026-02-01" }] }),
  );
  return { root, dist, report: path.join(root, "report") };
}

function fakeCli({ checkCode = 0, buildCode = 0 } = {}) {
  return {
    check: async () => ({ code: checkCode, output: "::warning file=a.md,line=2,col=1::unused figure\n" }),
    build: async () => ({ code: buildCode, output: "boom" }),
    diff: async (_b, format) => ({ code: 0, stdout: format === "json" ? "{}" : "added 100.1" }),
    changed: async () => [{ ref: new DocumentRef("ops", "relief", "2.1"), title: "Relief" }],
    releaseNotes: async () => "Added 100.1",
  };
}

function builder(tree, cli) {
  return new PreviewBuilder({
    cli,
    files,
    manifest: new ManifestFile(files, path.join(tree.dist, "manifest.json")),
    diagnostics: new DiagnosticParser(),
    clock: { now: () => new Date("2026-01-01T00:00:10Z") },
    log: silent,
  });
}

test("PreviewBuilder writes a report the trusted reader accepts", async () => {
  const tree = await fakeBuildTree();
  const report = await builder(tree, fakeCli()).build({ base: "b", prNumber: 3, headSha: "a".repeat(40), outDir: tree.dist, reportDir: tree.report });
  assert.equal(report.status, "success");
  const read = await new PreviewReportReader(files).read(tree.report);
  assert.equal(read.documents[0].short, "relief");
  assert.equal(read.diagnostics[0].severity, "warning");
  assert.equal(read.diffMarkdown, "added 100.1");
  assert.ok(await files.exists(path.join(tree.report, "pdfs", "ops", "relief.pdf")));
});

test("PreviewBuilder reports failure when check fails and does not build", async () => {
  const tree = await fakeBuildTree();
  const report = await builder(tree, fakeCli({ checkCode: 1 })).build({ base: "b", prNumber: 3, headSha: "a", outDir: tree.dist, reportDir: tree.report });
  assert.equal(report.status, "failure");
  assert.equal(report.documents.length, 0);
});

test("PreviewReportReader rejects non-PDF files and bad names", async () => {
  const tree = await fakeBuildTree();
  await builder(tree, fakeCli()).build({ base: "b", prNumber: 3, headSha: "a", outDir: tree.dist, reportDir: tree.report });
  await files.write(path.join(tree.report, "pdfs", "ops", "relief.pdf"), "<html>");
  await assert.rejects(new PreviewReportReader(files).read(tree.report), /Not a PDF/);
  const bad = JSON.parse(await files.read(path.join(tree.report, "report.json")));
  bad.documents[0].group = "../etc";
  await files.write(path.join(tree.report, "report.json"), JSON.stringify(bad));
  await assert.rejects(new PreviewReportReader(files).read(tree.report), /Invalid document group/);
});

function publishHarness({ meta, pullHeads, branchMeta }) {
  const log = { statuses: [], comments: [], published: [] };
  const heads = [...pullHeads];
  const github = {
    getPull: async () => ({ state: "open", head: { sha: heads.length > 1 ? heads.shift() : heads[0] } }),
    setStatus: async (sha, s) => log.statuses.push([sha, s.state, s.context]),
  };
  const sticky = { upsert: async (n, body) => log.comments.push(body) };
  const branch = {
    publish: async (n, args) => (log.published.push(n), Object.assign(meta, { headSha: args.headSha })),
    readMeta: async () => (branchMeta === undefined ? meta : branchMeta),
  };
  const reader = { read: async () => harnessReport };
  let harnessReport;
  const command = new PreviewPublishCommand({
    github, reader, branch, sticky, renderer: new CommentRenderer({ repository: "o/r", branch: "previews" }), log: silent,
  });
  return { command, log, setReport: (r) => (harnessReport = r) };
}

const goodReport = { status: "success", prNumber: 3, headSha: "h", builtAt: "t", buildSeconds: 1, documents: [], diagnostics: [], errors: [], diffMarkdown: "" };
const run = (command, over = {}) => command.run({ artifactDir: "a", runHeadSha: "h", runConclusion: "success", prHint: "", runUrl: "", ...over });

test("publish: success sets preview-current success", async () => {
  const h = publishHarness({ meta: {}, pullHeads: ["h"] });
  h.setReport(goodReport);
  assert.equal(await run(h.command), "published");
  assert.deepEqual(h.log.statuses, [["h", "success", "preview-current"]]);
  assert.equal(h.log.comments.length, 1);
});

test("publish: failed build keeps last good preview out of date and fails the status", async () => {
  const h = publishHarness({ meta: {}, pullHeads: ["h"], branchMeta: { headSha: "old", builtAt: "t", documents: [{ group: "ops", short: "relief", version: "1", title: "R" }] } });
  h.setReport({ ...goodReport, status: "failure", errors: ["x"] });
  assert.equal(await run(h.command), "failed");
  assert.equal(h.log.statuses[0][1], "failure");
  assert.ok(h.log.comments[0].includes("out of date"));
  assert.deepEqual(h.log.published, []);
});

test("publish: superseded run neither publishes nor sets a status", async () => {
  const h = publishHarness({ meta: {}, pullHeads: ["newer"] });
  h.setReport(goodReport);
  assert.equal(await run(h.command), "superseded");
  assert.deepEqual(h.log.statuses, []);
});

test("publish: PR that moves during publishing gets no status from the stale run", async () => {
  const h = publishHarness({ meta: {}, pullHeads: ["h", "newer"] });
  h.setReport(goodReport);
  assert.equal(await run(h.command), "superseded");
  assert.deepEqual(h.log.statuses, []);
});

test("PreviewPruneCommand passes open PR numbers to the branch", async () => {
  let received;
  const cmd = new PreviewPruneCommand({
    github: { listOpenPulls: async () => [{ number: 1 }, { number: 4 }] },
    branch: { prune: async (open) => ((received = open), [9]) },
    log: silent,
  });
  assert.deepEqual(await cmd.run(), [9]);
  assert.deepEqual(received, [1, 4]);
});

test("ReleasePublisher creates a draft release with assets, then publishes; skips existing tags", async () => {
  const tree = await fakeBuildTree();
  const runner = new FakeRunner([
    [/rev-parse/, (line) => ({ code: line.includes("ops/relief/v1.0") ? 0 : 1 })],
    [/tag -l/, { stdout: "ops/relief/v2.1\nops/relief/v2.0\n" }],
    [/release view/, { code: 1 }],
  ]);
  const cli = { releaseNotes: async (ref, base) => `notes since ${base}` };
  const github = { listCommitPulls: async () => [{ number: 8, title: "Update", html_url: "https://x/8", merged_at: "t" }] };
  const publisher = new ReleasePublisher({ runner, files, tags: new TagIndex(runner, "."), cli, github, log: silent });
  const ref = new DocumentRef("ops", "relief", "2.1");
  const entry = await new ManifestFile(files, path.join(tree.dist, "manifest.json")).entryFor(ref);
  assert.equal(await publisher.publish({ ref, title: "Relief", entry, outDir: tree.dist, sha: "s", cwd: "." }), "created");
  const lines = runner.lines();
  const create = lines.find((l) => l.startsWith("gh release create"));
  assert.ok(create.includes("ops/relief/v2.1") && create.includes("--draft") && create.includes("upload-sheet.md") && create.includes("manifest-entry.json") && create.includes("relief-v2.1.pdf"));
  assert.ok(lines.some((l) => l.startsWith("gh release edit ops/relief/v2.1 --draft=false")));
  const notes = await files.read(path.join(tree.dist, "release", "ops", "relief", "release-notes.md"));
  assert.ok(notes.includes("notes since ops/relief/v2.0") && notes.includes("- [ ] Uploaded to DMS"));

  const existing = new DocumentRef("ops", "relief", "1.0");
  runner.calls.length = 0;
  assert.equal(await publisher.publish({ ref: existing, entry: {}, outDir: tree.dist, sha: "s", cwd: "." }), "skipped");
  assert.ok(!runner.lines().some((l) => l.startsWith("gh release create")));
});

test("ReleaseCommand skips everything when all tags exist (idempotent)", async () => {
  const outputs = new MemoryOutputs();
  let built = false;
  const cli = { ...fakeCli(), build: async () => ((built = true), { code: 0, output: "" }) };
  const cmd = new ReleaseCommand({
    cli,
    tags: { exists: async () => true },
    publisher: { publish: async () => assert.fail("must not publish") },
    files,
    runner: new FakeRunner(),
    outputs,
    log: silent,
  });
  assert.deepEqual(await cmd.run({ base: "b", outDir: "d", cwd: ".", sha: "s" }), []);
  assert.equal(built, false);
  assert.deepEqual(outputs.values["release-tags"], []);
});

test("PreviewBranch publishes to an orphan branch, replaces, reads meta, prunes and removes (real git)", { skip: !hasGit }, async () => {
  const root = await files.makeTempDir("de-git-");
  const bare = path.join(root, "remote.git");
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("init", "--bare", "--quiet", bare).status, 0);
  const branch = new PreviewBranch({ runner: new NodeCommandRunner(), files, remoteUrl: bare, branch: "previews" });

  const pdfDir = path.join(root, "pdfs");
  await files.write(path.join(pdfDir, "ops", "relief.pdf"), PDF);
  const docs = [{ group: "ops", short: "relief", version: "2.1", title: "Relief" }];
  assert.equal(await branch.readMeta(1), null);
  await branch.publish(1, { pdfDir, documents: docs, headSha: "sha1", builtAt: "t" });
  await branch.publish(2, { pdfDir, documents: docs, headSha: "sha2", builtAt: "t" });
  await branch.publish(1, { pdfDir, documents: docs, headSha: "sha1b", builtAt: "t" });
  assert.equal((await branch.readMeta(1)).headSha, "sha1b");

  const tree = git("--git-dir", bare, "ls-tree", "-r", "--name-only", "previews").stdout;
  assert.ok(tree.includes("pr-1/ops/relief.pdf") && tree.includes("pr-2/meta.json"));
  assert.equal(git("--git-dir", bare, "rev-list", "--max-parents=0", "previews").stdout.trim().split("\n").length, 1);

  assert.deepEqual(await branch.prune([2]), [1]);
  await branch.remove(2);
  assert.equal(git("--git-dir", bare, "ls-tree", "-r", "--name-only", "previews").stdout.trim(), "");
});
