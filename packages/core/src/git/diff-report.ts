// SPDX-License-Identifier: MPL-2.0
import type { NumberingScheme } from "../model/numbering/scheme.js";
import { CARS } from "../model/numbering/presets.js";
import { ProvisionId } from "../model/provision-id.js";
import type { DocumentDiff, DocumentDiffDto } from "./diff.js";

/** One document's change set, with enough identity to report on it. */
export interface DocumentDiffEntry {
  group: string;
  short: string;
  title: string;
  file: string;
  draft: boolean;
  /** Version at the comparison point (null for a new document) and now. */
  version: { from: string | null; to: string };
  /** Ref the document was compared against (null for a new document). */
  against: string | null;
  isNew: boolean;
  diff: DocumentDiff;
}

export interface DiffReport {
  /** The `--base` ref or tag, when given. */
  base: string | null;
  documents: readonly DocumentDiffEntry[];
}

export interface DiffRenderer {
  render(report: DiffReport): string;
}

/** `Section 602.60`, `Paragraph 1.1(a)`. */
const shown = (id: string, scheme: NumberingScheme = CARS): string => ProvisionId.parse(id, scheme).display;
const short = (h: string | null) => (h ? h.slice(0, 12) : "none");
const key = (e: DocumentDiffEntry) => `${e.group}/${e.short}`;
const versionText = (e: DocumentDiffEntry) => (e.version.from === null ? `new, v${e.version.to}` : e.version.from === e.version.to ? `v${e.version.to}` : `v${e.version.from} -> v${e.version.to}`);

/** Plain-text diff for terminals. */
export class TextDiffRenderer implements DiffRenderer {
  render(report: DiffReport): string {
    if (report.documents.length === 0) return "No document changes.\n";
    const out: string[] = [];
    for (const e of report.documents) {
      const d = e.diff.toJSON();
      out.push(`${key(e)} (${versionText(e)})${e.draft ? " [draft]" : ""}`);
      const scheme = e.diff.scheme;
      for (const c of d.provisions.added) out.push(`  + ${shown(c.id, scheme)} ${c.excerpt}`.trimEnd());
      for (const c of d.provisions.changed) out.push(`  ~ ${shown(c.id, scheme)} ${c.excerpt}`.trimEnd());
      for (const c of d.provisions.repealed) out.push(`  x ${shown(c.id, scheme)} repealed ${c.excerpt.replace(/^\[repealed\]\s*/, "")}`.trimEnd());
      for (const c of d.provisions.removed) out.push(`  - ${shown(c.id, scheme)} ${c.excerpt}`.trimEnd());
      for (const m of d.provisions.moved) out.push(`  > ${shown(m.from, scheme)} -> ${m.to} ${m.excerpt}`.trimEnd());
      for (const f of d.figures.added) out.push(`  + figure ${f.key ?? f.path} (${short(f.after)})`);
      for (const f of d.figures.changed) out.push(`  ~ figure ${f.key ?? f.path} ${f.reason ?? ""} (${short(f.before)} -> ${short(f.after)})`);
      for (const f of d.figures.removed) out.push(`  - figure ${f.key ?? f.path} (${short(f.before)})`);
      for (const f of d.figures.renumbered) out.push(`  > figure ${f.key} number ${f.from} -> ${f.to}`);
      out.push("");
    }
    return out.join("\n");
  }
}

/** GitHub-flavoured Markdown, for PR comments. */
export class MarkdownDiffRenderer implements DiffRenderer {
  render(report: DiffReport): string {
    if (report.documents.length === 0) return "No document changes.\n";
    const out: string[] = [];
    for (const e of report.documents) out.push(...this.entry(e, "##"), "");
    return out.join("\n");
  }

  /** One document's section; reused by the release-notes builder. */
  entry(e: DocumentDiffEntry, heading: string): string[] {
    const d = e.diff.toJSON();
    const out = [`${heading} ${e.title} (\`${key(e)}\`, ${versionText(e)})${e.draft ? " *draft*" : ""}`, ""];
    if (e.diff.isEmpty) return [...out, "No provision or figure changes.", ""];
    const provisions = this.provisions(d, e.diff.scheme);
    if (provisions.length) out.push("**Provisions**", "", ...provisions, "");
    const figures = this.figures(d);
    if (figures.length) out.push("**Figures**", "", ...figures, "");
    return out;
  }

  private provisions(d: DocumentDiffDto, scheme: NumberingScheme): string[] {
    const line = (label: string, id: string, text: string) => `- ${label} ${shown(id, scheme)}${text ? ` ${text}` : ""}`;
    return [
      ...d.provisions.added.map((c) => line("Added", c.id, c.excerpt)),
      ...d.provisions.changed.map((c) => line("Changed", c.id, c.excerpt)),
      ...d.provisions.repealed.map((c) => line("Repealed", c.id, c.excerpt.replace(/^\[repealed\]\s*/, ""))),
      ...d.provisions.removed.map((c) => line("Removed", c.id, c.excerpt)),
      ...d.provisions.moved.map((m) => `- Moved ${shown(m.from, scheme)} to \`[${m.to}]\`${m.excerpt ? ` ${m.excerpt}` : ""}`),
    ];
  }

  private figures(d: DocumentDiffDto): string[] {
    const name = (f: { key: string | null; path: string }) => `\`${f.key ?? f.path}\``;
    return [
      ...d.figures.added.map((f) => `- Added figure ${name(f)}: ${f.caption} (\`${short(f.after)}\`)`),
      ...d.figures.changed.map(
        (f) => `- Changed figure ${name(f)}${f.reason ? ` (${f.reason})` : ""}: \`${short(f.before)}\` -> \`${short(f.after)}\``,
      ),
      ...d.figures.removed.map((f) => `- Removed figure ${name(f)}: ${f.caption} (\`${short(f.before)}\`)`),
      ...d.figures.renumbered.map((f) => `- Figure \`${f.key}\` renumbered ${f.from} -> ${f.to}`),
    ];
  }
}

/** Stable JSON for tools. */
export class JsonDiffRenderer implements DiffRenderer {
  render(report: DiffReport): string {
    const dto = {
      base: report.base,
      documents: report.documents.map((e) => ({
        group: e.group,
        short: e.short,
        key: key(e),
        title: e.title,
        file: e.file,
        draft: e.draft,
        isNew: e.isNew,
        against: e.against,
        version: e.version,
        ...e.diff.toJSON(),
      })),
    };
    return JSON.stringify(dto, null, 2);
  }
}

/** Markdown release notes for one document: provision diff plus a placeholder for the PR link. */
export class ReleaseNotesBuilder {
  static readonly PR_PLACEHOLDER = "{{PR_URL}}";

  render(e: DocumentDiffEntry): string {
    const md = new MarkdownDiffRenderer();
    const out = [`# ${e.title} v${e.version.to}`, ""];
    out.push(e.isNew ? "Initial release." : `Changes since ${e.against ?? `v${e.version.from}`}.`, "");
    out.push(...md.entry({ ...e }, "##").slice(2));
    out.push(`Pull request: ${ReleaseNotesBuilder.PR_PLACEHOLDER}`, "");
    return out.join("\n");
  }
}
