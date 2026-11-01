// SPDX-License-Identifier: MPL-2.0
import { CARS } from "./numbering/presets.js";
import type { NumberingScheme } from "./numbering/scheme.js";
import { ProvisionId } from "./provision-id.js";
import type { Position } from "./diagnostic.js";

export type ReferenceKind = "provision" | "figure";

export class Reference {
  constructor(
    readonly raw: string,
    readonly kind: ReferenceKind,
    /** Provision ID text, or figure key for figure references. */
    readonly target: string,
    readonly position: Position,
    /** The provision the reference appears in. */
    readonly provisionId: ProvisionId | null,
    /** Document short (or `group/short`) for cross-document references. */
    readonly doc?: string,
    /**
     * Offset of the target (provision ID, or figure key without the `fig:` prefix) inside `raw`, in UTF-16
     * code units from the first `[`. The target occupies `[targetOffset, targetOffset + targetLength)`.
     */
    readonly targetOffset: number = raw.lastIndexOf(target),
    /** Scheme used to read `target` when it is a provision ID. */
    readonly scheme: NumberingScheme = CARS,
  ) {
    Object.freeze(this);
  }

  /** Length of the target text inside `raw`. */
  get targetLength(): number {
    return this.target.length;
  }

  get isCrossDocument(): boolean {
    return this.doc !== undefined;
  }

  get isFigure(): boolean {
    return this.kind === "figure";
  }

  /** The referenced provision ID (meaningful for provision references). */
  get targetId(): ProvisionId {
    return ProvisionId.parse(this.target, this.scheme);
  }
}
