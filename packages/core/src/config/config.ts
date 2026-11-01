// SPDX-License-Identifier: MPL-2.0
import type { NumberingInput } from "../model/numbering/presets.js";
import type { NumberingScheme } from "../model/numbering/scheme.js";

export type ImageFormat = "svg" | "png" | "jpeg";
export type { NumberingInput, NumberingScheme };

export interface BrandingConfig {
  firName?: string;
  /** Logo path, relative to the config directory. */
  logo?: string;
  /** `highlight` is the fill for `==highlighted==` text (default: Typst's yellow). */
  colors?: { primary?: string; accent?: string; highlight?: string };
  font?: string;
  footer?: string;
  /** Custom letterhead template path (relative to the config directory). */
  template?: string;
}

export interface ImagesConfig {
  /** Maximum file size in bytes. Default 2 MB. */
  maxBytes?: number;
  allowedFormats?: ImageFormat[];
  /** Label used for figures, default "Figure". */
  label?: string;
  /** Raster images narrower than this (pixels) produce a warning. */
  minRasterWidth?: number;
}

/** Cover page settings. Everything unset falls back to `branding`. */
export interface CoverConfig {
  /** Default for the frontmatter `cover:` key. Default false. */
  enabled?: boolean;
  firName?: string;
  /** Logo path (relative to the config directory), shown large on the cover. */
  logo?: string;
  colors?: { primary?: string; accent?: string };
  /** Default notice line, for example "For Flight Simulation Use Only" (a document's `notice:` wins). */
  notice?: string;
  /** Custom cover template path (relative to the config directory). Replaces the bundled default. */
  template?: string;
}

/** Table of contents settings. It is shown when a document has a cover or sets `toc: true`. */
export interface TocConfig {
  /** Deepest heading level listed. For the cars scheme, 1 Part, 2 Subpart, 3 Section. Default 3. */
  depth?: number;
  /** Title above the list. Default "Table of Contents". */
  title?: string;
}

/** How titled provisions are rendered as headings. */
export interface HeadingsConfig {
  /** Placeholders: `{level}` (Part, Subpart, Section, ...), `{id}` and `{title}`. Default `{level} {id} — {title}`. */
  format?: string;
  /** Heading levels of the numbering scheme are always headings; titled provisions down to this level are headings too, deeper titles are run-in bold. For cars, 1 Part ... 8 Subclause. Default 3. */
  maxDepth?: number;
  /**
   * Headings down to this level start a new page (`1` = Parts, `2` = Parts and Subparts, `3` = every Section), or `false` for never. Default 2.
   * Applies only to documents with a table of contents, and only to numbering levels that omit `pageBreak`. `{page}` / `{nopage}` on a provision always win.
   */
  pageBreakBefore?: number | false;
}

/** Bundled fonts, so PDF output does not depend on the fonts installed on the machine. */
export interface FontsConfig {
  /** Directories (relative to the config directory) containing font files; passed to Typst as `--font-path`. */
  paths?: string[];
  /** Ignore installed system fonts (`--ignore-system-fonts`). Default false. */
  ignoreSystemFonts?: boolean;
}

/** User-facing config (what `docengine.config.*` exports). Plain serialisable data. */
export interface DocengineConfig {
  branding?: BrandingConfig;
  cover?: CoverConfig;
  fonts?: FontsConfig;
  toc?: TocConfig;
  headings?: HeadingsConfig;
  /** Keep headings with the text after them, and a paragraph with the figure it introduces. Default true. */
  keepWithNext?: boolean;
  /**
   * Default provision numbering. `"cars"` (default), `"legal"`, `"decimal"`, or
   * `{ scheme: "custom", levels: [...] }`. A document's front matter `numbering` overrides this.
   * Depth is the length of the scheme; there is no separate max-depth setting.
   */
  numbering?: NumberingInput;
  /** Glob for document files, default `documents/**\/*.md`. */
  documents?: string;
  outDir?: string;
  images?: ImagesConfig;
  /** Append a generated "Summary of changes" page to each PDF (from the provision diff). Default false. */
  summaryOfChanges?: boolean;
  /**
   * Extra frontmatter fields as arktype definitions, for example
   * `{ required: "boolean", "public?": "boolean" }`.
   */
  extensions?: Record<string, unknown>;
}

/** Config with defaults applied. */
export interface ResolvedConfig {
  branding: {
    firName: string;
    logo: string | null;
    colors: { primary: string; accent: string; highlight: string | null };
    font: string;
    footer: string;
    template: string | null;
  };
  cover: {
    enabled: boolean;
    /** Falls back to `branding.firName` when null. */
    firName: string | null;
    /** Falls back to `branding.logo` when null. */
    logo: string | null;
    colors: { primary: string | null; accent: string | null };
    notice: string | null;
    template: string | null;
  };
  fonts: { paths: string[]; ignoreSystemFonts: boolean };
  toc: { depth: number; title: string };
  headings: { format: string; maxDepth: number; pageBreakBefore: number | false };
  /** Effective default scheme. Documents may override it in front matter. */
  numbering: NumberingScheme;
  keepWithNext: boolean;
  documents: string;
  outDir: string;
  summaryOfChanges: boolean;
  images: {
    maxBytes: number;
    allowedFormats: ImageFormat[];
    label: string;
    minRasterWidth: number;
  };
  extensions: Record<string, unknown>;
}

/** Default heading format; the em dash is dropped when a heading has no title. */
export const DEFAULT_HEADING_FORMAT = "{level} {id} \u2014 {title}";

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid docengine config:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export function defineConfig(config: DocengineConfig): DocengineConfig {
  return config;
}
