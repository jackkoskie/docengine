// SPDX-License-Identifier: MPL-2.0
import { CUSTOM_KINDS, CUSTOM_KIND_NAMES, NUMBER_KIND, type CustomKindName, type SegmentKind } from "./kinds.js";
import { ProvisionLevel, type DigitWidth, type IdAnalysis, type NumberingScheme } from "./scheme.js";

const CARS_EXAMPLE = "602.60(1)(c)(i)(A)(I)";

/**
 * The CARs grammar as a custom scheme: a one-digit Part, a two-digit Subpart concatenated onto it
 * (`6` + `02` = `602`, and `00` is the general Subpart), then a Section of two or three digits (`602.01`, `602.60`, `602.100`).
 */
export const CARS_TEMPLATE: CustomSchemeInput = {
  scheme: "custom",
  topLevels: 3,
  levels: [
    { label: "Part", name: "part", kind: "number", digits: 1 },
    { label: "Subpart", name: "subpart", kind: "number", joiner: "", digits: 2, min: 0 },
    { label: "Section", name: "section", kind: "number", joiner: ".", digits: { min: 2, max: 3 } },
    { label: "Subsection", name: "subsection", kind: "number", joiner: "()" },
    { label: "Paragraph", name: "paragraph", kind: "lower-letter", joiner: "()", italic: true, indent: 1 },
    { label: "Subparagraph", name: "subparagraph", kind: "lower-roman", joiner: "()", indent: 2 },
    { label: "Clause", name: "clause", kind: "upper-letter", joiner: "()", indent: 3 },
    { label: "Subclause", name: "subclause", kind: "upper-roman", joiner: "()", indent: 4 },
  ],
};

/** `1`, `1.1`, `1.1(a)`, `1.1(a)(i)`. Article and Section are headings. */
export const LEGAL_TEMPLATE: CustomSchemeInput = {
  scheme: "custom",
  topLevels: 2,
  levels: [
    { label: "Article", name: "article", kind: "number" },
    { label: "Section", name: "section", kind: "number", joiner: "." },
    { label: "Paragraph", name: "paragraph", kind: "lower-letter", joiner: "()", italic: true },
    { label: "Subparagraph", name: "subparagraph", kind: "lower-roman", joiner: "()" },
  ],
};

/** CARs grammar, unchanged: Part, Subpart, Section `602.60`, then `(1)(a)(i)(A)(I)`. */
export const CARS: NumberingScheme = compilePreset(CARS_TEMPLATE, "cars", CARS_EXAMPLE);

/** Legal outline compiled from `LEGAL_TEMPLATE`. */
export const LEGAL: NumberingScheme = compilePreset(LEGAL_TEMPLATE, "legal");

/**
 * Dotted numbers `1`, `1.1`, `1.1.1`, up to six levels. The first three are headings
 * (gaps allowed); deeper levels are nested and contiguous.
 */
export const DECIMAL: NumberingScheme = sequenceScheme({
  name: "decimal",
  key: "decimal",
  topLevels: 3,
  levels: [
    level(1, "division", "Division", NUMBER_KIND),
    level(2, "subdivision", "Subdivision", NUMBER_KIND, { joiner: "." }),
    level(3, "section", "Section", NUMBER_KIND, { joiner: "." }),
    level(4, "subsection", "Subsection", NUMBER_KIND, { joiner: "." }),
    level(5, "paragraph", "Paragraph", NUMBER_KIND, { joiner: ".", indent: 1 }),
    level(6, "subparagraph", "Subparagraph", NUMBER_KIND, { joiner: ".", indent: 2 }),
  ],
});

export const PRESETS = { cars: CARS, legal: LEGAL, decimal: DECIMAL } as const;

