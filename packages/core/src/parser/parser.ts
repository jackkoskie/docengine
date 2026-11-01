// SPDX-License-Identifier: MPL-2.0
import { Provision } from "../model/provision.js";
import type { ProvisionKeep, ProvisionPage } from "../model/provision.js";
import { CARS, resolveNumbering } from "../model/numbering/presets.js";
import type { NumberingScheme } from "../model/numbering/scheme.js";
import { ProvisionId } from "../model/provision-id.js";
import { type Diagnostic, DiagnosticCollector, type Position } from "../model/diagnostic.js";
import { Document } from "../model/document.js";
import { Footnote, type FootnoteReference } from "../model/footnote.js";
import type { Reference } from "../model/reference.js";
import { BlockParser, FENCE, type RawLine } from "./block-parser.js";
import { FigureParser } from "./figure-parser.js";
import { FOOTNOTE_DEFINITION, FootnoteScanner } from "./footnote-scanner.js";
import { FrontmatterParser } from "./frontmatter-parser.js";
import { ReferenceScanner } from "./reference-scanner.js";

export interface ParseOptions {
  /** Used only to label diagnostics. */
  file?: string;
  /** Workspace default scheme. Front matter `numbering` overrides it; an invalid value falls back to this and reports `invalid-numbering`. */
  scheme?: NumberingScheme;
}

/** Turns source text into a `Document`. Never throws: returns a partial tree plus diagnostics. */
export interface Parser {
  parse(source: string, options?: ParseOptions): Document;
}

