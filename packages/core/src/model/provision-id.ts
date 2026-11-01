// SPDX-License-Identifier: MPL-2.0
/**
 * Provision identifiers. The grammar lives in a `NumberingScheme` (cars, legal, decimal or custom).
 * `ProvisionId.parse` defaults to the CARs scheme, so existing call sites keep the same IDs and messages.
 *
 * CARs, for example `602.60(1)(c)(i)(A)(I)`:
 *  1 Part         `6`
 *  2 Subpart      `602`
 *  3 Section      `602.60`
 *  4 Subsection   `(1)`
 *  5 Paragraph    `(a)`
 *  6 Subparagraph `(i)`
 *  7 Clause       `(A)`
 *  8 Subclause    `(I)`
 */

import { fromLetters, fromRoman, toLetters, toRoman, type SegmentKind, type SegmentKindName } from "./numbering/kinds.js";
import { CARS } from "./numbering/presets.js";
import { ProvisionLevel, levelOf, type NumberingScheme } from "./numbering/scheme.js";

export { fromLetters, fromRoman, toLetters, toRoman, type SegmentKind, type SegmentKindName };
export { ProvisionLevel, levelOf, type NumberingScheme };

export type LevelName = "part" | "subpart" | "section" | "subsection" | "paragraph" | "subparagraph" | "clause" | "subclause";

/** CARs level table. Other schemes carry their own levels; these stay for callers that assume CARs. */
export const LEVELS: readonly ProvisionLevel[] = CARS.levels;
export const MAX_LEVEL = CARS.maxLevel;
export const LEVEL_NAMES: readonly string[] = LEVELS.map((l) => l.label);

/** The CARs level for a 1-based number (clamped, for display). */
export function levelAt(n: number): ProvisionLevel {
  return levelOf(CARS, n);
}

/** CARs level by name (`"section"`) or label (`"Section"`). */
export function levelByName(name: string): ProvisionLevel | undefined {
  const n = name.toLowerCase();
  return LEVELS.find((l) => l.name === n);
}

/** Display label of a CARs level number, e.g. 7 -> "Clause". */
export function levelLabel(n: number): string {
  return levelAt(n).label;
}

/** Loose pattern for a CARs ID between brackets. Prefer `scheme.idPattern` when a scheme is in scope. */
export const ID_PATTERN = CARS.idPattern;
export const LOOSE_ID_REGEX = CARS.idShape;

/** How many leading prefixes contain no parenthesis (the CARs head, or a scheme's dotted head). */
function headDepth(prefixes: readonly string[], topLevels: number): number {
  let n = 0;
  for (const prefix of prefixes) {
    if (prefix.includes("(")) break;
    n++;
  }
  return Math.min(n, topLevels);
}

/** Immutable provision identifier. Parsing never throws; check `isWellFormed`. */
export class ProvisionId {
  readonly scheme: NumberingScheme;
  private readonly analysis: ReturnType<NumberingScheme["analyse"]>;

  private constructor(readonly text: string, scheme: NumberingScheme) {
    this.scheme = scheme;
    this.analysis = scheme.analyse(text);
    Object.freeze(this);
  }

  static parse(text: string, scheme: NumberingScheme = CARS): ProvisionId {
    return new ProvisionId(text, scheme);
  }

  /** 1-based level count; 0 for a blank or unparseable ID. */
  get depth(): number {
    return this.analysis.prefixes.length;
  }

  get level(): ProvisionLevel {
    return levelOf(this.scheme, this.depth || 1);
  }

  get isBlank(): boolean {
    return this.text === "";
  }

  /** Unparenthesised prefix depth, capped at the scheme's heading levels. 0 when the head is invalid. */
  private get headLevel(): number {
    return headDepth(this.analysis.prefixes, this.scheme.topLevels);
  }

  /** The heading head (`602.60` for a CARs section, `1.1` for a legal section); "" when malformed. */
  get head(): string {
    return this.headLevel > 0 ? (this.analysis.prefixes[this.headLevel - 1] ?? "") : "";
  }

  /** Parenthesised labels without parentheses. */
  get labels(): readonly string[] {
    return this.analysis.segments.filter((s) => s.startsWith("(") && s.endsWith(")")).map((s) => s.slice(1, -1));
  }

  /** First-level text (`6` for `602.60`), or null. */
  get partDigit(): string | null {
    return this.headLevel > 0 ? (this.analysis.prefixes[0] ?? null) : null;
  }

  /** Second-level text (`602` for `602.60`), or null above that level. */
  get subpartCode(): string | null {
    if (this.headLevel < 2) return null;
    const code = this.analysis.prefixes[1];
    if (!code || code.includes("(")) return null;
    return code;
  }

