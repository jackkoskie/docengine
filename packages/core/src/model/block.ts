// SPDX-License-Identifier: MPL-2.0
import type { Figure } from "./figure.js";

/** How a table cell is merged: `||` merges into the cell on the left, a lone `^` into the cell above. */
export type TableMerge = "none" | "left" | "up";

export interface TableMerges {
  header: TableMerge[];
  rows: TableMerge[][];
}

export type BlockType = "paragraph" | "list" | "table" | "figure" | "code";

/** Content blocks inside a provision. Plain data: behaviour lives in the renderers. */
export type Block =
  | { type: "paragraph"; text: string; line: number }
  | { type: "list"; ordered: boolean; items: string[]; line: number }
  | { type: "table"; header: string[]; rows: string[][]; align: ("left" | "center" | "right")[]; merge?: TableMerges; line: number }
  | { type: "figure"; figure: Figure; line: number }
  | { type: "code"; lang: string; text: string; line: number };
