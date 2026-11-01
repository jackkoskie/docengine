// SPDX-License-Identifier: MPL-2.0
import { ProvisionId } from "../model/provision-id.js";
import type { DocumentDiff } from "./diff.js";

/** Plain-text lines for the optional "Summary of changes" page appended to a PDF. */
export class ChangeSummary {
  private constructor(
    /** The version being compared against, when known. */
    readonly fromVersion: string | null,
    readonly items: readonly string[],
  ) {}

  static from(diff: DocumentDiff, fromVersion: string | null): ChangeSummary {
    const d = diff.toJSON();
    const shown = (id: string): string => ProvisionId.parse(id, diff.scheme).display;
    const tail = (t: string) => (t ? `: ${t}` : "");
    const items = [
      ...d.provisions.added.map((c) => `Added ${shown(c.id)}${tail(c.excerpt)}`),
      ...d.provisions.changed.map((c) => `Changed ${shown(c.id)}${tail(c.excerpt)}`),
      ...d.provisions.repealed.map((c) => `Repealed ${shown(c.id)}${tail(c.excerpt.replace(/^\[repealed\]\s*/, ""))}`),
      ...d.provisions.removed.map((c) => `Removed ${shown(c.id)}${tail(c.excerpt)}`),
      ...d.provisions.moved.map((m) => `Moved ${shown(m.from)} to ${m.to}`),
      ...d.figures.added.map((f) => `Added figure ${f.key ?? f.path}: ${f.caption}`),
      ...d.figures.changed.map((f) => `Changed figure ${f.key ?? f.path}: ${f.caption}`),
      ...d.figures.removed.map((f) => `Removed figure ${f.key ?? f.path}`),
    ];
    return new ChangeSummary(fromVersion, items);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }
}
