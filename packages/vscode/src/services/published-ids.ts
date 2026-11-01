// SPDX-License-Identifier: MPL-2.0
import { CARS, MarkdownParser, type NumberingScheme, type Parser } from "@jackkoskie/docengine-core";
import type { ProcessRunner } from "../ports.js";
import type { PublishedIds } from "../providers/rename.js";

/**
 * Reads the provision IDs of the last published version of a document from git: the newest tag named
 * `<group>/<short>/v<version>` (the release tag scheme), parsed with core's parser.
 */
export class GitPublishedIds implements PublishedIds {
  private readonly cache = new Map<string, { ids: ReadonlySet<string>; version: string } | undefined>();

  constructor(
    private readonly runner: ProcessRunner,
    private readonly root: string,
    private readonly parser: Parser = new MarkdownParser(),
    private readonly numbering: () => NumberingScheme = () => CARS,
  ) {}

  async idsFor(file: string, doc: { group: string; short: string }) {
    if (!doc.group || !doc.short) return undefined;
    const tag = await this.latestTag(doc);
    if (!tag) return undefined;
    const key = `${tag}:${file}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const shown = await this.runner.run("git", ["show", `${tag}:./${file}`], this.root);
    const result =
      shown.status === 0
        ? {
            ids: new Set(this.parser.parse(shown.stdout, { scheme: this.numbering() }).provisions.filter((c) => !c.id.isBlank).map((c) => c.id.text)),
            version: tag.slice(tag.lastIndexOf("/v") + 2),
          }
        : undefined;
    this.cache.set(key, result);
    return result;
  }

  private async latestTag(doc: { group: string; short: string }): Promise<string | undefined> {
    const listed = await this.runner.run("git", ["tag", "--list", `${doc.group}/${doc.short}/v*`, "--sort=-v:refname"], this.root);
    if (listed.status !== 0) return undefined;
    return listed.stdout.split(/\r?\n/).find((l) => l.trim() !== "")?.trim();
  }
}