export interface CustomLevelInput {
  /** User-facing name, for example "Article". */
  label: string;
  /** Machine name. Defaults to a slug of `label`. */
  name?: string;
  kind: CustomKindName;
  /**
   * Omitted on the first level. Later levels default to `()` , or `.` when `kind` is `number`.
   * `""` concatenates a fixed-width number onto its parent (`6` + `02` = `602`).
   */
  joiner?: "" | "." | "()";
  /** Italic margin label. Default false. */
  italic?: boolean;
  /** Digit count for `kind: "number"`. Exact (`2`) or a range (`{ min: 2, max: 3 }`). Pads on write and accepts leading zeros. */
  digits?: number | { min: number; max: number };
  /** Lowest ordinal. Default 1. `0` allows a padded `00`. */
  min?: number;
  /** Print the level name in headings and the table of contents. Default true (`Section 2`). `false` prints the id alone (`2`). */
  showLabel?: boolean;
  /**
   * Start each heading of this level on a new page. Omitted follows `headings.pageBreakBefore`.
   * `{page}` and `{nopage}` on one provision still win.
   */
  pageBreak?: boolean;
  /**
   * Left inset of a hanging label, in steps of `2.2em`. Default `0` (on the margin).
   * The number is this level's own inset, not a step added to its parent. Headings stay full width.
   */
  indent?: number;
}

export interface CustomSchemeInput {
  scheme: "custom";
  levels: CustomLevelInput[];
  /** How many leading levels are headings. Default: levels before the first parenthesised one. */
  topLevels?: number;
}

export type NumberingInput = "cars" | "legal" | "decimal" | CustomSchemeInput;

export type NumberingResult = { ok: true; scheme: NumberingScheme } | { ok: false; issues: string[] };

/** Build a custom scheme, or throw when the level list is empty, unknown or ambiguous. */
export function buildCustomScheme(input: CustomSchemeInput): NumberingScheme {
  const result = compileCustom(input, "numbering");
  if (!result.ok) throw new Error(result.issues.join("\n"));
  return result.scheme;
}

/**
 * `undefined` is the cars preset. A string selects a preset. An object `{ scheme: "custom", levels }`
 * builds a custom scheme. `path` prefixes validation messages (`numbering`, `numbering.levels[0]`, ...).
 */
export function resolveNumbering(value: unknown, path = "numbering"): NumberingResult {
  if (value === undefined) return { ok: true, scheme: CARS };
  if (value === "cars" || value === "legal" || value === "decimal") return { ok: true, scheme: PRESETS[value] };
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const scheme = (value as { scheme?: unknown }).scheme;
    if (scheme !== "custom") {
      return { ok: false, issues: [`${path}.scheme must be "custom" (presets are the strings "cars", "legal" and "decimal")`] };
    }
    return compileCustom(value, path);
  }
  return {
    ok: false,
    issues: [`${path} must be "cars", "legal" or "decimal", or an object { scheme: "custom", levels: [...] }`],
  };
}

// ---- regular (joiner + kind) schemes ----

function sequenceScheme(spec: {
  name: string;
  key: string;
  topLevels: number;
  levels: ProvisionLevel[];
  example?: string;
}): NumberingScheme {
  const compose = (parent: string, depth: number, ordinal: number) => composeSequence(spec.levels, parent, depth, ordinal);
  const example = spec.example ?? exampleOf(spec.levels, compose);
  return createScheme({
    name: spec.name,
    key: spec.key,
    levels: spec.levels,
    topLevels: spec.topLevels,
    idPattern: loosePattern(spec.levels),
    example,
    analyse: (text) => analyseSequence(spec.levels, example, text),
    compose,
  });
}

/** Compile a template under a preset name. The key is the grammar fingerprint, shared with a custom build of the same levels. */
function compilePreset(input: CustomSchemeInput, name: string, example?: string): NumberingScheme {
  const result = compileCustom(input, "numbering", { name, example });
  if (!result.ok) throw new Error(result.issues.join("\n"));
  return result.scheme;
}

