// SPDX-License-Identifier: MPL-2.0
import type { Rule, RuleContext } from "../rule.js";

/** Captions/alt text, keys: present, unique, referenced. */
export class FigureDeclarationRule implements Rule {
  readonly name = "figure-declaration";

  check({ doc, report }: RuleContext): void {
    const keys = new Set<string>();
    const referenced = doc.referencedFigureKeys;
    for (const f of doc.figures) {
      if (!f.hasCaption) report.error("missing-alt-text", "Figure needs a caption (it is also the alt text)", f.position);
      if (!f.key) {
        report.warning("figure-without-key", "Figure has no key and cannot be referenced; add {#fig:your-key}", f.position);
        continue;
      }
      if (keys.has(f.key)) report.error("duplicate-figure-key", `Duplicate figure key "${f.key}"`, f.keyPosition ?? f.position);
      keys.add(f.key);
      if (!referenced.has(f.key)) {
        report.warning("unreferenced-figure", `Figure "${f.key}" is never referenced; use [[fig:${f.key}]]`, f.keyPosition ?? f.position);
      }
    }
  }
}

/** Image files exist, use an allowed format, stay under the size limit and resolution floor. */
export class FigureFileRule implements Rule {
  readonly name = "figure-files";

  check({ doc, config, host, file, report }: RuleContext): void {
    const { images } = config;
    for (const f of doc.figures) {
      const format = f.format;
      if (!format || !images.allowedFormats.includes(format)) {
        report.error("unsupported-image-format", `Image "${f.path}" must be one of: ${images.allowedFormats.join(", ")}`, f.pathPosition);
        continue;
      }
      if (!host) continue;
      const info = host.inspectFile(f.sourcePath(file ?? doc.file));
      if (!info) {
        report.error("image-not-found", `Image file "${f.path}" not found`, f.pathPosition);
        continue;
      }
      if (info.size > images.maxBytes) {
        report.error("image-too-large", `Image "${f.path}" is ${info.size} bytes; the limit is ${images.maxBytes}`, f.pathPosition);
      }
      if (format !== "svg" && info.width !== undefined && info.width < images.minRasterWidth) {
        report.warning("low-resolution-image", `Image "${f.path}" is only ${info.width}px wide (minimum ${images.minRasterWidth}px)`, f.pathPosition);
      }
    }
  }
}
