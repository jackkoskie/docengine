// SPDX-License-Identifier: MPL-2.0
import type { Provision } from "../../model/provision.js";
import type { Rule, RuleContext } from "../rule.js";

/** The document contains at least one provision. */
export class HasProvisionsRule implements Rule {
  readonly name = "has-provisions";
  check({ doc, report }: RuleContext): void {
    if (doc.provisions.length === 0) {
      report.warning("no-provisions", "Document has no provisions", { line: doc.bodyStartLine, column: 1, length: 1 });
    }
  }
}

/** Every ID is non-blank and well formed for its level; nesting stops at Subclause. */
export class ProvisionIdFormatRule implements Rule {
  readonly name = "provision-id-format";
  check({ doc, report }: RuleContext): void {
    for (const c of doc.provisions) {
      if (c.id.isBlank) {
        report.error("blank-provision-id", "Provision ID is blank (fill it with the next ID)", c.position);
        continue;
      }
      for (const problem of c.id.formProblems()) report.error("invalid-provision-id", problem, c.position);
    }
  }
}

/** A `# ` title marker needs text: `[602.60] #` alone is an empty title. */
export class EmptyTitleRule implements Rule {
  readonly name = "empty-title";
  check({ doc, report }: RuleContext): void {
    for (const c of doc.provisions) {
      if (c.title === "" && c.titleLine !== undefined) {
        report.warning("empty-title", `${c.id.display} has an empty title: write the title after "#", or remove the "#"`, c.position);
      }
    }
  }
}

/**
 * A title can only be written on the provision's first line, right after the ID (`[602.60] # Title`).
 * A later line that starts with "# " is not a title and would print a literal "#".
 */
export class MisplacedTitleMarkerRule implements Rule {
  readonly name = "misplaced-title-marker";
  check({ doc, report }: RuleContext): void {
    for (const c of doc.provisions) {
      for (const b of c.blocks) {
        if (b.type === "paragraph" && /^#(\s|$)/.test(b.text)) {
          report.warning(
            "misplaced-title-marker",
            `A title must be on the first line of its provision, as "[${c.id}] # Title"; this line is treated as text`,
            { line: b.line, column: 1, length: Math.max(1, b.text.length) },
          );
        }
      }
    }
  }
}

/** IDs are unique within the document. */
export class DuplicateProvisionRule implements Rule {
  readonly name = "duplicate-provision-id";
  check({ doc, report }: RuleContext): void {
    const seen = new Set<string>();
    for (const c of doc.provisions) {
      if (c.id.isBlank || !c.id.isWellFormed) continue;
      if (seen.has(c.id.text)) report.error("duplicate-provision-id", `Duplicate ${c.id.display}`, c.position);
      seen.add(c.id.text);
    }
  }
}

/**
 * A Subsection or deeper provision needs its parent in the document. Parts, Subparts and Sections need none.
 * A repealed parent (tombstone) counts as present.
 */
export class ProvisionParentRule implements Rule {
  readonly name = "provision-parent";
  check({ doc, report }: RuleContext): void {
    for (const c of doc.usableProvisions) {
      const parent = c.parentId;
      if (parent && c.id.requiresParent && !doc.hasProvision(parent)) {
        report.error("missing-parent", `Parent ${parent.display} of ${c.id.display} does not exist`, c.position);
      }
    }
  }
}

/**
 * Order inside a document:
 * - Parts, Subparts and Sections are strictly ascending in document order (gaps are allowed);
 * - Subsections and deeper levels are contiguous from the first label within their parent.
 *
 * A tombstone (`[repealed]`) stands in for its number: it never raises an order error itself and
 * advances the sequence when it is the next number, so the live siblings around it show no gap.
 */
export class ProvisionOrderRule implements Rule {
  readonly name = "provision-order";
  check({ doc, report }: RuleContext): void {
    let lastTop: Provision | null = null;
    const lastOrdinal = new Map<string, number>(); // parent text -> last ordinal in sequence
    const top = doc.scheme.topLevels;
    const ascend =
      doc.scheme.name === "cars"
        ? "Parts, Subparts and Sections ascend through the document"
        : `${doc.scheme.levels.slice(0, top).map((l) => l.label).join(", ")} ascend through the document`;
    for (const c of doc.usableProvisions) {
      if (c.id.depth <= top) {
        if (c.repealed) continue;
        if (lastTop && c.id.compare(lastTop.id) <= 0) {
          report.error("provision-order", `${c.id.display} must come after ${lastTop.id.display} (${ascend})`, c.position);
        } else {
          lastTop = c;
        }
        continue;
      }
      const parent = c.parentId!;
      if (!doc.hasProvision(parent)) continue; // reported by ProvisionParentRule
      const ord = c.id.ordinal!;
      const key = parent.text;
      const prev = lastOrdinal.get(key) ?? 0;
      if (ord === prev + 1) {
        lastOrdinal.set(key, ord);
      } else if (!c.repealed) {
        report.error("provision-order", `${c.id.display} is out of sequence; expected [${parent.child(prev + 1)}]`, c.position);
        lastOrdinal.set(key, Math.max(prev, ord));
      }
    }
  }
}

/**
 * Declared Part and Subpart headings must agree with the Sections they contain: a Subpart sits in
 * the Part with its first digit, and a Section sits after the Subpart (or Part) it belongs to and
 * before the next declared one.
 */
export class DivisionConsistencyRule implements Rule {
  readonly name = "division-consistency";
  check({ doc, report }: RuleContext): void {
    if (doc.scheme.name !== "cars") {
      this.checkGeneric(doc, report);
      return;
    }
    let part: Provision | null = null;
    let subpart: Provision | null = null;
    for (const c of doc.usableProvisions) {
      const { depth } = c.id;
      if (depth === 1) {
        part = c;
        subpart = null;
      } else if (depth === 2) {
        if (part && c.id.partDigit !== part.id.partDigit) {
          report.error("subpart-part-mismatch", `${c.id.display} belongs to Part ${c.id.partDigit}, but it follows ${part.id.display}`, c.position);
        }
        subpart = c;
      } else if (depth === 3) {
        if (subpart && c.id.subpartCode !== subpart.id.subpartCode) {
          report.error(
            "section-subpart-mismatch",
            `${c.id.display} belongs to Subpart ${c.id.subpartCode}, but it follows ${subpart.id.display}; declare Subpart ${c.id.subpartCode} before it or move it`,
            c.position,
          );
        } else if (!subpart && part && c.id.partDigit !== part.id.partDigit) {
          report.error(
            "section-part-mismatch",
            `${c.id.display} belongs to Part ${c.id.partDigit}, but it follows ${part.id.display}`,
            c.position,
          );
        }
      }
    }
  }

  /** Heading levels must sit under the ancestor the ID itself names. */
  private checkGeneric(doc: RuleContext["doc"], report: RuleContext["report"]): void {
    const top = doc.scheme.topLevels;
    const open: (Provision | null)[] = Array(top + 1).fill(null);
    for (const c of doc.usableProvisions) {
      if (c.id.depth < 1 || c.id.depth > top) continue;
      const declared = c.id.depth > 1 ? open[c.id.depth - 1] : null;
      const parent = c.id.parent;
      if (declared && parent && parent.text !== declared.id.text) {
        report.error(
          "division-mismatch",
          `${c.id.display} belongs under ${parent.display}, but it follows ${declared.id.display}`,
          c.position,
        );
      }
      open[c.id.depth] = c;
      for (let d = c.id.depth + 1; d <= top; d++) open[d] = null;
    }
  }
}
