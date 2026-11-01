// SPDX-License-Identifier: MPL-2.0
import { ManifestFile } from "./documents.mjs";

export const STATUS_CONTEXT = "preview-current";
const ZERO_SHA = /^0+$/;

/** Picks the comparison base: explicit input, PR merge base, or the push's previous head. */
export class ResolveBaseCommand {
  constructor({ runner, outputs, cwd, log = console.log }) {
    Object.assign(this, { runner, outputs, cwd, log });
  }

  async run({ explicit, eventName, prBaseSha, pushBefore }) {
    const base = await this.#resolve({ explicit, eventName, prBaseSha, pushBefore });
    this.log(`Comparison base: ${base}`);
    await this.outputs.set("base", base);
    return base;
  }

  async #resolve({ explicit, eventName, prBaseSha, pushBefore }) {
    if (explicit) return explicit;
    if (eventName.startsWith("pull_request") && prBaseSha) {
      const r = await this.runner.run("git", ["merge-base", "HEAD", prBaseSha], { cwd: this.cwd });
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : prBaseSha;
    }
    if (eventName === "push" && pushBefore && !ZERO_SHA.test(pushBefore)) return pushBefore;
    return "HEAD~1";
  }
}

/** Mode `check`: validation plus version-bump check with GitHub annotations. */
export class CheckCommand {
  constructor({ cli, outputs }) {
    Object.assign(this, { cli, outputs });
  }

  async run(base) {
    const { code } = await this.cli.check(base);
    await this.outputs.set("status", code === 0 ? "success" : "failure");
    return code;
  }
}

/** Mode `preview` (untrusted side): builds and writes the report folder. */
export class PreviewBuildCommand {
  constructor({ builder, outputs }) {
    Object.assign(this, { builder, outputs });
  }

  async run({ base, prNumber, headSha, outDir, reportDir }) {
    const report = await this.builder.build({ base, prNumber, headSha, outDir, reportDir });
    await this.outputs.set("status", report.status);
    await this.outputs.set("changed-documents", report.documents.map((d) => `${d.group}/${d.short}`));
    await this.outputs.set("has-changes", String(report.documents.length > 0));
    await this.outputs.set("report-path", reportDir);
    return report.status === "success" ? 0 : 1;
  }
}

/**
 * Trusted side of the preview: verify the artifact, publish PDFs to the previews branch,
 * update the sticky comment and set the `preview-current` status. Never runs PR code.
 */
export class PreviewPublishCommand {
  constructor({ github, reader, branch, sticky, renderer, log = console.log }) {
    Object.assign(this, { github, reader, branch, sticky, renderer, log });
  }

  /** @returns {Promise<"published"|"failed"|"superseded"|"skipped">} */
  async run({ artifactDir, runHeadSha, runConclusion, prHint, runUrl }) {
    let report = null;
    let invalid = false;
    try {
      report = await this.reader.read(artifactDir);
    } catch (error) {
      this.log(`Rejected artifact: ${error.message}`);
      invalid = true;
    }

    const prNumber = report?.prNumber || Number(prHint) || 0;
    if (!prNumber) {
      this.log("No pull request could be determined; nothing to do.");
      return "skipped";
    }
    // The run's head SHA comes from the trusted event. The PR number from the artifact is only a hint.
    const pull = await this.github.getPull(prNumber);
    if (pull.state !== "open" || pull.head.sha !== runHeadSha) {
      this.log(`Run ${runHeadSha} is not the head of open PR #${prNumber}; superseded.`);
      return "superseded";
    }

    const succeeded = !invalid && report?.status === "success" && runConclusion === "success";
    let outcome;
    if (succeeded) {
      await this.branch.publish(prNumber, {
        pdfDir: `${artifactDir}/pdfs`,
        documents: report.documents,
        headSha: runHeadSha,
        builtAt: report.builtAt,
      });
      const meta = await this.branch.readMeta(prNumber);
      outcome = meta?.headSha === runHeadSha ? "published" : "failed";
      await this.sticky.upsert(prNumber, this.renderer.renderCurrent({ prNumber, report }));
    } else {
      const previous = await this.branch.readMeta(prNumber);
      outcome = "failed";
      await this.sticky.upsert(prNumber, this.renderer.renderFailed({ prNumber, report, previous, headSha: runHeadSha }));
    }

    // Re-check the head: if the PR moved while we worked, the newer run reports its own status.
    const latest = await this.github.getPull(prNumber);
    if (latest.head.sha !== runHeadSha) return "superseded";
    await this.github.setStatus(runHeadSha, {
      state: outcome === "published" ? "success" : "failure",
      context: STATUS_CONTEXT,
      description: outcome === "published" ? `Preview matches ${runHeadSha.slice(0, 7)}` : "Preview is out of date: build failed",
      targetUrl: runUrl || undefined,
    });
    return outcome;
  }
}

/** PR closed: delete pr-<n>/ and mark the comment. */
export class PreviewCleanupCommand {
  constructor({ branch, sticky, renderer }) {
    Object.assign(this, { branch, sticky, renderer });
  }

  async run(prNumber) {
    await this.branch.remove(prNumber);
    await this.sticky.updateIfPresent(prNumber, this.renderer.renderClosed());
  }
}

/** Weekly: delete pr-<n>/ for PRs that are no longer open. */
export class PreviewPruneCommand {
  constructor({ github, branch, log = console.log }) {
    Object.assign(this, { github, branch, log });
  }

  async run() {
    const open = (await this.github.listOpenPulls()).map((p) => p.number);
    const removed = await this.branch.prune(open);
    this.log(`Pruned: ${removed.length ? removed.map((n) => `pr-${n}`).join(", ") : "nothing"}`);
    return removed;
  }
}

/** On merge to main: one release per changed non-draft document. */
export class ReleaseCommand {
  constructor({ cli, tags, publisher, files, runner, outputs, log = console.log }) {
    Object.assign(this, { cli, tags, publisher, files, runner, outputs, log });
  }

  async run({ base, outDir, cwd, sha }) {
    await this.runner.run("git", ["fetch", "--tags", "--quiet", "origin"], { cwd });
    const changed = await this.cli.changed(base);
    const pending = [];
    for (const item of changed) {
      if (await this.tags.exists(item.ref.tag)) this.log(`Skipping ${item.ref.tag}: tag already exists`);
      else pending.push(item);
    }
    await this.outputs.set("changed-documents", changed.map((c) => c.ref.id));
    if (pending.length === 0) {
      await this.outputs.set("release-tags", []);
      return [];
    }

    const build = await this.cli.build(base);
    if (build.code !== 0) throw new Error("docengine build failed; no releases were created.");
    const manifest = new ManifestFile(this.files, `${outDir}/manifest.json`);

    const created = [];
    for (const { ref, title } of pending) {
      const entry = await manifest.entryFor(ref);
      if (!entry) throw new Error(`manifest.json has no entry for ${ref.tag}`);
      const result = await this.publisher.publish({ ref, title: title ?? entry.title, entry, outDir, sha, cwd });
      if (result === "created") created.push(ref.tag);
    }
    await this.outputs.set("release-tags", created);
    return created;
  }
}

