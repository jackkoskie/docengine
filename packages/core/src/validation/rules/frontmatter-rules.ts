// SPDX-License-Identifier: MPL-2.0
import { FrontmatterSchema } from "../../schema.js";
import type { Rule, RuleContext } from "../rule.js";

/** Frontmatter matches the base schema plus configured extensions; flags unknown keys. */
export class FrontmatterSchemaRule implements Rule {
  readonly name = "frontmatter-schema";
  private readonly cache = new WeakMap<object, FrontmatterSchema>();

  check({ doc, config, report }: RuleContext): void {
    if (!doc.frontmatterStart) return; // already reported by the parser
    let schema = this.cache.get(config.extensions);
    if (!schema) {
      schema = new FrontmatterSchema(config.extensions);
      this.cache.set(config.extensions, schema);
    }

    for (const problem of schema.check(doc.frontmatter)) {
      const key = problem.key;
      let message = problem.message;
      if (key === "version" && typeof doc.frontmatter.version === "number") {
        message += ' (quote the value in YAML, for example version: "1.0")';
      }
      const where = key ? doc.frontmatterPosition(key, key in doc.frontmatter ? "value" : "key") : doc.frontmatterStart;
      report.error("frontmatter-schema", `Frontmatter: ${message}`, where);
    }

    for (const key of Object.keys(doc.frontmatter)) {
      if (!schema.knownKeys.has(key)) {
        report.warning("unknown-frontmatter-key", `Unknown frontmatter key "${key}"`, doc.frontmatterPosition(key, "key"));
      }
    }
  }
}

/** `subtitle` and `notice` only appear on the cover page; flag them when the cover is off. */
export class CoverFieldsRule implements Rule {
  readonly name = "cover-fields";
  check({ doc, config, report }: RuleContext): void {
    if (!doc.frontmatterStart || (doc.coverFlag ?? config.cover.enabled)) return;
    for (const key of ["subtitle", "notice"]) {
      if (key in doc.frontmatter) {
        report.warning("cover-field-ignored", `"${key}" is only shown on the cover page; set "cover: true" (or cover.enabled in the config) to use it`, doc.frontmatterPosition(key, "key"));
      }
    }
  }
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

/** Dates are real calendar dates and expiry is after effective. */
export class FrontmatterDateRule implements Rule {
  readonly name = "frontmatter-dates";

  check({ doc, report }: RuleContext): void {
    if (!doc.frontmatterStart) return;
    const eff = doc.frontmatter.effectiveDate;
    const exp = doc.frontmatter.expiryDate;
    const shaped = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const effOk = shaped(eff) && isRealDate(eff);
    const expOk = shaped(exp) && isRealDate(exp);
    if (shaped(eff) && !effOk) report.error("invalid-date", `effectiveDate "${eff}" is not a real calendar date`, doc.frontmatterPosition("effectiveDate"));
    if (shaped(exp) && !expOk) report.error("invalid-date", `expiryDate "${exp}" is not a real calendar date`, doc.frontmatterPosition("expiryDate"));
    if (effOk && expOk && (exp as string) <= (eff as string)) {
      report.error("expiry-before-effective", `expiryDate ${exp} must be after effectiveDate ${eff}`, doc.frontmatterPosition("expiryDate"));
    }
  }
}
