// SPDX-License-Identifier: MPL-2.0
import path from "node:path";
import { DocumentRef } from "./documents.mjs";

export const REPORT_FILE = "report.json";
const MAX_DIFF = 50_000;
const MAX_TEXT = 500;
const MAX_ITEMS = 200;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n... (truncated)` : text;
}

/**
 * Untrusted build side: runs check, build and diff, then writes a report folder:
 *   report.json, pdfs/<group>/<short>.pdf, diff.md, diff.json
 * The folder is the workflow artifact the trusted publish job consumes.
 */
export class PreviewBuilder {
  constructor({ cli, files, manifest, diagnostics, clock, log = console.log }) {
    this.cli = cli;
    this.files = files;
    this.manifest = manifest;
    this.diagnostics = diagnostics;
    this.clock = clock;
    this.log = log;
  }

  /** @returns {Promise<object>} the report that was written */
  async build({ base, prNumber, headSha, outDir, reportDir }) {
    const started = this.clock.now();
    const errors = [];
    let diagnostics = [];
    let documents = [];
    let diffMarkdown = "";

    const check = await this.cli.check(base);
    diagnostics = this.diagnostics.parse(check.output);
    if (check.code !== 0) {
      errors.push("`docengine check` failed.");
    } else {
      const build = await this.cli.build(base);
      if (build.code !== 0) errors.push(`\`docengine build\` failed:\n${truncate(build.output.trim(), 2000)}`);
      else documents = await this.#collect(outDir, reportDir, errors);
    }

    if (errors.length === 0 || check.code === 0) {
      diffMarkdown = await this.#diff(base, reportDir);
    }

    const finished = this.clock.now();
    const report = {
      schemaVersion: 1,
      status: errors.length === 0 ? "success" : "failure",
      prNumber,
      headSha,
      builtAt: finished.toISOString(),
      buildSeconds: Math.max(0, Math.round((finished - started) / 1000)),
      documents,
      diagnostics,
      errors,
      diffMarkdown,
    };
    await this.files.write(path.join(reportDir, REPORT_FILE), JSON.stringify(report, null, 2));
    return report;
  }

  async #collect(outDir, reportDir, errors) {
    const documents = [];
    for (const entry of await this.manifest.entries()) {
      let ref;
      try {
        ref = DocumentRef.fromObject(entry);
      } catch (error) {
        errors.push(error.message);
        continue;
      }
      const source = path.join(outDir, ref.distPdfPath);
      if (!(await this.files.exists(source))) {
        errors.push(`Expected PDF was not built: ${ref.distPdfPath}`);
        continue;
      }
      await this.files.copy(source, path.join(reportDir, "pdfs", ref.previewPdfPath));
      documents.push({
        group: ref.group,
        short: ref.short,
        version: ref.version,
        title: String(entry.title ?? ref.short),
        draft: entry.draft === true,
        sha256: String(entry.sha256 ?? ""),
      });
    }
    return documents;
  }

  async #diff(base, reportDir) {
    try {
      const md = await this.cli.diff(base, "markdown");
      const json = await this.cli.diff(base, "json");
      if (json.code === 0) await this.files.write(path.join(reportDir, "diff.json"), json.stdout);
      if (md.code === 0) {
        await this.files.write(path.join(reportDir, "diff.md"), md.stdout);
        return truncate(md.stdout.trim(), MAX_DIFF);
      }
    } catch (error) {
      this.log(`diff skipped: ${error.message}`);
    }
    return "";
  }
}

/** Trusted side: strictly validates an artifact that came from untrusted code. */
export class PreviewReportReader {
  constructor(files) {
    this.files = files;
  }

  /** @returns {Promise<object|null>} null when the report is missing or invalid */
  async read(dir) {
    const file = path.join(dir, REPORT_FILE);
    if (!(await this.files.exists(file))) return null;
    let raw;
    try {
      raw = JSON.parse(await this.files.read(file));
    } catch {
      return null;
    }
    if (raw?.schemaVersion !== 1 || !["success", "failure"].includes(raw.status)) return null;
    const documents = [];
    for (const d of Array.isArray(raw.documents) ? raw.documents.slice(0, MAX_ITEMS) : []) {
      const ref = DocumentRef.fromObject(d);
      const pdf = path.join(dir, "pdfs", ref.previewPdfPath);
      if (!(await this.files.exists(pdf))) throw new Error(`Missing PDF for ${ref.id}`);
      if ((await this.files.size(pdf)) > MAX_PDF_BYTES) throw new Error(`PDF too large for ${ref.id}`);
      if ((await this.files.readBytes(pdf)).subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw new Error(`Not a PDF: ${ref.id}`);
      }
      documents.push({
        group: ref.group,
        short: ref.short,
        version: ref.version,
        title: String(d.title ?? ref.short).slice(0, MAX_TEXT),
        draft: d.draft === true,
        sha256: String(d.sha256 ?? "").replace(/[^0-9a-f]/gi, "").slice(0, 64),
      });
    }
    const diagnostics = (Array.isArray(raw.diagnostics) ? raw.diagnostics : []).slice(0, MAX_ITEMS).map((d) => ({
      severity: ["error", "warning", "notice"].includes(d.severity) ? d.severity : "notice",
      file: String(d.file ?? "").slice(0, MAX_TEXT),
      line: Number(d.line) || 0,
      col: Number(d.col) || 0,
      message: String(d.message ?? "").slice(0, MAX_TEXT),
    }));
    return {
      status: raw.status,
      prNumber: Number(raw.prNumber) || 0,
      headSha: String(raw.headSha ?? ""),
      builtAt: String(raw.builtAt ?? "").slice(0, 40),
      buildSeconds: Number(raw.buildSeconds) || 0,
      documents,
      diagnostics,
      errors: (Array.isArray(raw.errors) ? raw.errors : []).slice(0, 20).map((e) => truncate(String(e), 2000)),
      diffMarkdown: truncate(String(raw.diffMarkdown ?? ""), MAX_DIFF),
    };
  }
}
