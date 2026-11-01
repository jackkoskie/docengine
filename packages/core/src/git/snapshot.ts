// SPDX-License-Identifier: MPL-2.0
import { CARS } from "../model/numbering/presets.js";
import type { NumberingScheme } from "../model/numbering/scheme.js";
import type { Provision } from "../model/provision.js";
import type { Document } from "../model/document.js";
import type { Figure } from "../model/figure.js";
import type { Hasher, GitClient } from "../ports.js";
import type { Parser } from "../parser/parser.js";

declare class TextDecoder {
  decode(b: Uint8Array): string;
}

/** A document as it was at some point in time, plus the hashes of its figure files then. */
export class DocumentSnapshot {
  constructor(
    readonly doc: Document,
    /** The ref it was read from, or null for the working tree. */
    readonly ref: string | null,
    private readonly hashOf: (repoPath: string) => string | undefined,
  ) {}

  figureHash(figure: Figure): string | null {
    return this.hashOf(figure.sourcePath(this.doc.file)) ?? null;
  }
}

/** Reads documents (and their figure hashes) at a git ref through the `GitClient` port. */
export class SnapshotLoader {
  constructor(
    private readonly git: GitClient,
    private readonly parser: Parser,
    private readonly hasher: Hasher,
    private readonly scheme: NumberingScheme = CARS,
  ) {}

  /** The document at `file` in `ref`, or null when it did not exist there. */
  at(cwd: string, ref: string, file: string): DocumentSnapshot | null {
    const bytes = this.git.readFileAt(cwd, ref, file);
    if (!bytes) return null;
    const doc = this.parser.parse(new TextDecoder().decode(bytes), { file, scheme: this.scheme });
    const cache = new Map<string, string | undefined>();
    return new DocumentSnapshot(doc, ref, (path) => {
      if (!cache.has(path)) {
        const img = this.git.readFileAt(cwd, ref, path);
        cache.set(path, img ? this.hasher.sha256(img) : undefined);
      }
      return cache.get(path);
    });
  }
}

/**
 * Canonical text of a provision's content, ignoring line numbers and whitespace layout.
 * Two provisions with equal content text are the same provision for diffing and move detection.
 */
export class ProvisionContent {
  static of(provision: Provision, figureHash: (f: Figure) => string | null = () => null): string {
    const blocks = provision.blocks.map((b) => {
      switch (b.type) {
        case "figure":
          return {
            t: "figure",
            key: b.figure.key ?? null,
            caption: b.figure.caption,
            path: b.figure.path,
            width: b.figure.width ?? null,
            align: b.figure.align ?? null,
            placement: b.figure.placement ?? null,
            hash: figureHash(b.figure),
          };
        case "paragraph":
          return { t: "p", text: b.text };
        case "list":
          return { t: "l", ordered: b.ordered, items: b.items };
        case "table":
          return { t: "table", header: b.header, rows: b.rows, align: b.align };
        case "code":
          return { t: "code", lang: b.lang, text: b.text };
      }
    });
    return JSON.stringify({ title: provision.title ?? null, repealed: provision.repealed, note: provision.repealNote ?? null, blocks });
  }

  /** A short plain-text excerpt for human-readable diffs. */
  static excerpt(provision: Provision, max = 100): string {
    const first = provision.title ?? provision.repealNote ?? "";
    let text = first;
    if (!text) {
      for (const b of provision.blocks) {
        if (b.type === "paragraph") text = b.text;
        else if (b.type === "list") text = b.items.join("; ");
        else if (b.type === "figure") text = `Figure: ${b.figure.caption}`;
        if (text) break;
      }
    }
    if (provision.repealed) text = `[repealed] ${text}`.trim();
    text = text.replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
}
