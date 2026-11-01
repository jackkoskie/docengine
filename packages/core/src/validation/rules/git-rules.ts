// SPDX-License-Identifier: MPL-2.0
import { DocVersion } from "../../git/version.js";
import type { DocumentHistory } from "../../git/history.js";
import type { Rule, RuleContext } from "../rule.js";
import { findRemovedProvisionIds } from "../removed-ids.js";

function historyOf(ctx: RuleContext): DocumentHistory | null {
  if (!ctx.history || !ctx.file) return null;
  return ctx.history.of({ file: ctx.file, doc: ctx.doc });
}

/**
 * Content (body or any figure image hash) changed against the base ref (or the last release tag
 * when no base was given) but `version` did not. Opt out with `version-note: editorial`.
 */
export class VersionBumpRule implements Rule {
  readonly name = "version-bump";

  check(ctx: RuleContext): void {
    const h = historyOf(ctx);
    const { doc, report } = ctx;
    if (!h?.reference || doc.frontmatter["version-note"] === "editorial") return;
    if (h.reference.doc.version !== doc.version) return;
    const diff = h.diffFromReference();
    if (!diff.contentChanged) return;
    const provisions = diff.addedProvisions.length + diff.changedProvisions.length + diff.repealedProvisions.length + diff.removedProvisions.length + diff.movedProvisions.length;
    const figures = diff.addedFigures.length + diff.changedFigures.length + diff.removedFigures.length;
    report.error(
      "version-not-bumped",
      `Content changed since ${h.reference.ref} (${provisions} provision(s), ${figures} figure(s)) but version is still "${doc.version}". ` +
        `Run \`docengine bump ${doc.repositoryKey} minor|major\`, or set \`version-note: editorial\` for editorial-only changes`,
      doc.frontmatterPosition("version"),
    );
  }
}

/** The version must not be lower than the last release tag `<group>/<short>/v<version>`. */
export class VersionAfterTagRule implements Rule {
  readonly name = "version-after-tag";

  check(ctx: RuleContext): void {
    const h = historyOf(ctx);
    if (!h?.lastTag) return;
    const v = DocVersion.parse(ctx.doc.version);
    if (v && v.compare(h.lastTag.version) < 0) {
      ctx.report.error(
        "version-below-tag",
        `Version "${ctx.doc.version}" must be greater than the last release ${h.lastTag.name} (${h.lastTag.version.text})`,
        ctx.doc.frontmatterPosition("version"),
      );
    }
  }
}

/** Warns when a provision ID or figure key of the previous version disappeared. */
export class RemovedIdsRule implements Rule {
  readonly name = "removed-ids";

  check(ctx: RuleContext): void {
    const h = historyOf(ctx);
    if (!h?.previous) return;
    const { doc, report } = ctx;
    const previousIds = [...new Set(h.previous.doc.provisions.filter((c) => !c.id.isBlank).map((c) => c.id.text))];
    for (const d of findRemovedProvisionIds(previousIds, doc)) report.add(ctx.file ? d.withFile(ctx.file) : d);
    const keys = new Set(h.previous.doc.figures.flatMap((f) => (f.key ? [f.key] : [])));
    for (const key of keys) {
      if (!doc.findFigure(key)) {
        report.warning(
          "removed-figure-key",
          `Figure {#fig:${key}} existed in the previous version; references to it may break`,
          { line: 1, column: 1, length: 1 },
        );
      }
    }
  }
}
