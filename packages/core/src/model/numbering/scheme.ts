// SPDX-License-Identifier: MPL-2.0
import type { SegmentKind } from "./kinds.js";

/** Inclusive digit count for a number level. An exact width has `min === max`. */
export interface DigitWidth {
  readonly min: number;
  readonly max: number;
}

export interface ProvisionLevelOptions {
  /** How the segment attaches to its parent: `.` (dotted), `()` (parenthesised) or `""` (concatenate, or the first level). */
  joiner?: "" | "." | "()";
  /** Print the margin label in italics (typst). */
  italic?: boolean;
  /** Digit count for a number level. Exact (`2`) or a range (`{ min: 2, max: 3 }`). */
  digits?: number | DigitWidth;
  /** Lowest accepted ordinal. Default 1. `0` allows a padded `00`. */
  min?: number;
  /** Print the level name in headings and the table of contents. Default true. */
  showLabel?: boolean;
  /**
   * Start each heading of this level on a new page.
   * Omitted follows `headings.pageBreakBefore`. `{page}` and `{nopage}` on a provision still win.
   */
  pageBreak?: boolean;
  /**
   * Left inset of a hanging label, in steps of `2.2em`. `0` (the default) sits on the margin.
   * The number is this level's own inset. Headings stay full width.
   */
  indent?: number;
}

/** One level of a numbering scheme. */
export class ProvisionLevel {
  readonly joiner: "" | "." | "()";
  readonly italic: boolean;
  /** Digit count for a number level, or null when the number is unpadded. */
  readonly digits: DigitWidth | null;
  /** Lowest accepted ordinal. */
  readonly minOrdinal: number;
  /** Whether headings and the table of contents print this level's name. */
  readonly showLabel: boolean;
  /** `true` or `false` when this level chooses its own page break; `null` follows `headings.pageBreakBefore`. */
  readonly pageBreak: boolean | null;
  /** Hanging-label inset in steps of `2.2em`. `0` sits on the margin. */
  readonly indent: number;

  constructor(
    /** 1-based position in the scheme. */
    readonly number: number,
    /** Machine name, e.g. `subparagraph`. */
    readonly name: string,
    /** User-facing name, e.g. "Subparagraph". */
    readonly label: string,
    readonly kind: SegmentKind,
    options: ProvisionLevelOptions = {},
  ) {
    this.joiner = options.joiner ?? "";
    this.italic = options.italic ?? false;
    this.digits = normalizeDigits(options.digits);
    this.minOrdinal = options.min ?? 1;
    this.showLabel = options.showLabel ?? true;
    this.pageBreak = options.pageBreak ?? null;
    this.indent = options.indent ?? 0;
    Object.freeze(this);
  }

  /** Exact digit width, as opposed to a range such as 2 or 3. */
  get exactDigits(): boolean {
    return this.digits !== null && this.digits.min === this.digits.max;
  }

  /** Written in parentheses after its parent. */
  get isParenthesised(): boolean {
    return this.joiner === "()";
  }

  /** Paragraph-style labels are printed in italics. */
  get italicLabel(): boolean {
    return this.italic;
  }

  /** Write an ordinal the way this level spells it (`1` as `01` when padded). */
  formatOrdinal(ordinal: number): string {
    if (this.kind.name !== "number" || !this.digits) return this.kind.format(ordinal);
    return String(ordinal).padStart(this.digits.min, "0");
  }

  /** Ordinal of a segment token, or null when it does not fit this level. */
  readOrdinal(token: string): number | null {
    if (this.kind.name === "number" && this.digits) {
      const { min, max } = this.digits;
      if (!new RegExp(`^\\d{${min},${max}}$`).test(token)) return null;
      const n = Number(token);
      return n >= this.minOrdinal ? n : null;
    }
    const n = this.kind.ordinal(token);
    if (n === null || n < this.minOrdinal) return null;
    return n;
  }

