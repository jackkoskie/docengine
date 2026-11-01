// SPDX-License-Identifier: MPL-2.0
import path from "node:path";
import { DocumentRef } from "./documents.mjs";
import { runChecked } from "./runner.mjs";

const PR_DIR = /^pr-(\d+)$/;
const AUTHOR = ["-c", "user.name=docengine[bot]", "-c", "user.email=docengine-bot@users.noreply.github.com"];

/** Reads and writes the orphan `previews` branch. Binaries only ever live here. */
export class PreviewBranch {
  /**
   * @param {{runner: object, files: object, remoteUrl: string, branch?: string, attempts?: number}} deps
   */
  constructor({ runner, files, remoteUrl, branch = "previews", attempts = 5 }) {
    this.runner = runner;
    this.files = files;
    this.remoteUrl = remoteUrl;
    this.branch = branch;
    this.attempts = attempts;
  }

  /** Replaces `pr-<n>/` with the PDFs in `pdfDir` and records meta.json. */
  async publish(prNumber, { pdfDir, documents, headSha, builtAt }) {
    const meta = { headSha, builtAt, documents: documents.map(({ group, short, version, title }) => ({ group, short, version, title })) };
    await this.#update(`previews: pr-${prNumber} @ ${headSha.slice(0, 7)}`, async (dir) => {
      const target = path.join(dir, `pr-${prNumber}`);
      await this.files.remove(target);
      for (const d of documents) {
        const ref = DocumentRef.fromObject(d);
        await this.files.copy(path.join(pdfDir, ref.previewPdfPath), path.join(target, ref.previewPdfPath));
      }
      await this.files.write(path.join(target, "meta.json"), JSON.stringify(meta, null, 2));
    });
    return meta;
  }

  async remove(prNumber) {
    return this.#update(`previews: remove pr-${prNumber}`, (dir) => this.files.remove(path.join(dir, `pr-${prNumber}`)));
  }

  /** Removes pr-* folders whose PR is not in `openNumbers`. @returns {Promise<number[]>} removed PR numbers */
  async prune(openNumbers) {
    const open = new Set(openNumbers);
    const removed = [];
    await this.#update("previews: prune closed pull requests", async (dir) => {
      removed.length = 0;
      for (const entry of await this.files.list(dir)) {
        const match = PR_DIR.exec(entry.name);
        if (entry.isDirectory && match && !open.has(Number(match[1]))) {
          await this.files.remove(path.join(dir, entry.name));
          removed.push(Number(match[1]));
        }
      }
    });
    return removed;
  }

  /** @returns {Promise<object|null>} meta.json of the last good build for this PR */
  async readMeta(prNumber) {
    const dir = await this.files.makeTempDir("previews-read-");
    try {
      if (!(await this.#checkout(dir))) return null;
      const file = path.join(dir, `pr-${prNumber}`, "meta.json");
      return (await this.files.exists(file)) ? JSON.parse(await this.files.read(file)) : null;
    } finally {
      await this.files.remove(dir);
    }
  }

  async #git(dir, args, options) {
    return runChecked(this.runner, "git", [...AUTHOR, ...args], { cwd: dir, ...options });
  }

  /** Fetches the branch into `dir`, or starts an orphan branch. @returns {Promise<boolean>} whether the branch existed */
  async #checkout(dir) {
    await this.#git(dir, ["init", "--quiet"]);
    await this.#git(dir, ["remote", "add", "origin", this.remoteUrl]);
    const fetch = await this.runner.run("git", ["fetch", "--quiet", "--depth", "1", "origin", this.branch], { cwd: dir });
    if (fetch.code === 0) {
      await this.#git(dir, ["checkout", "--quiet", "-B", this.branch, "FETCH_HEAD"]);
      return true;
    }
    await this.#git(dir, ["checkout", "--quiet", "--orphan", this.branch]);
    return false;
  }

  async #update(message, mutate) {
    let lastError;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const dir = await this.files.makeTempDir("previews-write-");
      try {
        await this.#checkout(dir);
        await mutate(dir);
        await this.#git(dir, ["add", "-A"]);
        const status = await this.#git(dir, ["status", "--porcelain"]);
        if (!status.stdout.trim()) return false;
        await this.#git(dir, ["commit", "--quiet", "-m", message]);
        const push = await this.runner.run("git", ["push", "--quiet", "origin", `HEAD:refs/heads/${this.branch}`], { cwd: dir });
        if (push.code === 0) return true;
        lastError = new Error(`push failed: ${push.stderr}`);
      } finally {
        await this.files.remove(dir);
      }
    }
    throw lastError;
  }
}
