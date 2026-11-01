// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { CommentRenderer, MARKER, StickyComment } from "../scripts/lib/comment.mjs";
import { ResolveBaseCommand } from "../scripts/lib/commands.mjs";
import { DiagnosticParser } from "../scripts/lib/diagnostics.mjs";
import { DocumentRef } from "../scripts/lib/documents.mjs";
import { GitHubClient } from "../scripts/lib/github.mjs";
import { ReleaseBody, UploadSheet } from "../scripts/lib/releases.mjs";
import { FakeRunner, MemoryOutputs } from "./support.mjs";

test("DocumentRef builds tags and paths, and rejects traversal", () => {
  const ref = new DocumentRef("ops", "relief", "2.1");
  assert.equal(ref.tag, "ops/relief/v2.1");
  assert.equal(ref.distPdfPath, "ops/relief-v2.1.pdf");
  assert.equal(ref.previewPdfPath, "ops/relief.pdf");
  assert.throws(() => new DocumentRef("../x", "relief", "1.0"));
  assert.throws(() => new DocumentRef("ops", "a/b", "1.0"));
  assert.throws(() => new DocumentRef("ops", "relief", ""));
});

test("DiagnosticParser reads GitHub annotations", () => {
  const out = new DiagnosticParser().parse(
    [
      "::warning file=documents/ops/a.md,line=4,col=2::Depth is 7%0Aconsider flattening",
      "::error file=documents/ops/a.md,line=9::bad id",
      "plain text",
    ].join("\n"),
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { severity: "warning", file: "documents/ops/a.md", line: 4, col: 2, message: "Depth is 7\nconsider flattening" });
  assert.equal(out[1].severity, "error");
});

const renderer = new CommentRenderer({ repository: "o/r", branch: "previews", runUrl: "https://x/run" });
const doc = { group: "ops", short: "relief", version: "2.1", title: "Relief <b>", draft: false };

test("renderCurrent links the PDF, sha, diff and warnings, with the marker", () => {
  const body = renderer.renderCurrent({
    prNumber: 7,
    report: {
      headSha: "abcdef1234567",
      builtAt: "2026-01-01T00:00:00Z",
      buildSeconds: 12,
      documents: [doc],
      diffMarkdown: "added 100.1 <!-- evil -->",
      diagnostics: [{ severity: "warning", file: "a.md", line: 3, col: 1, message: "figure unused" }],
    },
  });
  assert.ok(body.startsWith(MARKER));
  assert.ok(body.includes("https://github.com/o/r/raw/previews/pr-7/ops/relief.pdf"));
  assert.ok(body.includes("`abcdef1`"));
  assert.ok(body.includes("12s"));
  assert.ok(body.includes("Relief &lt;b&gt;"));
  assert.ok(!body.includes("<!-- evil"));
  assert.ok(body.includes("figure unused"));
});

test("renderFailed shows errors and marks the last good PDF out of date", () => {
  const body = renderer.renderFailed({
    prNumber: 7,
    headSha: "1111111222",
    report: { errors: ["`docengine check` failed."], diagnostics: [{ severity: "error", file: "a.md", line: 1, col: 1, message: "bad" }] },
    previous: { headSha: "0000000999", builtAt: "t", documents: [doc] },
  });
  assert.ok(body.includes("build failed"));
  assert.ok(body.includes("out of date"));
  assert.ok(body.includes("PDF (out of date)"));
  assert.ok(body.includes("error: `a.md:1:1` bad"));
});

test("StickyComment updates the existing bot comment and never duplicates", async () => {
  const calls = [];
  const client = {
    listComments: async () => [
      { id: 1, user: { type: "User" }, body: MARKER },
      { id: 2, user: { type: "Bot" }, body: `${MARKER} old` },
    ],
    updateComment: async (id) => calls.push(["update", id]),
    createComment: async () => calls.push(["create"]),
  };
  await new StickyComment(client).upsert(5, "new");
  assert.deepEqual(calls, [["update", 2]]);
  client.listComments = async () => [];
  client.createComment = async () => (calls.push(["create"]), { id: 9 });
  await new StickyComment(client).upsert(5, "new");
  assert.deepEqual(calls[1], ["create"]);
});

test("ResolveBaseCommand covers explicit, PR, push and fallback", async () => {
  const runner = new FakeRunner([["merge-base", { stdout: "mb123\n" }]]);
  const cmd = new ResolveBaseCommand({ runner, outputs: new MemoryOutputs(), cwd: ".", log: () => {} });
  assert.equal(await cmd.run({ explicit: "v1", eventName: "push", prBaseSha: "", pushBefore: "" }), "v1");
  assert.equal(await cmd.run({ explicit: "", eventName: "pull_request", prBaseSha: "b", pushBefore: "" }), "mb123");
  assert.equal(await cmd.run({ explicit: "", eventName: "push", prBaseSha: "", pushBefore: "abc" }), "abc");
  assert.equal(await cmd.run({ explicit: "", eventName: "push", prBaseSha: "", pushBefore: "0000000" }), "HEAD~1");
});

test("UploadSheet and ReleaseBody include required values and the DMS checkbox", () => {
  const ref = new DocumentRef("ops", "relief", "2.1");
  const sheet = new UploadSheet().render(ref, { effectiveDate: "2026-02-01", sha256: "ab" });
  assert.ok(sheet.includes("| Group slug | ops |"));
  assert.ok(sheet.includes("| Expiry date | none |"));
  const body = new ReleaseBody().compose("Changed 100.1", { number: 4, title: "T", html_url: "https://x/4" });
  assert.ok(body.includes("[#4 T](https://x/4)"));
  assert.ok(body.trimEnd().endsWith("- [ ] Uploaded to DMS"));
});

test("GitHubClient paginates and sends auth", async () => {
  const pages = [Array(100).fill({ n: 1 }), [{ n: 2 }]];
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push([url, init.headers.authorization]);
    const items = pages.shift();
    return { status: 200, ok: true, text: async () => JSON.stringify(items) };
  };
  const client = new GitHubClient({ token: "t", repository: "o/r", fetchFn });
  assert.equal((await client.paginate("/pulls")).length, 101);
  assert.ok(seen[1][0].endsWith("/repos/o/r/pulls?per_page=100&page=2"));
  assert.equal(seen[0][1], "Bearer t");
});
