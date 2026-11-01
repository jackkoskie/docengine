// SPDX-License-Identifier: MPL-2.0
import { CARS } from "../model/numbering/presets.js";
import { levelOf, type NumberingScheme } from "../model/numbering/scheme.js";
import { ProvisionId } from "../model/provision-id.js";
import { FIGURE_LINE } from "../parser/figure-parser.js";

export type FormatChangeKind = "fill-id" | "figure-attributes" | "tombstone" | "restore-tombstone";

export interface FormatChange {
  kind: FormatChangeKind;
  /** 1-based line in the source the change applies to. */
  line: number;
  message: string;
}

export interface FormatProblem {
  line: number;
  message: string;
}

export interface FormatResult {
  text: string;
  changes: FormatChange[];
  problems: FormatProblem[];
}

export interface FormatOptions {
  /** Scheme used to fill blank IDs. Default: cars. Pass the document's effective scheme. */
  scheme?: NumberingScheme;
  /** Columns per nesting level for blank `[]` provisions. Default: the smallest indent used, else 2. */
  indentWidth?: number;
  /** Provision IDs of the previous release that are missing now; each gets a `[repealed]` tombstone back. */
  restoreTombstones?: readonly string[];
}

const BLANK_PROVISION = /^([ \t]*)\[\](?!\()(.*)$/;
const EXPLICIT_PROVISION = /^\[(?!\^)([^\[\]\s]+)\](?!\()/;
const FENCE_LINE = /^\s*(```|~~~)/;
const TOMBSTONE = /^(\[[^\[\]\s]+\]\s*)\[repealed\]/i;

/** A step in the formatting pipeline over the document's lines. */
interface LineStep {
  apply(lines: string[], options: FormatOptions, changes: FormatChange[], problems: FormatProblem[]): string[];
}

/** Yields the indexes of body lines outside frontmatter and code fences. */
function* bodyLines(lines: readonly string[]): Generator<number> {
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n >= 1 && (l.trim() === "---" || l.trim() === "..."));
    i = end === -1 ? lines.length : end + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const m = FENCE_LINE.exec(lines[i]!);
    if (m) {
      if (fence === null) fence = m[1]!;
      else if (m[1] === fence) fence = null;
      continue;
    }
    if (fence === null) yield i;
  }
}

/**
 * Fills blank `[]` provisions with the next ID. The level comes from indentation: no indent is a new
 * Section (the next number after the last Section), one level of indent a Subsection of the previous
 * Section, two a Paragraph, and so on. Existing
 * IDs are never touched, and a fill that would collide with an existing ID is refused.
 */
export class BlankIdFiller implements LineStep {
  apply(lines: string[], options: FormatOptions, changes: FormatChange[], problems: FormatProblem[]): string[] {
    const body = [...bodyLines(lines)];
    const existing = new Set<string>();
    const widths: number[] = [];
    const tabWidth = options.indentWidth ?? 2;
    const width = (ws: string) => ws.replaceAll("\t", " ".repeat(tabWidth)).length;
    for (const i of body) {
      const e = EXPLICIT_PROVISION.exec(lines[i]!);
      if (e) existing.add(e[1]!);
      const b = BLANK_PROVISION.exec(lines[i]!);
      if (b && width(b[1]!) > 0) widths.push(width(b[1]!));
    }
    const unit = options.indentWidth ?? (widths.length ? Math.min(...widths) : 2);

    const scheme = options.scheme ?? CARS;
    const top = scheme.topLevels;
    const labelOf = (n: number): string => levelOf(scheme, n).label;
    const out = [...lines];
    const maxOrdinal = new Map<string, number>();
    let prev: ProvisionId | null = null;
    let lastSection = null as ProvisionId | null;
    const register = (id: ProvisionId): void => {
      if (id.depth === top - 1 || id.depth === top) {
        // The anchor for the next blank section-level ID: the highest division or section so far.
        if (!lastSection || id.compare(lastSection) > 0) lastSection = id;
        return;
      }
      if (id.depth < top) return;
      const key = id.parent!.text;
      const ord = id.ordinal;
      if (ord !== null) maxOrdinal.set(key, Math.max(maxOrdinal.get(key) ?? 0, ord));
    };

    for (const i of body) {
      const text = lines[i]!;
      const explicit = EXPLICIT_PROVISION.exec(text);
      if (explicit) {
        const id = ProvisionId.parse(explicit[1]!, scheme);
        if (id.isWellFormed) {
          register(id);
          prev = id;
        }
        continue;
      }
      const blank = BLANK_PROVISION.exec(text);
      if (!blank) continue;

      const indent = Math.floor(width(blank[1]!) / unit);
      const rest = blank[2]!.trim();
      const line = i + 1;
      let id: ProvisionId | null = null;
      if (indent === 0) {
        // No indent: a new section-level ID, numbered after the last one in the document.
        const next = lastSection
          ? lastSection.depth === top - 1
            ? ProvisionId.parse(scheme.compose(lastSection.text, top, 1), scheme)
            : lastSection.nextSection()
          : null;
        if (next) id = next;
        else {
          problems.push({
            line,
            message:
              scheme.name === "cars"
                ? "A blank [] at the left margin needs a Section or a declared Subpart before it to continue from; write the first Section ID (for example [602.01]) yourself"
                : `A blank [] at the left margin needs a ${labelOf(top)} before it to continue from; write the first ${labelOf(top)} ID (for example [${scheme.example}]) yourself`,
          });
        }
      } else {
        // Each indent level nests one level deeper than the section level.
        const target = top + indent;
        const parent = prev ? [prev, ...prev.ancestors].find((p) => p.depth === target - 1) : undefined;
        if (target > scheme.maxLevel) {
          problems.push({ line, message: `Blank [] is indented too deep: nesting stops at ${labelOf(scheme.maxLevel)}` });
        } else if (parent && parent.depth >= top) {
          id = parent.child((maxOrdinal.get(parent.text) ?? 0) + 1);
        } else {
          problems.push({
            line,
            message: `Blank [] is indented to the ${labelOf(target)} level but there is no ${labelOf(target - 1)} before it to nest under`,
          });
        }
      }
      if (!id) continue;
      if (existing.has(id.text)) {
        problems.push({
          line,
          message: `Next ID [${id.text}] is already used further down; insert in the middle with an explicit ID or \`docengine renumber\`, not a blank []`,
        });
        continue;
      }
      existing.add(id.text);
      register(id);
      prev = id;
      out[i] = `[${id.text}]${rest ? ` ${rest}` : ""}`;
      changes.push({ kind: "fill-id", line, message: `filled blank [] with [${id.text}]` });
    }
    return out;
  }
}

