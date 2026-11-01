// SPDX-License-Identifier: MPL-2.0
import type { ProvisionId } from "./provision-id.js";
import type { Position } from "./diagnostic.js";

/** Characters in a footnote label's `[^id]` before the id itself. */
export const FOOTNOTE_LABEL_PREFIX = 2;

/** A footnote definition: `[^id]: text` (continuation lines indented). */
export class Footnote {
  constructor(
    readonly id: string,
    /** Inline Markdown text, continuation lines joined with spaces. */
    readonly text: string,
    /** The `[^id]` label at the start of the definition. */
    readonly position: Position,
    /** Last source line (1-based) of the definition. */
    readonly endLine: number,
  ) {
    Object.freeze(this);
  }

  /** Range of the id inside the label. */
  get idPosition(): Position {
    return { line: this.position.line, column: this.position.column + FOOTNOTE_LABEL_PREFIX, length: this.id.length };
  }
}

/** A `[^id]` reference in running text. */
export class FootnoteReference {
  constructor(
    readonly id: string,
    /** The whole `[^id]` token. */
    readonly position: Position,
    /** The provision the reference appears in. */
    readonly provisionId: ProvisionId | null,
    /** True when the reference sits inside another footnote's definition text. */
    readonly insideFootnote: boolean,
  ) {
    Object.freeze(this);
  }

  /** Range of the id inside the brackets. */
  get idPosition(): Position {
    return { line: this.position.line, column: this.position.column + FOOTNOTE_LABEL_PREFIX, length: this.id.length };
  }
}
