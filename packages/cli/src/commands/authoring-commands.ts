// SPDX-License-Identifier: MPL-2.0
import { join } from "node:path";
import { DocumentScaffold, Formatter, Renumberer, VersionBumper, type BumpKind } from "@jackkoskie/docengine-core";
import { BASE_OPTION, Command, type Invocation, type OptionSpec } from "../command.js";
import type { Services } from "../services.js";
import { ProjectLoader, Workspace, documentsRoot, findDocument, resolveDocumentArg, toPosix } from "../workspace.js";
import { BuildCommand } from "./build-command.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `docengine fmt [paths...] [--check] [--tombstones] [--base ref] [--indent n]` */
export class FormatCommand extends Command {
  readonly name = "fmt";
  readonly summary = "Fill blank [] provision IDs from indentation, normalize figure attributes, restore tombstones (never renumbers)";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    check: { type: "boolean", description: "fmt: report what would change and exit 1, without writing" },
    tombstones: { type: "boolean", description: "fmt: restore [repealed] tombstones for IDs removed since the last release tag (or --base)" },
    indent: { type: "string", description: "fmt: columns per nesting level for blank [] provisions (default: auto)" },
    base: BASE_OPTION,
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, fs } = this.services;
    const ws = await Workspace.open(this.services, inv, { history: inv.values.tombstones === true });
    const indent = typeof inv.values.indent === "string" ? Number(inv.values.indent) : undefined;
    if (indent !== undefined && !(indent >= 1)) {
      io.err("--indent must be a positive number");
      return 2;
    }
    const check = inv.values.check === true;
    const formatter = new Formatter();
    let touched = 0;
    let problems = 0;

    for (const loaded of ws.documents) {
      const source = fs.readText(loaded.abs);
      const previous = inv.values.tombstones === true ? ws.history?.of(loaded).previous : null;
      const result = formatter.format(source, {
        scheme: loaded.doc.scheme,
        ...(indent !== undefined ? { indentWidth: indent } : {}),
        ...(previous ? { restoreTombstones: previous.doc.provisions.filter((c) => !c.id.isBlank).map((c) => c.id.text) } : {}),
      });
      for (const c of result.changes) io.out(`${loaded.file}:${c.line} ${c.message}`);
      for (const p of result.problems) {
        io.err(`${loaded.file}:${p.line}:1 error ${p.message}`);
        problems++;
      }
      if (result.text !== source) {
        touched++;
        if (!check) fs.writeText(loaded.abs, result.text);
      }
    }
    io.out(check ? `${touched} file(s) need formatting` : `${touched} file(s) formatted`);
    return problems > 0 || (check && touched > 0) ? 1 : 0;
  }
}

/** `docengine renumber <doc> <from> <to> [<from> <to> ...] [--tombstone] [--dry-run]` */
export class RenumberCommand extends Command {
  readonly name = "renumber";
  readonly summary = "Explicitly renumber provisions (and descendants) and update every [[ref]] repo-wide, logging each change";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    tombstone: { type: "boolean", description: "renumber: leave a [repealed] tombstone at each old ID" },
    "dry-run": { type: "boolean", description: "renumber: log the changes without writing" },
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, fs } = this.services;
    const [name, ...pairs] = inv.positionals;
    if (!name || pairs.length === 0 || pairs.length % 2 !== 0) {
      io.err("Usage: docengine renumber <group>/<short> <from> <to> [<from> <to> ...] [--tombstone] [--dry-run]");
      return 2;
    }
    const ws = await Workspace.open(this.services, { ...inv, positionals: [] });
    const target = findDocument(ws.documents, name);
    if (!target) {
      io.err(`Document "${name}" not found`);
      return 1;
    }
    const mappings = [];
    for (let i = 0; i < pairs.length; i += 2) mappings.push({ from: pairs[i]!.replace(/^\[|\]$/g, ""), to: pairs[i + 1]!.replace(/^\[|\]$/g, "") });

    const plan = new Renumberer().plan(
      ws.documents.map((d) => ({ file: d.file, source: fs.readText(d.abs), doc: d.doc })),
      target.file,
      mappings,
      { tombstone: inv.values.tombstone === true },
    );
    if (plan.problems.length) {
      for (const p of plan.problems) io.err(`error ${p}`);
      return 1;
    }
    const dry = inv.values["dry-run"] === true;
    for (const c of plan.changes) {
      const what = c.kind === "provision" ? "provision" : c.kind === "tombstone" ? "tombstone" : "reference";
      io.out(`${c.file}:${c.line} ${what} [${c.from}] -> [${c.to}]`);
    }
    if (!dry) {
      for (const e of plan.edits) fs.writeText(join(ws.project.root, e.file), e.text);
    }
    io.out(`${plan.changes.length} change(s) in ${plan.edits.length} file(s)${dry ? " (dry run, nothing written)" : ""}`);
    if (!dry) io.out("Published IDs changed: run `docengine check --base <ref>` and record the renumbering in the release notes.");
    return 0;
  }
}

