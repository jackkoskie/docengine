// SPDX-License-Identifier: MPL-2.0
import type { ProvisionId } from "../model/provision-id.js";
import type { Block, TableMerge } from "../model/block.js";
import { FIGURE_LINE, type FigureParser } from "./figure-parser.js";

export interface RawLine {
  text: string;
  line: number;
}

export const FENCE = /^\s*(```|~~~)\s*([\w-]*)/;
const LIST_ITEM = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Turns the raw lines of one provision into content blocks. */
export class BlockParser {
  constructor(private readonly figures: FigureParser) {}

  parse(rawLines: readonly RawLine[], owner: ProvisionId): Block[] {
    const blocks: Block[] = [];
    let i = 0;
    const startsBlock = (t: string): boolean =>
      t.trim() === "" || FIGURE_LINE.test(t) || LIST_ITEM.test(t) || FENCE.test(t) || TABLE_ROW.test(t);

    while (i < rawLines.length) {
      const { text, line } = rawLines[i]!;
      if (text.trim() === "") {
        i++;
        continue;
      }

      const fence = FENCE.exec(text);
      if (fence) {
        const marker = fence[1]!;
        const body: string[] = [];
        i++;
        while (i < rawLines.length && rawLines[i]!.text.trim() !== marker) body.push(rawLines[i++]!.text);
        i++; // closing fence
        blocks.push({ type: "code", lang: fence[2] ?? "", text: body.join("\n"), line });
        continue;
      }

      const fig = FIGURE_LINE.exec(text);
      if (fig) {
        blocks.push({ type: "figure", figure: this.figures.parse(fig, text, line, owner), line });
        i++;
        continue;
      }

      if (TABLE_ROW.test(text) && rawLines[i + 1] && TABLE_SEPARATOR.test(rawLines[i + 1]!.text)) {
        const split = (t: string) => t.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
        const cells = (t: string) => split(t).map((c) => c.trim());
        // `||` (nothing at all between the pipes) merges into the left cell; a cell that is only `^` into the one above.
        const merges = (t: string, allowUp: boolean): TableMerge[] =>
          split(t).map((raw): TableMerge => (raw === "" ? "left" : allowUp && raw.trim() === "^" ? "up" : "none"));
        const header = cells(text);
        const headerMerge = merges(text, false);
        const align = cells(rawLines[i + 1]!.text).map((c): "left" | "center" | "right" =>
          c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
        );
        i += 2;
        const rows: string[][] = [];
        const rowMerge: TableMerge[][] = [];
        while (i < rawLines.length && TABLE_ROW.test(rawLines[i]!.text)) {
          rows.push(cells(rawLines[i]!.text));
          rowMerge.push(merges(rawLines[i]!.text, rows.length > 1));
          i++;
        }
        const anyMerge = [headerMerge, ...rowMerge].some((r) => r.some((m) => m !== "none"));
        blocks.push({ type: "table", header, rows, align, ...(anyMerge ? { merge: { header: headerMerge, rows: rowMerge } } : {}), line });
        continue;
      }

      const li = LIST_ITEM.exec(text);
      if (li) {
        const ordered = /\d/.test(li[1]!);
        const items: string[] = [];
        while (i < rawLines.length) {
          const m = LIST_ITEM.exec(rawLines[i]!.text);
          if (m) {
            items.push(m[2]!);
            i++;
          } else if (/^\s{2,}\S/.test(rawLines[i]!.text) && items.length) {
            items[items.length - 1] += " " + rawLines[i]!.text.trim();
            i++;
          } else break;
        }
        blocks.push({ type: "list", ordered, items, line });
        continue;
      }

      const para: string[] = [text.trim()];
      i++;
      while (i < rawLines.length && !startsBlock(rawLines[i]!.text)) para.push(rawLines[i++]!.text.trim());
      blocks.push({ type: "paragraph", text: para.join(" "), line });
    }
    return blocks;
  }
}
