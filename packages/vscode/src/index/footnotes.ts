// SPDX-License-Identifier: MPL-2.0
import type { Footnote } from "@jackkoskie/docengine-core";
import { type Range, contains, rangeOf, subRange } from "../types.js";
import type { IndexedDocument } from "./indexed-document.js";

/** The footnote under a cursor: a `[^id]` reference or the `[^id]:` label of a definition. */
export interface FootnoteTarget {
  id: string;
  origin: "reference" | "definition";
  /** Whole `[^id]` token. */
  fullRange: Range;
  /** The id inside the brackets. */
  idRange: Range;
}

/** Locates footnote references and definitions within one document (footnotes never cross documents). */
export class FootnoteLocator {
  locate(indexed: IndexedDocument, line: number, char: number): FootnoteTarget | undefined {
    for (const r of indexed.doc.footnoteReferences) {
      const full = rangeOf(r.position);
      if (full.startLine === line && contains(full, line, char)) {
        return { id: r.id, origin: "reference", fullRange: full, idRange: rangeOf(r.idPosition) };
      }
    }
    for (const f of indexed.doc.footnotes) {
      const full = rangeOf(f.position);
      if (full.startLine === line && contains(full, line, char)) {
        return { id: f.id, origin: "definition", fullRange: full, idRange: rangeOf(f.idPosition) };
      }
    }
    return undefined;
  }

  /** The definition (first one wins) for an id. */
  definition(indexed: IndexedDocument, id: string): Footnote | undefined {
    return indexed.doc.findFootnote(id);
  }

  /** Every `[^id]` reference range for an id. */
  references(indexed: IndexedDocument, id: string): Range[] {
    return indexed.doc.footnoteReferences.filter((r) => r.id === id).map((r) => rangeOf(r.position));
  }

  /** Range of the `[^id]` label of a definition. */
  labelRange(f: Footnote): Range {
    return rangeOf(f.position);
  }

  idRangeOf(f: Footnote): Range {
    return subRange(f.position, 2, f.id.length);
  }
}
