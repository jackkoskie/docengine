// SPDX-License-Identifier: MPL-2.0
// ---- numeral helpers ----

export function toLetters(n: number): string {
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export function fromLetters(s: string): number {
  let n = 0;
  for (const c of s) n = n * 26 + (c.charCodeAt(0) - 96);
  return n;
}

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

export function toRoman(n: number): string {
  let s = "";
  for (const [v, r] of ROMAN) {
    while (n >= v) {
      s += r;
      n -= v;
    }
  }
  return s;
}

/** Value of a canonical lowercase roman numeral, or null. */
export function fromRoman(s: string): number | null {
  if (!/^[ivxlcdm]+$/.test(s)) return null;
  let n = 0;
  let rest = s;
  for (const [v, r] of ROMAN) {
    while (rest.startsWith(r)) {
      n += v;
      rest = rest.slice(r.length);
    }
  }
  return rest === "" && toRoman(n) === s ? n : null;
}

// ---- segment kinds (strategy per level) ----

export type SegmentKindName = "number" | "lower-letter" | "lower-roman" | "upper-letter" | "upper-roman";

/** The kinds a custom scheme may use. */
export const CUSTOM_KIND_NAMES = ["number", "lower-letter", "lower-roman", "upper-letter", "upper-roman"] as const;
export type CustomKindName = (typeof CUSTOM_KIND_NAMES)[number];

export interface SegmentKind {
  readonly name: SegmentKindName;
  readonly description: string;
  /** 1-based ordinal of a segment, or null when it is not valid for this kind. */
  ordinal(segment: string): number | null;
  format(ordinal: number): string;
}

class NumberKind implements SegmentKind {
  readonly name = "number" as const;
  readonly description = "a number without leading zeros, for example (1)";
  ordinal(s: string) {
    return /^[1-9]\d*$/.test(s) ? Number(s) : null;
  }
  format(n: number) {
    return String(n);
  }
}

class LowerLetterKind implements SegmentKind {
  readonly name = "lower-letter" as const;
  readonly description = "a lowercase letter (a..z, aa, ab, ...), for example (c)";
  ordinal(s: string) {
    return /^[a-z]+$/.test(s) ? fromLetters(s) : null;
  }
  format(n: number) {
    return toLetters(n);
  }
}

class LowerRomanKind implements SegmentKind {
  readonly name = "lower-roman" as const;
  readonly description = "a lowercase roman numeral, for example (iv)";
  ordinal(s: string) {
    return fromRoman(s);
  }
  format(n: number) {
    return toRoman(n);
  }
}

class UpperLetterKind implements SegmentKind {
  readonly name = "upper-letter" as const;
  readonly description = "an uppercase letter (A..Z, AA, AB, ...), for example (C)";
  ordinal(s: string) {
    return /^[A-Z]+$/.test(s) ? fromLetters(s.toLowerCase()) : null;
  }
  format(n: number) {
    return toLetters(n).toUpperCase();
  }
}

class UpperRomanKind implements SegmentKind {
  readonly name = "upper-roman" as const;
  readonly description = "an uppercase roman numeral, for example (IV)";
  ordinal(s: string) {
    return /^[IVXLCDM]+$/.test(s) ? fromRoman(s.toLowerCase()) : null;
  }
  format(n: number) {
    return toRoman(n).toUpperCase();
  }
}

export const NUMBER_KIND: SegmentKind = new NumberKind();
export const LOWER_LETTER_KIND: SegmentKind = new LowerLetterKind();
export const LOWER_ROMAN_KIND: SegmentKind = new LowerRomanKind();
export const UPPER_LETTER_KIND: SegmentKind = new UpperLetterKind();
export const UPPER_ROMAN_KIND: SegmentKind = new UpperRomanKind();

export const CUSTOM_KINDS: Record<CustomKindName, SegmentKind> = {
  number: NUMBER_KIND,
  "lower-letter": LOWER_LETTER_KIND,
  "lower-roman": LOWER_ROMAN_KIND,
  "upper-letter": UPPER_LETTER_KIND,
  "upper-roman": UPPER_ROMAN_KIND,
};