  /** What a malformed segment must be, for diagnostic text. */
  get requirement(): string {
    if (this.kind.name === "number" && this.digits) {
      const { min, max } = this.digits;
      const width = min === max ? `exactly ${min} digit${min === 1 ? "" : "s"}` : `${min} to ${max} digits`;
      if (this.minOrdinal <= 0) return width;
      return `${width}, at least ${String(this.minOrdinal).padStart(min, "0")}`;
    }
    return this.kind.description;
  }

  /** Pattern for one segment as the parser reads it (no leading zeros unless `digits` is set). */
  parseSource(): string {
    if (this.kind.name === "number") {
      if (this.digits) {
        const { min, max } = this.digits;
        return min === max ? String.raw`\d{` + min + "}" : String.raw`\d{` + min + "," + max + "}";
      }
      return String.raw`[1-9]\d*`;
    }
    return looseSegmentSource(this.kind.name);
  }

  /** Looser pattern for scanners and editors. */
  looseSource(): string {
    if (this.kind.name === "number" && !this.digits) return String.raw`\d+`;
    return this.parseSource();
  }
}

function normalizeDigits(digits: number | DigitWidth | undefined): DigitWidth | null {
  if (digits === undefined) return null;
  if (typeof digits === "number") return { min: digits, max: digits };
  return { min: digits.min, max: digits.max };
}

function looseSegmentSource(kind: SegmentKind["name"]): string {
  switch (kind) {
    case "number":
      return String.raw`\d+`;
    case "lower-letter":
      return "[a-z]+";
    case "upper-letter":
      return "[A-Z]+";
    case "lower-roman":
      return "[ivxlcdm]+";
    case "upper-roman":
      return "[IVXLCDM]+";
  }
}

/** Everything a scheme derives from the text of one ID. */
export interface IdAnalysis {
  /** The ID text at each level, 1..depth: `["6", "602", "602.60", "602.60(1)"]`. Empty when the head is invalid. */
  readonly prefixes: readonly string[];
  /** The segment each level adds, as written: `["6", "602", "602.60", "(1)"]`. */
  readonly segments: readonly string[];
  /** Ordinal of each level's segment, or null when invalid. */
  readonly ordinals: readonly (number | null)[];
  /** Numbers that sort IDs in document order. */
  readonly orderKey: readonly number[];
  /** Form problems; empty when well-formed. */
  readonly problems: readonly string[];
}

/**
 * Owns everything about the shape of a provision ID: its levels, how a text splits into levels, how
 * a child or sibling is written and which levels are headings.
 *
 * Levels `1..topLevels` are "top" levels (cars: Part, Subpart, Section): they ascend through a document
 * with gaps allowed, need no parent present, and are rendered as headings. Deeper levels are nested:
 * contiguous from 1 inside their parent, and their parent must be present.
 */
export interface NumberingScheme {
  /** `cars`, `legal`, `decimal` or `custom`. */
  readonly name: string;
  /** Stable identity of the grammar (equal keys mean identical ID shapes). */
  readonly key: string;
  readonly levels: readonly ProvisionLevel[];
  readonly maxLevel: number;
  readonly topLevels: number;
  /** Regex source for an ID as written between brackets (loose shape, for editors and scanners). */
  readonly idPattern: string;
  /** Anchored `idPattern`. */
  readonly idShape: RegExp;
  /** A valid ID at full depth, e.g. `602.60(1)(a)(i)(A)(I)`. */
  readonly example: string;
  analyse(text: string): IdAnalysis;
  /** Text of the level-`depth` ID with ordinal `ordinal` under the ID `parent` (`""` for level 1). */
  compose(parent: string, depth: number, ordinal: number): string;
}

/** Level lookup clamped to the scheme's range (for display of over-deep IDs). */
export function levelOf(scheme: NumberingScheme, n: number): ProvisionLevel {
  return scheme.levels[Math.min(Math.max(n, 1), scheme.maxLevel) - 1]!;
}