/** `docengine new <group> <short> [--title t] [--schema path-or-url]` */
export class NewCommand extends Command {
  readonly name = "new";
  readonly summary = "Scaffold a new document with full frontmatter, the schema modeline and a skeleton";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    title: { type: "string", description: "new: document title (default: derived from short)" },
    schema: { type: "string", description: "new: $schema value for the yaml-language-server modeline" },
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, fs, clock } = this.services;
    const [group, short] = inv.positionals;
    if (!group || !short || inv.positionals.length !== 2) {
      io.err("Usage: docengine new <group> <short> [--title <title>]");
      return 2;
    }
    const problems = DocumentScaffold.validate(group, short);
    if (problems.length) {
      for (const p of problems) io.err(`error ${p}`);
      return 2;
    }
    const project = await new ProjectLoader(this.services).load(inv.cwd, inv.config);
    const root = documentsRoot(project.config);
    const rel = `${root === "." ? "" : `${root}/`}${group}/${short}.md`;
    const abs = join(project.root, rel);
    if (fs.exists(abs)) {
      io.err(`error ${rel} already exists`);
      return 1;
    }
    const depth = rel.split("/").length - 1;
    const schema = typeof inv.values.schema === "string" ? inv.values.schema : `${"../".repeat(depth)}schema/frontmatter.schema.json`;
    const text = new DocumentScaffold().create({
      group,
      short,
      ...(typeof inv.values.title === "string" ? { title: inv.values.title } : {}),
      effectiveDate: clock.today(),
      schema,
      extensionKeys: Object.keys(project.config.extensions).map((k) => k.replace(/\?$/, "")),
    });
    fs.mkdirp(join(project.root, root, group));
    fs.writeText(abs, text);
    io.out(`created ${rel}`);
    if (typeof inv.values.schema !== "string" && !fs.exists(join(project.root, "schema", "frontmatter.schema.json"))) {
      io.out("hint: run `docengine schema --out schema/frontmatter.schema.json` so the modeline gives frontmatter autocomplete");
    }
    return 0;
  }
}

/** `docengine bump <doc> major|minor [--date YYYY-MM-DD]` */
export class BumpCommand extends Command {
  readonly name = "bump";
  readonly summary = "Bump a document's version (major|minor) and set effectiveDate";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    date: { type: "string", description: "bump: effectiveDate to set (default: today)" },
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, fs, clock } = this.services;
    const [name, kind] = inv.positionals;
    if (!name || (kind !== "major" && kind !== "minor")) {
      io.err("Usage: docengine bump <group>/<short> major|minor [--date YYYY-MM-DD]");
      return 2;
    }
    const date = typeof inv.values.date === "string" ? inv.values.date : clock.today();
    if (!DATE.test(date)) {
      io.err(`error --date "${date}" must be YYYY-MM-DD`);
      return 2;
    }
    const ws = await Workspace.open(this.services, { ...inv, positionals: [] });
    const loaded = findDocument(ws.documents, name);
    if (!loaded) {
      io.err(`Document "${name}" not found`);
      return 1;
    }
    const result = new VersionBumper().bump(fs.readText(loaded.abs), loaded.doc, kind as BumpKind, date);
    fs.writeText(loaded.abs, result.text);
    io.out(`${loaded.doc.repositoryKey}: version ${result.from} -> ${result.to}, effectiveDate ${result.effectiveDate}`);
    return 0;
  }
}

/** `docengine watch [doc...]`: rebuild when files change. Takes the same options as `build`. */
export class WatchCommand extends Command {
  readonly name = "watch";
  readonly summary = "Rebuild on change (same options as build)";

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, watcher } = this.services;
    const project = await new ProjectLoader(this.services).load(inv.cwd, inv.config);
    const positionals = inv.positionals.map((p) => resolveDocumentArg(project.config, p));
    const build = new BuildCommand(this.services);
    const outLabel = typeof inv.values.out === "string" ? inv.values.out : project.config.outDir;
    // Watching keeps writing to the output dir (not build's named-file preview dir).
    const buildInv: Invocation = { ...inv, positionals, values: { ...inv.values, out: outLabel } };

    const paths = [join(project.root, documentsRoot(project.config))];
    if (project.configFile) paths.push(project.configFile);

    let running = false;
    let queued = false;
    const rebuild = async (reason: string): Promise<void> => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        do {
          queued = false;
          io.out(`[watch] ${reason}: rebuilding`);
          try {
            const code = await build.run(buildInv);
            io.out(code === 0 ? "[watch] build ok" : "[watch] build failed; waiting for changes");
          } catch (e) {
            io.err(`error: ${(e as Error).message}`);
          }
        } while (queued);
      } finally {
        running = false;
      }
    };

    await rebuild("initial build");
    const session = watcher.watch(
      { paths, ignore: [join(project.root, outLabel)] },
      (file) => void rebuild(toPosix(file).replace(`${toPosix(project.root)}/`, "")),
    );
    io.out("[watch] watching for changes (Ctrl+C to stop)");
    await session.closed;
    return 0;
  }
}
