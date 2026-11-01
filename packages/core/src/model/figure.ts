// SPDX-License-Identifier: MPL-2.0
import type { ImageFormat } from "../config/config.js";
import type { ProvisionId } from "./provision-id.js";
import type { Position } from "./diagnostic.js";
import { imageFormat, resolveAssetPath } from "./paths.js";

export type FigureAlign = "left" | "center" | "right";
export type FigurePlacement = "inline" | "float";

export interface FigureIndexEntry {
  key: string | null;
  number: number;
  caption: string;
  /** Path as written in the Markdown. */
  path: string;
  /** Path relative to the repo root. */
  source: string;
  sha256: string | null;
}

export interface FigureProps {
  key?: string;
  /** Caption, also used as alt text. */
  caption: string;
  /** Path as written, relative to the Markdown file. */
  path: string;
  width?: string;
  align?: FigureAlign;
  placement?: FigurePlacement;
  /** Derived, 1-based, in order of appearance. */
  number: number;
  provisionId: ProvisionId | null;
  position: Position;
  keyPosition?: Position;
  pathPosition: Position;
  line: number;
}

export class Figure {
  readonly key?: string;
  readonly caption: string;
  readonly path: string;
  readonly width?: string;
  readonly align?: FigureAlign;
  readonly placement?: FigurePlacement;
  readonly number: number;
  /** The provision this figure follows. */
  readonly provisionId: ProvisionId | null;
  readonly position: Position;
  readonly keyPosition?: Position;
  readonly pathPosition: Position;
  readonly line: number;

  constructor(p: FigureProps) {
    this.caption = p.caption;
    this.path = p.path;
    this.number = p.number;
    this.provisionId = p.provisionId;
    this.position = p.position;
    this.pathPosition = p.pathPosition;
    this.line = p.line;
    if (p.key !== undefined) this.key = p.key;
    if (p.width !== undefined) this.width = p.width;
    if (p.align !== undefined) this.align = p.align;
    if (p.placement !== undefined) this.placement = p.placement;
    if (p.keyPosition !== undefined) this.keyPosition = p.keyPosition;
  }

  get isReferenceable(): boolean {
    return this.key !== undefined;
  }

  get hasCaption(): boolean {
    return this.caption.trim() !== "";
  }

  /** Typst label, e.g. `fig-rvsm-profile` (undefined without a key). */
  get typstLabel(): string | undefined {
    return this.key === undefined ? undefined : `fig-${this.key}`;
  }

  get format(): ImageFormat | null {
    return imageFormat(this.path);
  }

  /** Repo-relative path of the image file given the owning document's path. */
  sourcePath(docFile: string | undefined): string {
    return resolveAssetPath(docFile, this.path);
  }

  toIndexEntry(docFile: string | undefined, hashes: Readonly<Record<string, string>> = {}): FigureIndexEntry {
    const source = this.sourcePath(docFile);
    return {
      key: this.key ?? null,
      number: this.number,
      caption: this.caption,
      path: this.path,
      source,
      sha256: hashes[source] ?? null,
    };
  }
}
