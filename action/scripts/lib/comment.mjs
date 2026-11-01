// SPDX-License-Identifier: MPL-2.0
export const MARKER = "<!-- docengine-preview -->";

const shortSha = (sha) => String(sha).slice(0, 7);
const inline = (text) =>
  String(text).replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** Builds the sticky PR comment. Pure: no I/O. */
export class CommentRenderer {
  /**
   * @param {{repository: string, branch: string, runUrl?: string}} options
   */
  constructor({ repository, branch, runUrl }) {
    this.repository = repository;
    this.branch = branch;
    this.runUrl = runUrl;
  }

  link(prNumber, doc) {
    return `https://github.com/${this.repository}/raw/${this.branch}/pr-${prNumber}/${doc.group}/${doc.short}.pdf`;
  }

  /** Successful, current build. */
  renderCurrent({ prNumber, report }) {
    const lines = [MARKER, "## Document preview", ""];
    lines.push(
      `**Status:** current. Built from \`${shortSha(report.headSha)}\` at ${report.builtAt} (build time ${report.buildSeconds}s).`,
      "",
    );
    lines.push(...this.#table(prNumber, report.documents, ""));
    lines.push(...this.#diff(report.diffMarkdown));
    lines.push(...this.#diagnostics(report.diagnostics, "warning"));
    return this.#finish(lines);
  }

  /** Failed build. `previous` is the last good meta from the previews branch, or null. */
  renderFailed({ prNumber, report, previous, headSha }) {
    const lines = [MARKER, "## Document preview", ""];
    lines.push(`**Status:** build failed for \`${shortSha(headSha)}\`. The preview below is out of date.`, "");
    for (const error of report?.errors ?? ["The build did not produce a report. See the workflow run for details."]) {
      lines.push(`> ${inline(error)}`);
    }
    lines.push("");
    lines.push(...this.#diagnostics(report?.diagnostics ?? [], null));
    if (previous?.documents?.length) {
      lines.push(
        `### Last good preview (out of date)`,
        "",
        `Built from \`${shortSha(previous.headSha)}\` at ${previous.builtAt}.`,
        "",
        ...this.#table(prNumber, previous.documents, " (out of date)"),
      );
    }
    return this.#finish(lines);
  }

  renderClosed() {
    return `${MARKER}\n## Document preview\n\nThis pull request is closed. Its preview files were removed.\n`;
  }

  #table(prNumber, documents, suffix) {
    if (documents.length === 0) return ["No documents changed in this pull request.", ""];
    const rows = ["| Document | Version | Preview |", "| --- | --- | --- |"];
    for (const d of documents) {
      const flag = d.draft ? " (draft)" : "";
      rows.push(
        `| ${inline(d.title)} (\`${d.group}/${d.short}\`)${flag} | ${inline(d.version)} | [PDF${suffix}](${this.link(prNumber, d)}) |`,
      );
    }
    return [...rows, ""];
  }

  #diff(markdown) {
    if (!markdown) return [];
    const safe = markdown.replace(/<!--/g, "&lt;!--");
    return ["<details open><summary>Provision and figure diff</summary>", "", safe, "", "</details>", ""];
  }

  #diagnostics(diagnostics, only) {
    const items = diagnostics.filter((d) => (only ? d.severity === only : d.severity !== "notice"));
    if (items.length === 0) return [];
    const heading = only === "warning" ? "Validation warnings" : "Validation messages";
    const lines = [`<details><summary>${heading} (${items.length})</summary>`, ""];
    for (const d of items) {
      const where = d.file ? `\`${d.file}${d.line ? `:${d.line}${d.col ? `:${d.col}` : ""}` : ""}\` ` : "";
      lines.push(`- ${d.severity}: ${where}${inline(d.message)}`);
    }
    return [...lines, "", "</details>", ""];
  }

  #finish(lines) {
    if (this.runUrl) lines.push(`<sub>[Workflow run](${this.runUrl})</sub>`);
    return `${lines.join("\n").trimEnd()}\n`;
  }
}

/** Creates or updates the one comment that carries MARKER. */
export class StickyComment {
  constructor(client) {
    this.client = client;
  }

  async find(prNumber) {
    const comments = await this.client.listComments(prNumber);
    return comments.find((c) => c.user?.type === "Bot" && c.body?.includes(MARKER)) ?? null;
  }

  async upsert(prNumber, body) {
    const existing = await this.find(prNumber);
    if (existing) {
      await this.client.updateComment(existing.id, body);
      return existing.id;
    }
    return (await this.client.createComment(prNumber, body)).id;
  }

  /** Updates the comment only if it exists. */
  async updateIfPresent(prNumber, body) {
    const existing = await this.find(prNumber);
    if (!existing) return false;
    await this.client.updateComment(existing.id, body);
    return true;
  }
}
