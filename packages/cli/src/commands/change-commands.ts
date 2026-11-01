// SPDX-License-Identifier: MPL-2.0
import {
  JsonDiffRenderer,
  MarkdownDiffRenderer,
  ReleaseNotesBuilder,
  ReleaseTags,
  TextDiffRenderer,
  type DiffRenderer,
} from "@jackkoskie/docengine-core";
import { ChangeReporter } from "../change-report.js";
import { BASE_OPTION, Command, FORMAT_OPTION, type Invocation, type OptionSpec } from "../command.js";
import type { Services } from "../services.js";
import { Workspace } from "../workspace.js";

/** Chooses the renderer for `diff --format`. */
export function diffRendererFor(format: string | boolean | undefined): DiffRenderer {
  switch (format ?? "text") {
    case "text":
      return new TextDiffRenderer();
    case "markdown":
      return new MarkdownDiffRenderer();
    case "json":
      return new JsonDiffRenderer();
    default:
      throw new Error(`Unknown --format "${String(format)}" (expected text, markdown or json)`);
  }
}

/** `docengine diff --base <ref> [--format text|markdown|json] [paths...]` */
export class DiffCommand extends Command {
  readonly name = "diff";
  readonly summary = "Provision-level and figure diff of changed documents against a base ref";
  override readonly options: Readonly<Record<string, OptionSpec>> = { base: BASE_OPTION, format: FORMAT_OPTION };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const renderer = diffRendererFor(inv.values.format);
    const ws = await Workspace.open(this.services, inv, { history: true });
    const reporter = new ChangeReporter(ws.history!);
    const documents = reporter.changedEntries(ws.documents);
    this.services.io.out(renderer.render({ base: Workspace.baseRef(inv), documents }).replace(/\n+$/, ""));
    return 0;
  }
}

/** `docengine changed --base <ref> [--json] [--base-only] [--include-drafts] [paths...]` */
export class ChangedCommand extends Command {
  readonly name = "changed";
  readonly summary = "List documents whose version changed against the last release tag (or the base ref)";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    base: BASE_OPTION,
    json: { type: "boolean", description: "changed: print JSON" },
    "base-only": { type: "boolean", description: "Compare only against --base, ignoring release tags" },
    "include-drafts": { type: "boolean", description: "changed: also list documents with draft: true" },
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const ws = await Workspace.open(this.services, inv, { history: true });
    const reporter = new ChangeReporter(ws.history!, inv.values["base-only"] === true);
    const includeDrafts = inv.values["include-drafts"] === true;
    const changed = reporter
      .classify(ws.documents)
      .filter((c) => c.changed && (includeDrafts || !c.loaded.doc.isDraft))
      .map((c) => {
        const doc = c.loaded.doc;
        return {
          key: doc.repositoryKey,
          group: doc.group,
          short: doc.short,
          title: doc.title,
          file: c.loaded.file,
          version: doc.version,
          previousVersion: c.previousVersion,
          effectiveDate: doc.effectiveDate,
          tag: ReleaseTags.tagName(doc.group, doc.short, doc.version),
          draft: doc.isDraft,
        };
      });
    if (inv.values.json === true) {
      this.services.io.out(JSON.stringify(changed, null, 2));
    } else if (changed.length === 0) {
      this.services.io.out("No changed documents.");
    } else {
      for (const c of changed) {
        this.services.io.out(`${c.key} v${c.version}${c.previousVersion ? ` (was v${c.previousVersion})` : " (new)"}${c.draft ? " [draft]" : ""}`);
      }
    }
    return 0;
  }
}

/** `docengine release-notes <group>/<short> [--base <tag>]` */
export class ReleaseNotesCommand extends Command {
  readonly name = "release-notes";
  readonly summary = "Markdown release notes for one document: provision diff since a tag, plus a PR link placeholder";
  override readonly options: Readonly<Record<string, OptionSpec>> = { base: BASE_OPTION };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const [name] = inv.positionals;
    if (!name) {
      this.services.io.err("Usage: docengine release-notes <group>/<short> [--base <tag>]");
      return 2;
    }
    const ws = await Workspace.open(this.services, { ...inv, positionals: [] }, { history: true });
    const loaded = ws.documents.find((d) => d.doc.matchesName(name));
    if (!loaded) {
      this.services.io.err(`Document "${name}" not found`);
      return 1;
    }
    const entry = new ChangeReporter(ws.history!).entry(loaded);
    this.services.io.out(new ReleaseNotesBuilder().render(entry).replace(/\n+$/, ""));
    return 0;
  }
}
