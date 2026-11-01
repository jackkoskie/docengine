// SPDX-License-Identifier: MPL-2.0
import { CARS, resolveNumbering } from "../model/numbering/presets.js";
import { ConfigError, DEFAULT_HEADING_FORMAT, type DocengineConfig, type ImageFormat, type ResolvedConfig } from "./config.js";

/** Turns raw user config into a validated `ResolvedConfig`. Pure: no file access. */
export interface ConfigLoader {
  load(input: unknown): ResolvedConfig;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

type Obj = Record<string, any>;

export class DefaultConfigLoader implements ConfigLoader {
  load(input: unknown = {}): ResolvedConfig {
    const issues: string[] = [];
    const raw = (input ?? {}) as Obj;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(["config must be an object"]);

    const branding = this.branding((raw.branding ?? {}) as Obj, issues);
    const images = this.images((raw.images ?? {}) as Obj, issues);
    const ext = raw.extensions ?? {};
    if (typeof ext !== "object" || Array.isArray(ext)) issues.push("extensions must be an object");

    const numbering = this.numbering(raw.numbering, issues);
    const config: ResolvedConfig = {
      branding,
      documents: this.str(raw.documents, "documents", "documents/**/*.md", issues),
      outDir: this.str(raw.outDir, "outDir", "dist", issues),
      images,
      cover: this.cover((raw.cover ?? {}) as Obj, issues),
      fonts: this.fonts((raw.fonts ?? {}) as Obj, issues),
      toc: this.toc((raw.toc ?? {}) as Obj, issues),
      headings: this.headings((raw.headings ?? {}) as Obj, issues),
      numbering,
      keepWithNext: this.bool(raw.keepWithNext, "keepWithNext", issues, true),
      summaryOfChanges: this.bool(raw.summaryOfChanges, "summaryOfChanges", issues),
      extensions: typeof ext === "object" && !Array.isArray(ext) ? { ...ext } : {},
    };
    if (issues.length) throw new ConfigError(issues);
    return config;
  }

  private str(v: unknown, path: string, def: string, issues: string[]): string {
    if (v === undefined) return def;
    if (typeof v !== "string") {
      issues.push(`${path} must be a string`);
      return def;
    }
    return v;
  }

  private bool(v: unknown, path: string, issues: string[], def = false): boolean {
    if (v === undefined) return def;
    if (typeof v !== "boolean") {
      issues.push(`${path} must be a boolean`);
      return def;
    }
    return v;
  }

  private depth(v: unknown, path: string, def: number, issues: string[]): number {
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      issues.push(`${path} must be a whole number >= 1`);
      return def;
    }
    return v;
  }

  private optColor(v: unknown, path: string, issues: string[]): string | null {
    const s = this.optStr(v, path, issues);
    if (s !== null && !COLOR.test(s)) issues.push(`${path} must be a #rrggbb color`);
    return s;
  }

  private optStr(v: unknown, path: string, issues: string[]): string | null {
    return v === undefined || v === null ? null : this.str(v, path, "", issues);
  }

  private branding(b: Obj, issues: string[]): ResolvedConfig["branding"] {
    const colors = (b.colors ?? {}) as Obj;
    const primary = this.str(colors.primary, "branding.colors.primary", "#1f3a5f", issues);
    const accent = this.str(colors.accent, "branding.colors.accent", "#6b7c93", issues);
    for (const [k, v] of [["primary", primary], ["accent", accent]] as const) {
      if (!COLOR.test(v)) issues.push(`branding.colors.${k} must be a #rrggbb color`);
    }
    return {
      firName: this.str(b.firName, "branding.firName", "Flight Information Region", issues),
      logo: this.optStr(b.logo, "branding.logo", issues),
      colors: { primary, accent, highlight: this.optColor(colors.highlight, "branding.colors.highlight", issues) },
      font: this.str(b.font, "branding.font", "Libertinus Serif", issues),
      footer: this.str(b.footer, "branding.footer", "", issues),
      template: this.optStr(b.template, "branding.template", issues),
    };
  }

