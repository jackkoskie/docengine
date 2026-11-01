// SPDX-License-Identifier: MPL-2.0
export type BumpKind = "major" | "minor";

/** Document version `major.minor` (the frontmatter `version` format). */
export class DocVersion {
  private constructor(
    readonly major: number,
    readonly minor: number,
  ) {
    Object.freeze(this);
  }

  /** Returns null when `text` is not `<major>.<minor>`. */
  static parse(text: string): DocVersion | null {
    const m = /^(\d+)\.(\d+)$/.exec(text.trim());
    return m ? new DocVersion(Number(m[1]), Number(m[2])) : null;
  }

  get text(): string {
    return `${this.major}.${this.minor}`;
  }

  compare(other: DocVersion): number {
    return this.major - other.major || this.minor - other.minor;
  }

  /** `major` gives `(major+1).0`, `minor` gives `major.(minor+1)`. */
  bump(kind: BumpKind): DocVersion {
    return kind === "major" ? new DocVersion(this.major + 1, 0) : new DocVersion(this.major, this.minor + 1);
  }

  toString(): string {
    return this.text;
  }
}
