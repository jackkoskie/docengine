// SPDX-License-Identifier: MPL-2.0
import type { Document } from "../../model/document.js";
import type { Reference } from "../../model/reference.js";
import type { Rule, RuleContext } from "../rule.js";

/** Every `[[...]]` reference resolves, including cross-document ones when repo context exists. */
export class ReferenceRule implements Rule {
  readonly name = "references";

  check(ctx: RuleContext): void {
    for (const ref of ctx.doc.references) {
      if (ref.isCrossDocument) this.checkCrossDocument(ref, ctx);
      else if (ref.isFigure) this.checkFigure(ref, ctx);
      else this.checkProvision(ref, ctx);
    }
  }

  private checkCrossDocument(ref: Reference, { doc, documents, report }: RuleContext): void {
    if (!documents) return; // cannot resolve without repo context
    const target: Document | undefined = documents.find((d) => d.matchesName(ref.doc!));
    if (!target) {
      report.error("unresolved-reference", `Reference ${ref.raw}: document "${ref.doc}" not found`, ref.position);
    } else if (ref.isFigure) {
      if (!target.findFigure(ref.target)) {
        report.error("unresolved-reference", `Reference ${ref.raw}: figure "${ref.target}" not found in "${ref.doc}"`, ref.position);
      }
    } else {
      if (target.scheme.key !== doc.scheme.key) {
        report.warning(
          "numbering-scheme-mismatch",
          `Reference ${ref.raw} points at "${ref.doc}", which uses the ${target.scheme.name} numbering scheme while this document uses ${doc.scheme.name}`,
          ref.position,
        );
      }
      const provision = target.findProvision(ref.target);
      if (!provision) report.error("unresolved-reference", `Reference ${ref.raw}: provision [${ref.target}] not found in "${ref.doc}"`, ref.position);
      else if (provision.repealed) report.warning("reference-to-repealed", `Reference ${ref.raw} points to a repealed provision`, ref.position);
    }
  }

  private checkFigure(ref: Reference, { doc, report }: RuleContext): void {
    if (!doc.findFigure(ref.target)) {
      report.error("unresolved-reference", `Reference ${ref.raw}: figure "${ref.target}" not found`, ref.position);
    }
  }

  private checkProvision(ref: Reference, { doc, report }: RuleContext): void {
    if (!ref.targetId.isWellFormed) {
      report.error("invalid-reference", `Reference ${ref.raw} is not a valid provision ID`, ref.position);
      return;
    }
    const provision = doc.findProvision(ref.targetId);
    if (!provision) report.error("unresolved-reference", `Reference ${ref.raw}: provision [${ref.target}] not found`, ref.position);
    else if (provision.repealed) report.warning("reference-to-repealed", `Reference ${ref.raw} points to a repealed provision`, ref.position);
  }
}