  private cover(c: Obj, issues: string[]): ResolvedConfig["cover"] {
    const colors = (c.colors ?? {}) as Obj;
    return {
      enabled: this.bool(c.enabled, "cover.enabled", issues, true),
      firName: this.optStr(c.firName, "cover.firName", issues),
      logo: this.optStr(c.logo, "cover.logo", issues),
      colors: {
        primary: this.optColor(colors.primary, "cover.colors.primary", issues),
        accent: this.optColor(colors.accent, "cover.colors.accent", issues),
      },
      notice: this.optStr(c.notice, "cover.notice", issues),
      template: this.optStr(c.template, "cover.template", issues),
    };
  }

  private fonts(f: Obj, issues: string[]): ResolvedConfig["fonts"] {
    if (typeof f !== "object" || Array.isArray(f)) {
      issues.push("fonts must be an object");
      return { paths: [], ignoreSystemFonts: false };
    }
    const raw = f.paths ?? [];
    let paths: string[] = [];
    if (!Array.isArray(raw) || raw.some((p) => typeof p !== "string" || p.trim() === "")) {
      issues.push("fonts.paths must be an array of non-empty directory paths");
    } else {
      paths = [...raw];
    }
    return { paths, ignoreSystemFonts: this.bool(f.ignoreSystemFonts, "fonts.ignoreSystemFonts", issues) };
  }

  private toc(t: Obj, issues: string[]): ResolvedConfig["toc"] {
    return {
      depth: this.depth(t.depth, "toc.depth", 3, issues),
      title: this.str(t.title, "toc.title", "Table of Contents", issues),
    };
  }

  private numbering(value: unknown, issues: string[]): ResolvedConfig["numbering"] {
    const result = resolveNumbering(value, "numbering");
    if (!result.ok) {
      issues.push(...result.issues);
      return CARS;
    }
    return result.scheme;
  }

  private headings(h: Obj, issues: string[]): ResolvedConfig["headings"] {
    const format = this.str(h.format, "headings.format", DEFAULT_HEADING_FORMAT, issues);
    if (!format.includes("{id}") && !format.includes("{title}")) issues.push("headings.format must contain {id} or {title}");
    const pageBreakBefore = h.pageBreakBefore === false ? false : this.depth(h.pageBreakBefore, "headings.pageBreakBefore", 2, issues);
    return { format, maxDepth: this.depth(h.maxDepth, "headings.maxDepth", 3, issues), pageBreakBefore };
  }

  private images(img: Obj, issues: string[]): ResolvedConfig["images"] {
    const maxBytes = img.maxBytes ?? DEFAULT_MAX_BYTES;
    if (typeof maxBytes !== "number" || maxBytes <= 0) issues.push("images.maxBytes must be a positive number");
    const formats: ImageFormat[] = img.allowedFormats ?? ["svg", "png", "jpeg"];
    if (!Array.isArray(formats) || formats.some((f) => !["svg", "png", "jpeg"].includes(f))) {
      issues.push('images.allowedFormats may only contain "svg", "png", "jpeg"');
    }
    const minRasterWidth = img.minRasterWidth ?? 400;
    if (typeof minRasterWidth !== "number" || minRasterWidth < 0) issues.push("images.minRasterWidth must be a number >= 0");
    return {
      maxBytes: typeof maxBytes === "number" ? maxBytes : DEFAULT_MAX_BYTES,
      allowedFormats: Array.isArray(formats) ? formats : ["svg", "png", "jpeg"],
      label: this.str(img.label, "images.label", "Figure", issues),
      minRasterWidth: typeof minRasterWidth === "number" ? minRasterWidth : 400,
    };
  }
}

/**
 * Pure entry point: validates and resolves an already-parsed config object (for example the result of
 * `JSON.parse` on `docengine.config.json`). No file, module or process access. Throws `ConfigError`.
 */
export function resolveConfig(input: unknown = {}): ResolvedConfig {
  return new DefaultConfigLoader().load(input as DocengineConfig);
}

/** Facade over `DefaultConfigLoader`; same as `resolveConfig`, kept for the existing public API. */
export function loadConfig(input: unknown = {}): ResolvedConfig {
  return resolveConfig(input);
}
