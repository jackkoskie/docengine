// SPDX-License-Identifier: MPL-2.0
import path from "node:path";
import { runChecked } from "./runner.mjs";

export const DMS_CHECKBOX = "- [ ] Uploaded to DMS";

/** Per-document upload sheet: the exact values staff enter in the DMS. */
export class UploadSheet {
  render(ref, entry) {
    const cell = (v) => (v === undefined || v === null || v === "" ? "none" : String(v));
    const rows = [
      ["Group slug", ref.group],
      ["Document short", ref.short],
      ["Version", ref.version],
      ["Effective date", cell(entry.effectiveDate)],
      ["Expiry date", cell(entry.expiryDate)],
      ["PDF file", ref.pdfFile],
      ["SHA-256", `\`${cell(entry.sha256)}\``],
      ["Source commit", cell(entry.commit)],
    ];
    return [
      `# Upload sheet: ${ref.id} v${ref.version}`,
      "",
      "| Field | Value |",
      "| --- | --- |",
      ...rows.map(([k, v]) => `| ${k} | ${v} |`),
      "",
    ].join("\n");
  }
}

/** Release body: engine notes, merged PR link, and the DMS upload checkbox. */
export class ReleaseBody {
  compose(notes, pull) {
    const parts = [notes.trim() || "No provision changes were reported."];
    if (pull) parts.push(`Merged in [#${pull.number} ${pull.title}](${pull.html_url}).`);
    parts.push("---", DMS_CHECKBOX);
    return `${parts.join("\n\n")}\n`;
  }
}

/** Finds the previous tag of a document (highest version tag other than the new one). */
export class TagIndex {
  constructor(runner, cwd) {
    this.runner = runner;
    this.cwd = cwd;
  }

  async exists(tag) {
    const r = await this.runner.run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: this.cwd });
    return r.code === 0;
  }

  async previous(ref) {
    const r = await runChecked(this.runner, "git", ["tag", "-l", ref.tagPattern, "--sort=-v:refname"], { cwd: this.cwd });
    return r.stdout.split(/\r?\n/).map((t) => t.trim()).find((t) => t && t !== ref.tag) ?? null;
  }
}

/** Creates one GitHub Release per document version. Skips tags that already exist. */
export class ReleasePublisher {
  constructor({ runner, files, tags, cli, github, sheet = new UploadSheet(), body = new ReleaseBody(), log = console.log }) {
    this.runner = runner;
    this.files = files;
    this.tags = tags;
    this.cli = cli;
    this.github = github;
    this.sheet = sheet;
    this.body = body;
    this.log = log;
  }

  /**
   * @returns {Promise<"created"|"skipped">}
   */
  async publish({ ref, title, entry, outDir, sha, cwd }) {
    if (await this.tags.exists(ref.tag)) {
      this.log(`Skipping ${ref.tag}: tag already exists`);
      return "skipped";
    }
    const pdf = path.join(outDir, ref.distPdfPath);
    if (!(await this.files.exists(pdf))) throw new Error(`PDF missing for ${ref.tag}: ${pdf}`);

    const stage = path.join(outDir, "release", ref.group, ref.short);
    const manifestPath = path.join(stage, "manifest-entry.json");
    const sheetPath = path.join(stage, "upload-sheet.md");
    const notesPath = path.join(stage, "release-notes.md");
    await this.files.write(manifestPath, `${JSON.stringify(entry, null, 2)}\n`);
    await this.files.write(sheetPath, this.sheet.render(ref, entry));

    const notes = await this.cli.releaseNotes(ref, await this.tags.previous(ref));
    await this.files.write(notesPath, this.body.compose(notes, await this.#pull(sha)));

    // A draft left by an interrupted run is replaced.
    const leftover = await this.runner.run("gh", ["release", "view", ref.tag], { cwd });
    if (leftover.code === 0) await runChecked(this.runner, "gh", ["release", "delete", ref.tag, "--yes"], { cwd });

    // Create as draft, then publish, so a release never appears half uploaded.
    await runChecked(
      this.runner,
      "gh",
      ["release", "create", ref.tag, pdf, manifestPath, sheetPath, "--draft", "--target", sha, "--title", `${title ?? ref.id} v${ref.version}`, "--notes-file", notesPath],
      { cwd },
    );
    await runChecked(this.runner, "gh", ["release", "edit", ref.tag, "--draft=false"], { cwd });
    this.log(`Created release ${ref.tag}`);
    return "created";
  }

  async #pull(sha) {
    try {
      const pulls = await this.github.listCommitPulls(sha);
      return pulls.find((p) => p.merged_at) ?? pulls[0] ?? null;
    } catch (error) {
      this.log(`Could not look up merged PR: ${error.message}`);
      return null;
    }
  }
}
