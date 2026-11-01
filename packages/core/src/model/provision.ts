// SPDX-License-Identifier: MPL-2.0
import type { Block } from "./block.js";
import type { ProvisionId, ProvisionLevel } from "./provision-id.js";
import type { Position } from "./diagnostic.js";

/** Explicit page-break control written as `{keep}` or `{break}` after a provision ID. */
export type ProvisionKeep = "keep" | "break";
/** Explicit page-start control written as `{page}` or `{nopage}` after a provision ID. */
export type ProvisionPage = "page" | "nopage";

export interface ProvisionIndexEntry {
  id: string;
  depth: number;
  level: string;
  line: number;
  repealed: boolean;
  title?: string;
}

export interface ProvisionProps {
  id: ProvisionId;
  /** The `[id]` token. */
  position: Position;
  startLine: number;
  endLine: number;
  blocks: readonly Block[];
  /** Heading text: the text after `# ` on the first line, at any level. */
  title?: string;
  /** Line (1-based) the title is written on. */
  titleLine?: number;
  /** `{keep}` / `{break}` written after the ID. */
  keep?: ProvisionKeep;
  /** `{page}` / `{nopage}` written after the ID. */
  page?: ProvisionPage;
  repealed: boolean;
  repealNote?: string;
}

export class Provision {
  readonly id: ProvisionId;
  readonly position: Position;
  readonly startLine: number;
  readonly endLine: number;
  readonly blocks: readonly Block[];
  readonly title?: string;
  readonly titleLine?: number;
  readonly keep?: ProvisionKeep;
  readonly page?: ProvisionPage;
  readonly repealed: boolean;
  readonly repealNote?: string;

  constructor(p: ProvisionProps) {
    this.id = p.id;
    this.position = p.position;
    this.startLine = p.startLine;
    this.endLine = p.endLine;
    this.blocks = p.blocks;
    this.repealed = p.repealed;
    if (p.title !== undefined) this.title = p.title;
    if (p.titleLine !== undefined) this.titleLine = p.titleLine;
    if (p.keep !== undefined) this.keep = p.keep;
    if (p.page !== undefined) this.page = p.page;
    if (p.repealNote !== undefined) this.repealNote = p.repealNote;
  }

  get depth(): number {
    return this.id.depth;
  }

  get parentId(): ProvisionId | null {
    return this.id.parent;
  }

  /** The deepest heading level of the numbering scheme (CARs Section, legal Section, ...). */
  get isSection(): boolean {
    return this.depth === this.id.scheme.topLevels;
  }

  /** The level of the ID (Part ... Subclause). */
  get level(): ProvisionLevel {
    return this.id.level;
  }

  /** Heading levels above the section level (CARs Part and Subpart) are optional divisions. */
  get isDivision(): boolean {
    return this.depth > 0 && this.depth < this.id.scheme.topLevels;
  }

  toIndexEntry(): ProvisionIndexEntry {
    return {
      id: this.id.text,
      depth: this.depth,
      level: this.level.label,
      line: this.startLine,
      repealed: this.repealed,
      ...(this.title ? { title: this.title } : {}),
    };
  }
}
