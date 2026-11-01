// SPDX-License-Identifier: MPL-2.0
import type { Rule, RuleContext } from "../rule.js";

/** Every `[^id]` points at a definition, and sits somewhere a footnote can live. */
export class FootnoteReferenceRule implements Rule {
  readonly name = "footnote-references";

  check({ doc, report }: RuleContext): void {
    const titleLines = new Map<number, string>();
    for (const c of doc.provisions) if (c.titleLine !== undefined) titleLines.set(c.titleLine, c.id.text);

    for (const r of doc.footnoteReferences) {
      if (!doc.findFootnote(r.id)) {
        report.error("undefined-footnote", `Footnote [^${r.id}] is used but never defined; add a line "[^${r.id}]: text"`, r.position);
        continue;
      }
      if (r.insideFootnote) {
        report.error("nested-footnote", `Footnote [^${r.id}] is used inside another footnote; footnotes cannot contain footnotes`, r.position);
      } else if (titleLines.has(r.position.line)) {
        // Titles are repeated in the table of contents, so a footnote there would be duplicated.
        report.error("footnote-in-title", `Footnote [^${r.id}] is in the title of provision [${titleLines.get(r.position.line)}]; put it in the text instead`, r.position);
      }
    }
  }
}

/** Definitions are unique and used. */
export class FootnoteDefinitionRule implements Rule {
  readonly name = "footnote-definitions";

  check({ doc, report }: RuleContext): void {
    const used = new Set(doc.footnoteReferences.map((r) => r.id));
    const seen = new Set<string>();
    for (const f of doc.footnotes) {
      if (seen.has(f.id)) {
        report.error("duplicate-footnote", `Duplicate footnote definition [^${f.id}]`, f.position);
        continue;
      }
      seen.add(f.id);
      if (!used.has(f.id)) report.warning("unused-footnote", `Footnote [^${f.id}] is defined but never used`, f.position);
    }
  }
}
