// SPDX-License-Identifier: MPL-2.0
export interface ScaffoldOptions {
  group: string;
  short: string;
  title?: string;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
  /** Value of the `yaml-language-server` `$schema` modeline (URL or path relative to the file). */
  schema: string;
  /** Extension field names from the config, written as commented placeholders. */
  extensionKeys?: readonly string[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Builds the text of a new document: full frontmatter, schema modeline and a skeleton. */
export class DocumentScaffold {
  /** Problems with the group or short slug; empty when both are valid. */
  static validate(group: string, short: string): string[] {
    const problems: string[] = [];
    if (!SLUG.test(group)) problems.push(`group "${group}" must be lower-case letters, digits and hyphens`);
    if (!SLUG.test(short)) problems.push(`short "${short}" must be lower-case letters, digits and hyphens`);
    return problems;
  }

  static titleFromShort(short: string): string {
    return short
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  create(o: ScaffoldOptions): string {
    const title = o.title ?? DocumentScaffold.titleFromShort(o.short);
    const quote = (s: string) => JSON.stringify(s);
    const lines = [
      "---",
      `# yaml-language-server: $schema=${o.schema}`,
      `title: ${quote(title)}`,
      `short: ${o.short}`,
      `group: ${o.group}`,
      `version: "1.0"`,
      `effectiveDate: ${o.effectiveDate}`,
      `# expiryDate: YYYY-MM-DD`,
      `description: ""`,
      `# draft: true            # built for review, never released`,
      `# version-note: editorial # skip the version-bump check for editorial-only changes`,
      ...(o.extensionKeys ?? []).map((k) => `# ${k}:`),
      "---",
      "",
      "[100.01] # Section title",
      "",
      "[100.01(1)] First subsection.",
      "",
    ];
    return lines.join("\n");
  }
}
