// SPDX-License-Identifier: MPL-2.0
import { ChangeDetector, ChangeSummary, type DocumentDiffEntry, type DocumentHistory, type HistoryProvider } from "@jackkoskie/docengine-core";
import type { LoadedDocument } from "./workspace.js";

export interface ChangedDocument {
  loaded: LoadedDocument;
  history: DocumentHistory;
  changed: boolean;
  previousVersion: string | null;
}

/** Turns a workspace's git history into change facts: which documents changed, and how. */
export class ChangeReporter {
  private readonly detector: ChangeDetector;

  constructor(
    private readonly history: HistoryProvider,
    baseOnly = false,
  ) {
    this.detector = new ChangeDetector(baseOnly);
  }

  /** Every document with its changed flag (version differs from the last tag / base). */
  classify(documents: readonly LoadedDocument[]): ChangedDocument[] {
    return documents.map((loaded) => {
      const history = this.history.of(loaded);
      return {
        loaded,
        history,
        changed: this.detector.isChanged(history, loaded.doc),
        previousVersion: this.detector.previousVersion(history),
      };
    });
  }

  /** The provision and figure diff of one document against its reference (base, else last tag). */
  entry(loaded: LoadedDocument): DocumentDiffEntry {
    const history = this.history.of(loaded);
    const ref = history.reference;
    const doc = loaded.doc;
    return {
      group: doc.group,
      short: doc.short,
      title: doc.title,
      file: loaded.file,
      draft: doc.isDraft,
      version: { from: ref?.doc.version ?? null, to: doc.version },
      against: ref?.ref ?? null,
      isNew: ref === null,
      diff: history.diffFromReference(),
    };
  }

  /** Entries for documents that differ from their reference in any way. */
  changedEntries(documents: readonly LoadedDocument[]): DocumentDiffEntry[] {
    return documents
      .map((d) => this.entry(d))
      .filter((e) => e.isNew || !e.diff.isEmpty || e.version.from !== e.version.to);
  }

  /** "Summary of changes" content for one document, or null when there is nothing to compare to. */
  summary(loaded: LoadedDocument): ChangeSummary | null {
    const history = this.history.of(loaded);
    const ref = history.previous;
    if (!ref) return null;
    const diff = history.diffFromReference();
    return ChangeSummary.from(history.reference === ref ? diff : this.diffAgainst(history), ref.doc.version);
  }

  private diffAgainst(history: DocumentHistory) {
    return history.diffFrom(history.previous!.ref!);
  }
}
