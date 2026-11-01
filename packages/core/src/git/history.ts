// SPDX-License-Identifier: MPL-2.0
import { CARS } from "../model/numbering/presets.js";
import type { NumberingScheme } from "../model/numbering/scheme.js";
import type { Document } from "../model/document.js";
import type { Parser } from "../parser/parser.js";
import type { GitClient, Hasher, Host } from "../ports.js";
import { DocumentDiff } from "./diff.js";
import { ReleaseTags, type ReleaseTag } from "./release-tags.js";
import { DocumentSnapshot, SnapshotLoader } from "./snapshot.js";
import { DocVersion } from "./version.js";

/** What git knows about one document: its last release tag and earlier snapshots. */
export interface DocumentHistory {
  readonly file: string;
  /** The `--base` ref, or null when none was given. */
  readonly baseRef: string | null;
  readonly lastTag: ReleaseTag | null;
  /** Document at the base ref; null when no base ref was given or the document is new there. */
  readonly base: DocumentSnapshot | null;
  /** Document at the last release tag. */
  readonly tagged: DocumentSnapshot | null;
  readonly current: DocumentSnapshot;
  /** The snapshot that content changes are measured against: base when given, else the last tag. */
  readonly reference: DocumentSnapshot | null;
  /** The previous published state: the last tag, else the base. Used for removed-ID checks. */
  readonly previous: DocumentSnapshot | null;
  /** A base ref was given and the document does not exist there. */
  readonly isNewAtBase: boolean;
  /** Diff of the current document against `reference` (everything added when there is none). */
  diffFromReference(): DocumentDiff;
  /** Diff against an arbitrary ref (e.g. a release tag); everything added when absent there. */
  diffFrom(ref: string): DocumentDiff;
}

export interface HistoryProvider {
  readonly baseRef: string | null;
  of(entry: { file: string; doc: Document }): DocumentHistory;
}

class GitDocumentHistory implements DocumentHistory {
  readonly current: DocumentSnapshot;
  readonly lastTag: ReleaseTag | null;
  readonly base: DocumentSnapshot | null;
  readonly tagged: DocumentSnapshot | null;
  readonly isNewAtBase: boolean;
  private diff: DocumentDiff | undefined;

  constructor(
    readonly file: string,
    doc: Document,
    readonly baseRef: string | null,
    private readonly cwd: string,
    private readonly loader: SnapshotLoader,
    tags: ReleaseTags,
    host: Host,
  ) {
    this.current = new DocumentSnapshot(doc, null, (p) => host.inspectFile(p)?.sha256);
    this.lastTag = doc.group && doc.short ? tags.latest(cwd, doc.group, doc.short) : null;
    this.base = baseRef ? loader.at(cwd, baseRef, file) : null;
    this.isNewAtBase = baseRef !== null && this.base === null;
    this.tagged = this.lastTag ? loader.at(cwd, this.lastTag.name, file) : null;
  }

  get reference(): DocumentSnapshot | null {
    return this.baseRef ? this.base : this.tagged;
  }

  get previous(): DocumentSnapshot | null {
    return this.tagged ?? this.base;
  }

  diffFromReference(): DocumentDiff {
    return (this.diff ??= DocumentDiff.compare(this.reference, this.current));
  }

  diffFrom(ref: string): DocumentDiff {
    return DocumentDiff.compare(this.loader.at(this.cwd, ref, this.file), this.current);
  }
}

/** `HistoryProvider` over a `GitClient`. Results are cached per file. */
export class GitHistoryProvider implements HistoryProvider {
  private readonly cache = new Map<string, DocumentHistory>();
  private readonly loader: SnapshotLoader;
  private readonly tags: ReleaseTags;

  constructor(
    git: GitClient,
    parser: Parser,
    hasher: Hasher,
    private readonly host: Host,
    private readonly cwd: string,
    readonly baseRef: string | null = null,
    scheme: NumberingScheme = CARS,
  ) {
    this.loader = new SnapshotLoader(git, parser, hasher, scheme);
    this.tags = new ReleaseTags(git);
  }

  of(entry: { file: string; doc: Document }): DocumentHistory {
    let h = this.cache.get(entry.file);
    if (!h) {
      h = new GitDocumentHistory(entry.file, entry.doc, this.baseRef, this.cwd, this.loader, this.tags, this.host);
      this.cache.set(entry.file, h);
    }
    return h;
  }
}

/**
 * Decides whether a document counts as changed: its `version` differs from the last release tag,
 * or (without a tag, or in base-only mode) from the version at the base ref. A document with no
 * tag and no base is new, so it counts as changed.
 */
export class ChangeDetector {
  constructor(private readonly baseOnly = false) {}

  isChanged(history: DocumentHistory, doc: Document): boolean {
    if (!this.baseOnly && history.lastTag) {
      const v = DocVersion.parse(doc.version);
      return v === null || v.compare(history.lastTag.version) !== 0;
    }
    if (history.baseRef) return history.base === null || history.base.doc.version !== doc.version;
    return true;
  }

  /** The version this document is compared against, for reporting. */
  previousVersion(history: DocumentHistory): string | null {
    if (!this.baseOnly && history.lastTag) return history.lastTag.version.text;
    return history.base?.doc.version ?? null;
  }
}