function analyseSequence(levels: readonly ProvisionLevel[], example: string, text: string): IdAnalysis {
  const malformed = `Provision ID "${text}" is malformed: expected ${levels.map((l) => l.label).join(", ")}, for example ${example}`;
  if (text === "") return empty([malformed]);

  const prefixes: string[] = [];
  const segments: string[] = [];
  const ordinals: (number | null)[] = [];
  const problems: string[] = [];
  let rest = text;
  let built = "";

  const take = (level: ProvisionLevel, source: string): { token: string; rest: string } | null => {
    const m = new RegExp(`^${level.parseSource()}`).exec(source);
    return m ? { token: m[0], rest: source.slice(m[0].length) } : null;
  };
  const push = (segment: string, token: string, level: ProvisionLevel, consumed: string): void => {
    built += consumed;
    prefixes.push(built);
    segments.push(segment);
    const ord = token === "" ? null : level.readOrdinal(token);
    ordinals.push(ord);
    if (ord === null) {
      const shown = level.isParenthesised ? `(${token})` : token;
      problems.push(`${level.label} label "${shown}" of "${text}" must be ${level.requirement}`);
    }
  };

  const first = take(levels[0]!, rest);
  if (!first) return empty([malformed]);
  push(first.token, first.token, levels[0]!, first.token);
  rest = first.rest;

  for (let i = 1; i < levels.length && rest !== ""; i++) {
    const level = levels[i]!;
    if (level.joiner === ".") {
      if (!rest.startsWith(".")) {
        problems.push(malformed);
        break;
      }
      const next = take(level, rest.slice(1));
      if (!next) {
        const bad = rest.slice(1);
        push(bad, bad, level, rest);
        rest = "";
        break;
      }
      push(`.${next.token}`, next.token, level, `.${next.token}`);
      rest = next.rest;
    } else if (level.joiner === "()") {
      if (!rest.startsWith("(")) {
        problems.push(malformed);
        break;
      }
      const close = rest.indexOf(")");
      if (close < 0) {
        problems.push(malformed);
        break;
      }
      const token = rest.slice(1, close);
      push(`(${token})`, token, level, rest.slice(0, close + 1));
      rest = rest.slice(close + 1);
    } else if (level.joiner === "") {
      const next = take(level, rest);
      if (!next) {
        problems.push(malformed);
        rest = "";
        break;
      }
      push(next.token, next.token, level, next.token);
      rest = next.rest;
    } else {
      problems.push(malformed);
      break;
    }
  }

  if (rest !== "") {
    const last = levels[levels.length - 1]!;
    const extra = extraSegments(rest, last);
    if (extra > 0) {
      problems.push(`"${text}" is nested deeper than a ${last.label} (level ${levels.length}); restructure the provision`);
      let leftover = rest;
      for (let n = 0; n < extra; n++) {
        const consumed = shiftSegment(leftover, last);
        built += consumed;
        prefixes.push(built);
        segments.push(consumed);
        ordinals.push(null);
        leftover = leftover.slice(consumed.length);
      }
    } else if (!problems.length) {
      problems.push(malformed);
    }
  }

  return { prefixes, segments, ordinals, orderKey: ordinals.map((n) => n ?? 0), problems };
}

function composeSequence(levels: readonly ProvisionLevel[], parent: string, depth: number, ordinal: number): string {
  const level = levels[depth - 1];
  if (!level) throw new RangeError(`depth ${depth} is outside this numbering scheme`);
  const formatted = level.formatOrdinal(ordinal);
  if (depth === 1) return formatted;
  if (level.joiner === ".") return `${parent}.${formatted}`;
  if (level.joiner === "()") return `${parent}(${formatted})`;
  return parent + formatted;
}

function extraSegments(rest: string, level: ProvisionLevel): number {
  if (level.joiner === "()" && /^\([^()\s]*\)(?:\([^()\s]*\))*$/.test(rest)) return [...rest.matchAll(/\([^()\s]*\)/g)].length;
  if (level.joiner === "." && /^(?:\.[^.()]+)+$/.test(rest)) return rest.split(".").length - 1;
  return 0;
}

function shiftSegment(rest: string, level: ProvisionLevel): string {
  if (level.joiner === "()") {
    const close = rest.indexOf(")");
    return close < 0 ? rest : rest.slice(0, close + 1);
  }
  const dot = rest.indexOf(".", 1);
  return dot < 0 ? rest : rest.slice(0, dot);
}

function loosePattern(levels: readonly ProvisionLevel[]): string {
  let pattern = levels[0]!.looseSource();
  let i = 1;
  while (i < levels.length) {
    const joiner = levels[i]!.joiner;
    if (joiner === "") {
      while (i < levels.length && levels[i]!.joiner === "") {
        pattern += `(?:${levels[i]!.looseSource()})?`;
        i++;
      }
      continue;
    }
    let count = 0;
    const sources = new Set<string>();
    while (i < levels.length && levels[i]!.joiner === joiner) {
      sources.add(levels[i]!.looseSource());
      count++;
      i++;
    }
    if (joiner === ".") {
      pattern += `(?:\\.(?:${[...sources].join("|")})){0,${count}}`;
    } else if (joiner === "()") {
      pattern += String.raw`(?:\([^()\s]*\)){0,${count}}`;
    }
  }
  return pattern;
}