/** Rewrites every figure attribute block as `{#fig:key width= align= placement= ...}`. */
export class FigureAttributeNormalizer implements LineStep {
  private static readonly ORDER = ["width", "align", "placement"];

  apply(lines: string[], _options: FormatOptions, changes: FormatChange[]): string[] {
    const out = [...lines];
    for (const i of bodyLines(lines)) {
      const m = FIGURE_LINE.exec(lines[i]!);
      if (!m) continue;
      const tokens = (m[3] ?? "").split(/\s+/).filter(Boolean);
      const name = (t: string) => (t.includes("=") ? t.slice(0, t.indexOf("=")) : t);
      const keys = tokens.filter((t) => t.startsWith("#"));
      const known = FigureAttributeNormalizer.ORDER.flatMap((n) => tokens.filter((t) => !t.startsWith("#") && name(t) === n));
      const rest = tokens.filter((t) => !t.startsWith("#") && !FigureAttributeNormalizer.ORDER.includes(name(t)));
      const attrs = [...keys, ...known, ...rest];
      const next = `![${m[1]}](${m[2]})${attrs.length ? `{${attrs.join(" ")}}` : ""}`;
      if (next !== lines[i]) {
        out[i] = next;
        changes.push({ kind: "figure-attributes", line: i + 1, message: "normalized figure attributes" });
      }
    }
    return out;
  }
}

/** Writes tombstones as `[id] [repealed]` (lower case) so they are consistent. */
export class TombstoneNormalizer implements LineStep {
  apply(lines: string[], _options: FormatOptions, changes: FormatChange[]): string[] {
    const out = [...lines];
    for (const i of bodyLines(lines)) {
      const m = TOMBSTONE.exec(lines[i]!);
      if (m && !lines[i]!.startsWith(`${m[1]}[repealed]`)) {
        out[i] = lines[i]!.replace(TOMBSTONE, "$1[repealed]");
        changes.push({ kind: "tombstone", line: i + 1, message: "normalized tombstone" });
      }
    }
    return out;
  }
}

/** Puts back `[id] [repealed]` for IDs that disappeared since the previous release. */
export class TombstoneRestorer implements LineStep {
  apply(lines: string[], options: FormatOptions, changes: FormatChange[], problems: FormatProblem[]): string[] {
    const scheme = options.scheme ?? CARS;
    const wanted = (options.restoreTombstones ?? []).map((t) => ProvisionId.parse(t, scheme));
    if (wanted.length === 0) return lines;
    const out = [...lines];
    const present = new Set<string>();
    for (const i of bodyLines(out)) {
      const e = EXPLICIT_PROVISION.exec(out[i]!);
      if (e) present.add(e[1]!);
    }
    for (const id of wanted.filter((w) => w.isWellFormed && !present.has(w.text)).sort((a, b) => a.compare(b))) {
      let at = out.length;
      for (const i of bodyLines(out)) {
        const e = EXPLICIT_PROVISION.exec(out[i]!);
        if (e && ProvisionId.parse(e[1]!, scheme).isWellFormed && ProvisionId.parse(e[1]!, scheme).compare(id) > 0) {
          at = i;
          break;
        }
      }
      if (at === out.length) {
        while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
        out.push("", `[${id.text}] [repealed]`, "");
      } else out.splice(at, 0, `[${id.text}] [repealed]`, "");
      present.add(id.text);
      changes.push({
        kind: "restore-tombstone",
        line: at + 1,
        message: `restored tombstone [${id.text}] [repealed]; published IDs are never deleted`,
      });
    }
    void problems;
    return out;
  }
}

/** Formats a document's source. Never renumbers an existing ID. */
export class Formatter {
  constructor(
    private readonly steps: readonly LineStep[] = [
      new BlankIdFiller(),
      new TombstoneNormalizer(),
      new TombstoneRestorer(),
      new FigureAttributeNormalizer(),
    ],
  ) {}

  format(source: string, options: FormatOptions = {}): FormatResult {
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    let lines = source.split(/\r?\n/);
    const changes: FormatChange[] = [];
    const problems: FormatProblem[] = [];
    for (const step of this.steps) lines = step.apply(lines, options, changes, problems);
    return { text: lines.join(eol), changes, problems };
  }
}