/** `[id] text`. A footnote label `[^id]` is not a provision (and a `[repealed]` marker is not an ID). */
const PROVISION_LINE = /^\[(?!\^)([^\[\]\s]*)\](?!\()\s*(.*)$/;
const REPEALED = /^\[repealed\]\s*(.*)$/i;
/** `{keep}`, `{break}`, `{page}` or `{nopage}` (any mix) right after the ID. */
const ATTRIBUTE = /^\{\s*(keep|break|page|nopage)\s*\}\s*/;
/** `# Title`: a lone `#` (empty title) or `#` followed by whitespace and the title text. */
const TITLE_MARKER = /^#(?:\s+(.*))?$/;
/** The tail of a titled tombstone: `[repealed] optional note` after the title. */
const TITLED_TOMBSTONE = /^(.*?)\s*\[repealed\]\s*(.*)$/i;
const CONTINUATION = /^[ \t]{2,}\S/;

/** Accumulates one provision's lines until the next provision starts. */
class ProvisionDraft {
  endLine: number;
  readonly lines: RawLine[] = [];
  readonly repealed: boolean;
  readonly repealNote?: string;
  keep?: ProvisionKeep;
  page?: ProvisionPage;
  /** Set when the first line carried an explicit `# Title` marker (possibly empty). */
  readonly title?: string;

  constructor(
    readonly id: ProvisionId,
    readonly position: Position,
    readonly startLine: number,
    firstText: string,
  ) {
    this.endLine = startLine;
    let rest = firstText;
    for (let a = ATTRIBUTE.exec(rest); a; a = ATTRIBUTE.exec(rest)) {
      if (a[1] === "page" || a[1] === "nopage") this.page = a[1];
      else this.keep = a[1] as ProvisionKeep;
      rest = rest.slice(a[0].length);
    }
    const rm = REPEALED.exec(rest);
    const tm = rm ? null : TITLE_MARKER.exec(rest.trim());
    if (rm) {
      this.repealed = true;
      if (rm[1]) this.repealNote = rm[1];
      this.lines.push({ text: rest, line: startLine });
    } else if (tm) {
      // `# Old title [repealed] note`: a titled tombstone (it stays in the table of contents).
      const t = TITLED_TOMBSTONE.exec(tm[1] ?? "");
      this.repealed = t !== null;
      this.title = (t ? t[1]! : (tm[1] ?? "")).trim();
      if (t?.[2]) this.repealNote = t[2];
    } else {
      this.repealed = false;
      this.lines.push({ text: rest, line: startLine });
    }
  }

  push(line: RawLine): void {
    this.lines.push(line);
    if (line.text.trim() !== "") this.endLine = line.line;
  }
}

/** A footnote definition being collected (its continuation lines are indented). */
class FootnoteDraft {
  private readonly parts: string[];
  endLine: number;

  constructor(
    readonly id: string,
    readonly position: Position,
    firstText: string,
  ) {
    this.parts = firstText.trim() ? [firstText.trim()] : [];
    this.endLine = position.line;
  }

  append(text: string, line: number): void {
    this.parts.push(text.trim());
    this.endLine = line;
  }

  build(): Footnote {
    return new Footnote(this.id, this.parts.join(" "), this.position, this.endLine);
  }
}

/** Removes `<!-- ... -->` (possibly spanning lines) from the text before the first provision. */
class HtmlCommentSkipper {
  private open = false;

  /** The text outside comments, and whether the line touched a comment at all. */
  strip(text: string): { text: string; touched: boolean } {
    let touched = this.open;
    let rest = text;
    let out = "";
    for (;;) {
      if (this.open) {
        const end = rest.indexOf("-->");
        if (end < 0) return { text: out, touched };
        rest = rest.slice(end + 3);
        this.open = false;
        continue;
      }
      const start = rest.indexOf("<!--");
      if (start < 0) return { text: out + rest, touched };
      touched = true;
      out += rest.slice(0, start);
      rest = rest.slice(start + 4);
      this.open = true;
    }
  }
}

export class MarkdownParser implements Parser {
  private readonly frontmatterParser = new FrontmatterParser();
  private readonly scanner = new ReferenceScanner();
  private readonly footnoteScanner = new FootnoteScanner();

  parse(source: string, options: ParseOptions = {}): Document {
    const file = options.file;
    const sink = new DiagnosticCollector(file);
    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

    const fm = this.frontmatterParser.parse(lines, sink);
    const scheme = this.resolveScheme(fm.frontmatter.numbering, options.scheme ?? CARS, fm, sink);
    const drafts: ProvisionDraft[] = [];
    const references: Reference[] = [];
    const footnotes: Footnote[] = [];
    const footnoteReferences: FootnoteReference[] = [];
    const comments = new HtmlCommentSkipper();
    let current: ProvisionDraft | null = null;
    let foot: FootnoteDraft | null = null;
    let fence: string | null = null;
    let warnedPreamble = false;

    const closeFootnote = (): void => {
      if (foot) footnotes.push(foot.build());
      foot = null;
    };
    const scan = (text: string, lineNo: number, insideFootnote: boolean): void => {
      references.push(...this.scanner.scan(text, lineNo, current?.id ?? null, scheme));
      footnoteReferences.push(...this.footnoteScanner.scan(text, lineNo, current?.id ?? null, insideFootnote));
    };

    for (let i = fm.bodyStart; i < lines.length; i++) {
      const text = lines[i]!;
      const lineNo = i + 1;

      const fenceMatch = FENCE.exec(text);
      if (fenceMatch) {
        closeFootnote();
        if (fence === null) fence = fenceMatch[1]!;
        else if (fenceMatch[1] === fence && text.trim() === fence) fence = null;
        current?.push({ text, line: lineNo });
        continue;
      }
      if (fence !== null) {
        current?.push({ text, line: lineNo });
        continue;
      }

      // Before the first provision, comments and blank lines are not content.
      if (current === null) {
        const stripped = comments.strip(text);
        if (stripped.touched && stripped.text.trim() === "") continue;
      }

      const definition = FOOTNOTE_DEFINITION.exec(text);
      if (definition) {
        closeFootnote();
        const labelLength = text.indexOf("]:") + 2;
        foot = new FootnoteDraft(definition[1]!, { line: lineNo, column: 1, length: definition[1]!.length + 3 }, definition[2]!);
        scan(" ".repeat(labelLength) + text.slice(labelLength), lineNo, true);
        continue;
      }
      if (foot) {
        if (CONTINUATION.test(text)) {
          (foot as FootnoteDraft).append(text, lineNo);
          scan(text, lineNo, true);
          continue;
        }
        if (text.trim() === "") {
          let j = i + 1;
          while (j < lines.length && lines[j]!.trim() === "") j++;
          if (j < lines.length && CONTINUATION.test(lines[j]!)) continue;
        }
        closeFootnote();
      }

      const cm = PROVISION_LINE.exec(text);
      if (cm) {
        const id = ProvisionId.parse(cm[1]!, scheme);
        current = new ProvisionDraft(id, { line: lineNo, column: 1, length: id.text.length + 2 }, lineNo, cm[2]!);
        drafts.push(current);
      } else if (current) {
        current.push({ text, line: lineNo });
      } else if (text.trim() !== "" && !warnedPreamble) {
        warnedPreamble = true;
        sink.warning("content-outside-provision", "Text before the first provision is not part of any provision and is ignored", {
          line: lineNo,
          column: 1,
          length: text.length,
        });
      }
      scan(text, lineNo, false);
    }
    closeFootnote();
    if (fence !== null) {
      sink.warning("unclosed-code-fence", "Code fence is never closed", { line: lines.length, column: 1, length: 1 });
    }

    const figureParser = new FigureParser(sink);
    const blockParser = new BlockParser(figureParser);
    const provisions = drafts.map((d) => this.buildProvision(d, blockParser));

    return new Document({
      ...(file !== undefined ? { file } : {}),
      frontmatter: fm.frontmatter,
      frontmatterPositions: fm.positions,
      frontmatterStart: fm.start,
      bodyStartLine: fm.bodyStart + 1,
      provisions,
      figures: figureParser.figures,
      references,
      footnotes,
      footnoteReferences,
      diagnostics: sink.items as readonly Diagnostic[],
      scheme,
    });
  }

  /** Front matter wins over the workspace default. An invalid value keeps the default and records a diagnostic. */
  private resolveScheme(
    value: unknown,
    fallback: NumberingScheme,
    fm: { positions: Record<string, { value: { line: number; column: number; length: number } }>; start: { line: number; column: number; length: number } | null },
    sink: DiagnosticCollector,
  ): NumberingScheme {
    if (value === undefined) return fallback;
    const result = resolveNumbering(value, "numbering");
    if (!result.ok) {
      const at = fm.positions.numbering?.value ?? fm.start ?? { line: 1, column: 1, length: 1 };
      for (const issue of result.issues) sink.error("invalid-numbering", issue, at);
      return fallback;
    }
    return result.scheme;
  }

  private buildProvision(d: ProvisionDraft, blockParser: BlockParser): Provision {
    let blocks = blockParser.parse(d.lines, d.id);
    if (d.repealed && d.title === undefined && blocks[0]?.type === "paragraph") blocks = blocks.slice(1); // the tombstone line itself
    const title = d.title;
    const titleLine = d.title !== undefined ? d.startLine : undefined;
    return new Provision({
      id: d.id,
      position: d.position,
      startLine: d.startLine,
      endLine: d.endLine,
      blocks,
      repealed: d.repealed,
      ...(title !== undefined ? { title } : {}),
      ...(titleLine !== undefined ? { titleLine } : {}),
      ...(d.keep !== undefined ? { keep: d.keep } : {}),
      ...(d.page !== undefined ? { page: d.page } : {}),
      ...(d.repealNote !== undefined ? { repealNote: d.repealNote } : {}),
    });
  }
}

/** Facade over `MarkdownParser`. */
export function parse(source: string, options: ParseOptions = {}): Document {
  return new MarkdownParser().parse(source, options);
}