function exampleOf(
  levels: readonly ProvisionLevel[],
  compose: (parent: string, depth: number, ordinal: number) => string,
): string {
  let text = "";
  for (let depth = 1; depth <= levels.length; depth++) text = compose(text, depth, 1);
  return text;
}

// ---- custom scheme ----

function compileCustom(input: unknown, path: string, preset?: { name: string; example?: string }): NumberingResult {
  const issues: string[] = [];
  const raw = (input ?? {}) as { levels?: unknown; topLevels?: unknown };
  if (!Array.isArray(raw.levels) || raw.levels.length === 0) {
    return { ok: false, issues: [`${path}.levels must list at least one level`] };
  }

  interface Draft {
    label: string;
    name: string;
    kind: SegmentKind;
    kindName: CustomKindName;
    joiner: "" | "." | "()";
    italic: boolean;
    digits: DigitWidth | null;
    minOrdinal: number;
    showLabel: boolean;
    pageBreak: boolean | null;
    indent: number;
  }
  const drafts: Draft[] = [];
  const used = new Set<string>();
  raw.levels.forEach((item, i) => {
    const at = `${path}.levels[${i}]`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      issues.push(`${at} must be an object with label and kind`);
      return;
    }
    const row = item as {
      label?: unknown;
      name?: unknown;
      kind?: unknown;
      joiner?: unknown;
      italic?: unknown;
      digits?: unknown;
      min?: unknown;
      showLabel?: unknown;
      pageBreak?: unknown;
      indent?: unknown;
    };
    if (typeof row.label !== "string" || row.label.trim() === "") issues.push(`${at}.label must be a non-empty string`);
    if (typeof row.kind !== "string" || !(CUSTOM_KIND_NAMES as readonly string[]).includes(row.kind)) {
      issues.push(`${at}.kind must be one of ${CUSTOM_KIND_NAMES.join(", ")}`);
    }
    const kindName = (CUSTOM_KIND_NAMES as readonly string[]).includes(String(row.kind)) ? (row.kind as CustomKindName) : null;
    const first = i === 0;
    let joiner: "" | "." | "()" | null = null;
    if (row.joiner === undefined) joiner = first ? "" : kindName === "number" ? "." : "()";
    else if (row.joiner === "" || row.joiner === "." || row.joiner === "()") joiner = row.joiner;
    else issues.push(`${at}.joiner must be ".", "()" or ""`);
    if (joiner !== null && first && joiner !== "") issues.push(`${at}.joiner must be omitted or "" on the first level`);
    if (typeof row.italic !== "undefined" && typeof row.italic !== "boolean") issues.push(`${at}.italic must be a boolean`);
    if (typeof row.showLabel !== "undefined" && typeof row.showLabel !== "boolean") issues.push(`${at}.showLabel must be a boolean`);
    if (typeof row.pageBreak !== "undefined" && typeof row.pageBreak !== "boolean") issues.push(`${at}.pageBreak must be a boolean`);
    let indent = 0;
    if (row.indent !== undefined) {
      if (typeof row.indent !== "number" || !Number.isInteger(row.indent) || row.indent < 0) {
        issues.push(`${at}.indent must be a whole number of 0 or more`);
      } else indent = row.indent;
    }
    const digits = readDigits(row.digits, at, issues);
    let minOrdinal = 1;
    if (row.min !== undefined) {
      if (typeof row.min !== "number" || !Number.isInteger(row.min) || row.min < 0) issues.push(`${at}.min must be a whole number of 0 or more`);
      else minOrdinal = row.min;
    }
    if (kindName && kindName !== "number" && (digits || row.min !== undefined)) {
      issues.push(`${at}.digits and ${at}.min apply only to kind "number"`);
    }
    if (joiner === "" && !first && !(kindName === "number" && digits?.min === digits?.max)) {
      issues.push(`${at}.joiner "" concatenates a fixed-width number; set kind "number" and digits to an exact width`);
    }
    const label = typeof row.label === "string" && row.label.trim() !== "" ? row.label.trim() : "Level";
    let name = typeof row.name === "string" && row.name.trim() !== "" ? slug(row.name) : slug(label);
    while (used.has(name)) name = `${name}-${used.size + 1}`;
    used.add(name);
    if (kindName && joiner !== null && !(first && joiner !== "")) {
      drafts.push({
        label,
        name,
        kind: CUSTOM_KINDS[kindName],
        kindName,
        joiner,
        italic: row.italic === true,
        digits: digits ?? null,
        minOrdinal,
        showLabel: row.showLabel !== false,
        pageBreak: typeof row.pageBreak === "boolean" ? row.pageBreak : null,
        indent,
      });
    }
  });

  for (let i = 1; i < drafts.length; i++) {
    const prev = drafts[i - 1]!;
    const cur = drafts[i]!;
    if (cur.joiner === "" && prev.kindName === "number" && !(prev.digits && prev.digits.min === prev.digits.max)) {
      issues.push(`${path}.levels[${i - 1}].digits must be an exact width so ${path}.levels[${i}] can be concatenated onto it`);
    }
  }

  let topLevels = drafts.findIndex((d) => d.joiner === "()");
  if (topLevels < 1) topLevels = Math.max(1, drafts.length);
  if (raw.topLevels !== undefined) {
    if (typeof raw.topLevels !== "number" || !Number.isInteger(raw.topLevels) || raw.topLevels < 1 || raw.topLevels > raw.levels.length) {
      issues.push(`${path}.topLevels must be a whole number from 1 to ${raw.levels.length}`);
    } else topLevels = raw.topLevels;
  }
  if (issues.length || drafts.length !== raw.levels.length) return { ok: false, issues };

  const levels = drafts.map(
    (d, i) =>
      new ProvisionLevel(i + 1, d.name, d.label, d.kind, {
        joiner: d.joiner,
        italic: d.italic,
        ...(d.digits ? { digits: d.digits } : {}),
        min: d.minOrdinal,
        showLabel: d.showLabel,
        ...(d.pageBreak === null ? {} : { pageBreak: d.pageBreak }),
        indent: d.indent,
      }),
  );
  const scheme = sequenceScheme({
    name: preset?.name ?? "custom",
    key: grammarKey(drafts, topLevels),
    topLevels,
    levels,
    ...(preset?.example ? { example: preset.example } : {}),
  });
  return { ok: true, scheme };
}

