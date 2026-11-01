// SPDX-License-Identifier: MPL-2.0
import { MarkdownParser, type NumberingScheme, type Parser } from "@jackkoskie/docengine-core";
import { IndexedDocument } from "./indexed-document.js";

/** Index of every document in the workspace: file -> parsed document. The source for cross-document lookups. */
export class WorkspaceIndex {
  private readonly docs = new Map<string, IndexedDocument>();

  constructor(private readonly parser: Parser = new MarkdownParser()) {}

  update(file: string, text: string, scheme?: NumberingScheme): IndexedDocument {
    const indexed = new IndexedDocument(file, text, this.parser.parse(text, { file, ...(scheme ? { scheme } : {}) }));
    this.docs.set(file, indexed);
    return indexed;
  }

  remove(file: string): boolean {
    return this.docs.delete(file);
  }

  has(file: string): boolean {
    return this.docs.has(file);
  }

  get(file: string): IndexedDocument | undefined {
    return this.docs.get(file);
  }

  all(): IndexedDocument[] {
    return [...this.docs.values()];
  }

  files(): string[] {
    return [...this.docs.keys()];
  }

  /**
   * Resolves a document name used in a reference (`short` or `group/short`) relative to the referring
   * document. With no name, the referring document itself.
   */
  resolve(from: IndexedDocument, name?: string): IndexedDocument | undefined {
    if (name === undefined) return from;
    const matches = this.all().filter((d) => d.doc.matchesName(name));
    return matches.find((d) => d.doc.group === from.doc.group) ?? matches[0];
  }

  /** The shortest unambiguous name for a document in references: `short`, or `group/short` when shared. */
  nameFor(target: IndexedDocument): string {
    const short = target.doc.short;
    const shared = this.all().filter((d) => d.doc.short === short).length > 1;
    return shared ? `${target.doc.group}/${short}` : short;
  }
}
