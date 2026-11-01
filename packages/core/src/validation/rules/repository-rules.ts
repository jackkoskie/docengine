// SPDX-License-Identifier: MPL-2.0
import type { Rule, RuleContext } from "../rule.js";

/** File lives at `<group>/<short>.md` matching its frontmatter. Only runs for repository validation. */
export class PathMatchesFrontmatterRule implements Rule {
  readonly name = "path-matches-frontmatter";

  check({ doc, file, repository, report }: RuleContext): void {
    if (!repository || !file || !doc.group || !doc.short) return;
    const segs = file.replaceAll("\\", "/").split("/");
    const base = segs[segs.length - 1]!.replace(/\.md$/i, "");
    const dir = segs[segs.length - 2];
    if (dir !== doc.group) {
      report.error("path-group-mismatch", `File is in directory "${dir ?? ""}" but frontmatter group is "${doc.group}"`, doc.frontmatterPosition("group"));
    }
    if (base !== doc.short) {
      report.error("path-short-mismatch", `File name "${base}" does not match frontmatter short "${doc.short}"`, doc.frontmatterPosition("short"));
    }
  }
}

/** `short` is unique within its group. Only runs for repository validation. */
export class UniqueShortRule implements Rule {
  readonly name = "unique-short";

  check({ doc, file, repository, report }: RuleContext): void {
    if (!repository || !doc.group || !doc.short) return;
    const first = repository.find((e) => e.doc.group === doc.group && e.doc.short === doc.short);
    if (first && first.doc !== doc) {
      report.error("duplicate-short", `short "${doc.short}" in group "${doc.group}" is already used by ${first.file}`, doc.frontmatterPosition("short"));
    }
  }
}