function readDigits(value: unknown, at: string, issues: string[]): DigitWidth | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return { min: value, max: value };
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const { min, max } = value as { min?: unknown; max?: unknown };
    if (typeof min === "number" && typeof max === "number" && Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min) {
      return { min, max };
    }
  }
  issues.push(`${at}.digits must be a positive whole number, or { min, max } with 1 <= min <= max`);
  return undefined;
}

/** Identity of the ID shape. `showLabel`, `pageBreak` and `indent` are presentation, so they stay out of the key. */
function grammarKey(drafts: { kindName: string; joiner: string; italic: boolean; digits: DigitWidth | null; minOrdinal: number }[], topLevels: number): string {
  const body = drafts
    .map((d) => {
      const width = d.digits ? `${d.digits.min}-${d.digits.max}` : "-";
      return `${d.kindName}${d.joiner}d${width}m${d.minOrdinal}${d.italic ? "i" : ""}`;
    })
    .join("/");
  return `${body}:top${topLevels}`;
}

function slug(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "level";
}

function level(
  number: number,
  name: string,
  labelText: string,
  kind: SegmentKind,
  options: { joiner?: "" | "." | "()"; italic?: boolean; indent?: number } = {},
): ProvisionLevel {
  return new ProvisionLevel(number, name, labelText, kind, options);
}

function empty(problems: string[]): IdAnalysis {
  return { prefixes: [], segments: [], ordinals: [], orderKey: [], problems };
}

function createScheme(spec: {
  name: string;
  key: string;
  levels: readonly ProvisionLevel[];
  topLevels: number;
  idPattern: string;
  example: string;
  analyse: (text: string) => IdAnalysis;
  compose: (parent: string, depth: number, ordinal: number) => string;
}): NumberingScheme {
  return {
    name: spec.name,
    key: spec.key,
    levels: spec.levels,
    maxLevel: spec.levels.length,
    topLevels: spec.topLevels,
    idPattern: spec.idPattern,
    idShape: new RegExp(`^${spec.idPattern}$`),
    example: spec.example,
    analyse: spec.analyse,
    compose: spec.compose,
  };
}
