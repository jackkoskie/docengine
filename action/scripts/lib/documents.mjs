// SPDX-License-Identifier: MPL-2.0
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

/** Identity of one document version. Validates every part, so it is safe to use in paths and tags. */
export class DocumentRef {
  constructor(group, short, version) {
    for (const [label, value, pattern] of [
      ["group", group, SLUG],
      ["short", short, SLUG],
      ["version", String(version), VERSION],
    ]) {
      if (typeof value !== "string" || !pattern.test(value)) {
        throw new Error(`Invalid document ${label}: ${JSON.stringify(value)}`);
      }
    }
    this.group = group;
    this.short = short;
    this.version = String(version);
    Object.freeze(this);
  }

  static fromObject(object) {
    return new DocumentRef(object?.group, object?.short, object?.version);
  }

  get id() {
    return `${this.group}/${this.short}`;
  }

  get tag() {
    return `${this.id}/v${this.version}`;
  }

  get tagPattern() {
    return `${this.id}/v*`;
  }

  get pdfFile() {
    return `${this.short}-v${this.version}.pdf`;
  }

  /** Where `docengine build` writes the PDF, relative to the output dir. */
  get distPdfPath() {
    return `${this.group}/${this.pdfFile}`;
  }

  /** Where the PDF lives inside a preview folder, relative to `pr-<n>/`. */
  get previewPdfPath() {
    return `${this.group}/${this.short}.pdf`;
  }
}

/** Reads `dist/manifest.json`, tolerating `{documents: []}`, `{entries: []}` or a bare array. */
export class ManifestFile {
  constructor(files, path) {
    this.files = files;
    this.path = path;
  }

  async entries() {
    const raw = JSON.parse(await this.files.read(this.path));
    if (Array.isArray(raw)) return raw;
    return raw.documents ?? raw.entries ?? [];
  }

  async entryFor(ref) {
    const entries = await this.entries();
    return entries.find((e) => e.group === ref.group && e.short === ref.short && String(e.version) === ref.version);
  }
}