  /** The ID at the deepest heading level (`602.60`, `1.1`), or null when this ID is shallower. */
  get sectionId(): ProvisionId | null {
    if (this.headLevel !== this.scheme.topLevels) return null;
    const text = this.analysis.prefixes[this.scheme.topLevels - 1];
    if (!text || text.includes("(")) return null;
    return ProvisionId.parse(text, this.scheme);
  }

  get parent(): ProvisionId | null {
    if (this.analysis.prefixes.length < 2) return null;
    return ProvisionId.parse(this.analysis.prefixes[this.analysis.prefixes.length - 2]!, this.scheme);
  }

  /** Nested levels must be preceded by their parent; heading levels need none. */
  get requiresParent(): boolean {
    return this.depth > this.scheme.topLevels;
  }

  get kind(): SegmentKind {
    return this.level.kind;
  }

  /** Last segment as written: `602.60` for a Section, `(c)` for a Paragraph. */
  get label(): string {
    if (this.labels.length > 0) return `(${this.labels[this.labels.length - 1]})`;
    return this.head || this.text;
  }

  /** Ordinal of the last segment, or null when invalid. */
  get ordinal(): number | null {
    if (this.depth === 0) return null;
    if (this.labels.length > 0) return this.level.kind.ordinal(this.labels[this.labels.length - 1]!);
    return this.analysis.ordinals[this.depth - 1] ?? null;
  }

  formProblems(): string[] {
    return [...this.analysis.problems];
  }

  get isWellFormed(): boolean {
    return this.text !== "" && this.analysis.problems.length === 0;
  }

  equals(other: ProvisionId): boolean {
    return this.text === other.text;
  }

  isChildOf(other: ProvisionId): boolean {
    return this.parent?.equals(other) ?? false;
  }

  isDescendantOf(other: ProvisionId): boolean {
    for (let p = this.parent; p; p = p.parent) if (p.equals(other)) return true;
    return false;
  }

  /** All ancestors, nearest first. */
  get ancestors(): ProvisionId[] {
    const out: ProvisionId[] = [];
    for (let p = this.parent; p; p = p.parent) out.push(p);
    return out;
  }

  /** The child with the given ordinal, written by the scheme (`6` + 2 is `602`, `602.60` + 1 is `602.60(1)`). */
  child(ordinal: number): ProvisionId {
    if (this.depth === 0 || this.depth >= this.scheme.maxLevel) throw new RangeError(`${this.text} cannot have numbered children`);
    return ProvisionId.parse(this.scheme.compose(this.text, this.depth + 1, ordinal), this.scheme);
  }

  /** The sibling with a different ordinal. Null at heading levels, where numbers need not be contiguous. */
  sibling(ordinal: number): ProvisionId | null {
    if (this.depth <= this.scheme.topLevels) return null;
    return this.parent?.child(ordinal) ?? null;
  }

  /** The next ID at the deepest heading level (the next CARs Section, the next legal Section, ...). */
  nextSection(): ProvisionId | null {
    if (this.depth !== this.scheme.topLevels) return null;
    const parent = this.parent?.text ?? "";
    return ProvisionId.parse(this.scheme.compose(parent, this.depth, (this.ordinal ?? 0) + 1), this.scheme);
  }

  /** A string that sorts in document order (for editors that sort by text). */
  get sortKey(): string {
    if (this.analysis.orderKey.length === 0) return this.text;
    return this.analysis.orderKey.map((n) => String(n + 1).padStart(6, "0")).join(".");
  }

  /** Orders IDs in document order. Unparseable IDs fall back to text order. */
  compare(other: ProvisionId): number {
    if (this.analysis.orderKey.length === 0 || other.analysis.orderKey.length === 0) return this.text.localeCompare(other.text);
    const a = this.analysis.orderKey;
    const b = other.analysis.orderKey;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const diff = (a[i] ?? -1) - (b[i] ?? -1);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  /** Typst label: dots and opening parentheses become dashes, closing ones vanish; case is kept (`p602-60-1-c-i-A`). */
  get typstLabel(): string {
    return `p${this.text.replaceAll(".", "-").replaceAll("(", "-").replaceAll(")", "")}`;
  }

  /** `Section 602.60`, `Paragraph 1.1(a)`. */
  get display(): string {
    return `${this.level.label} ${this.text}`;
  }

  toString(): string {
    return this.text;
  }

  toJSON(): string {
    return this.text;
  }
}

export function typstLabelForProvision(id: string, scheme: NumberingScheme = CARS): string {
  return ProvisionId.parse(id, scheme).typstLabel;
}

/** Function-style helpers kept for convenience. */
export const ids = {
  toLetters,
  fromLetters,
  toRoman,
  fromRoman,
  idFormatProblems: (id: string, scheme: NumberingScheme = CARS): string[] => ProvisionId.parse(id, scheme).formProblems(),
  LOOSE_ID_REGEX,
  MAX_LEVEL,
} as const;
