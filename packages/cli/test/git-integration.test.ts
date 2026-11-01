// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { NodeGitClient } from "../src/node/adapters.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hasGit = spawnSync("git", ["--version"]).status === 0;

async function run(cwd: string, args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main([...args, "--cwd", cwd], { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe.skipIf(!hasGit)("real git adapter", () => {
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "docengine-git-"));
    dirs.push(dir);
    cpSync(join(ROOT, "fixtures", "sample-repo"), dir, { recursive: true, filter: (s) => !s.includes("dist") });
    const git = (...a: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    git("tag", "operations/sample-policy/v1.0");
    return { dir, git };
  }

  it("NodeGitClient reads files, tags and refs", () => {
    const { dir } = repo();
    const g = new NodeGitClient();
    expect(g.refExists(dir, "HEAD")).toBe(true);
    expect(g.refExists(dir, "no-such-ref")).toBe(false);
    expect(g.listTags(dir, "operations/sample-policy/v")).toEqual(["operations/sample-policy/v1.0"]);
    expect(Buffer.from(g.readFileAt(dir, "HEAD", "docengine.config.json")!).toString()).toContain("Sample Flight");
    expect(g.readFileAt(dir, "HEAD", "missing.md")).toBeNull();
  });

  it("check, bump, diff and changed work end to end", async () => {
    const { dir } = repo();
    expect((await run(dir, ["changed", "--base", "HEAD", "--json"])).out).toBe("[]");

    const file = join(dir, "documents", "operations", "sample-policy.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("all** controllers", "all** staff"));
    const failing = await run(dir, ["check", "--base", "HEAD", "--format", "github"]);
    expect(failing.code).toBe(1);
    expect(failing.out).toMatch(/^::error file=documents\/operations\/sample-policy\.md,line=\d+,col=\d+::Content changed since HEAD/m);

    expect((await run(dir, ["bump", "operations/sample-policy", "minor"])).code).toBe(0);
    expect((await run(dir, ["check", "--base", "HEAD"])).code).toBe(0);
    const diff = JSON.parse((await run(dir, ["diff", "--base", "HEAD", "--format", "json"])).out);
    expect(diff.documents[0].provisions.changed.map((c: { id: string }) => c.id)).toEqual(["300.01(1)"]);
    const changed = JSON.parse((await run(dir, ["changed", "--base", "HEAD", "--json"])).out);
    expect(changed[0]).toMatchObject({ key: "operations/sample-policy", version: "1.1", previousVersion: "1.0", tag: "operations/sample-policy/v1.1" });
  });
});
