// SPDX-License-Identifier: MPL-2.0
import { dirname, join } from "node:path";
import {
  type ChangeSummary,
  type Document,
  type FileSystem,
  type Hasher,
  type Host,
  type ManifestEntry,
  type ResolvedConfig,
  Manifest,
  ManifestBuilder,
  TypstCompiler,
  TypstGenerator,
} from "@jackkoskie/docengine-core";
import { ChangeReporter } from "../change-report.js";
import { BASE_OPTION, Command, DiagnosticPrinter, type Invocation, type OptionSpec } from "../command.js";
import type { Io, Services } from "../services.js";
import { type LoadedDocument, type Project, Workspace, absolute, toPosix } from "../workspace.js";

/** Copies the letterhead template next to the output so Typst (rooted at the project) can import it. */
export class TemplateInstaller {
  constructor(private readonly fs: FileSystem) {}

  install(source: string, outDir: string): string {
    const dest = join(outDir, "_template", "letterhead.typ");
    this.fs.mkdirp(dirname(dest));
    this.fs.copyFile(source, dest);
    return dest;
  }

  /** The cover template goes next to the letterhead as `cover.typ`; the generated document imports it from there. */
  installCover(source: string, outDir: string): string {
    const dest = join(outDir, "_template", "cover.typ");
    this.fs.mkdirp(dirname(dest));
    this.fs.copyFile(source, dest);
    return dest;
  }
}

export interface DocumentBuildContext {
  project: Project;
  outDir: string;
  /** Output dir as the user gave it (used for manifest paths). */
  outLabel: string;
  templateDest: string;
  compiler: TypstCompiler | null;
  gitCommit: string | null;
  /** "Summary of changes" page content for this document, when enabled. */
  changeSummary?: ChangeSummary | null;
}

/** Generates the `.typ`, compiles the PDF and produces the manifest entry for one document. */
export class DocumentBuilder {
  constructor(
    private readonly fs: FileSystem,
    private readonly hasher: Hasher,
    private readonly host: Host,
    private readonly config: ResolvedConfig,
    private readonly io: Io,
  ) {}

  /** Returns the entry, or null when compilation failed. */
  build(loaded: LoadedDocument, ctx: DocumentBuildContext): ManifestEntry | null {
    const doc: Document = loaded.doc;
    const base = `${doc.short}-v${doc.version}`;
    const docDir = join(ctx.outDir, doc.group);
    this.fs.mkdirp(docDir);
    const typPath = join(docDir, `${base}.typ`);

    const generator = new TypstGenerator(this.config, {
      templateImport: this.rootRelative(ctx.project.root, ctx.templateDest),
      resolveAsset: (p) => "/" + toPosix(p).replace(/^\//, ""),
      ...(ctx.changeSummary ? { changeSummary: ctx.changeSummary } : {}),
    });
    this.fs.writeText(typPath, generator.generate(doc));

    const fileHashes: Record<string, string> = {};
    for (const source of doc.figureSources) {
      const info = this.host.inspectFile(source);
      if (info) fileHashes[source] = info.sha256;
    }

    let pdf: ManifestEntry["pdf"] = null;
    if (ctx.compiler) {
      const pdfPath = join(docDir, `${base}.pdf`);
      const fonts = this.config.fonts;
      const result = ctx.compiler.compile({
        root: ctx.project.root,
        input: typPath,
        output: pdfPath,
        fontPaths: fonts.paths.map((p) => absolute(ctx.project.root, p)),
        ignoreSystemFonts: fonts.ignoreSystemFonts,
      });
      if (!result.ok) {
        this.io.err(`${loaded.file}:1:1 error typst compile failed:
${result.error}`);
        return null;
      }
      pdf = {
        filename: `${base}.pdf`,
        path: toPosix(join(ctx.outLabel, doc.group, `${base}.pdf`)),
        sha256: this.hasher.sha256(this.fs.readBytes(pdfPath)),
      };
      this.io.out(`built ${pdf.path}`);
    } else {
      this.io.out(`wrote ${toPosix(typPath)}`);
    }
    return new ManifestBuilder(this.config).entry(doc, { pdf, fileHashes, gitCommit: ctx.gitCommit });
  }

  private rootRelative(root: string, abs: string): string {
    const r = toPosix(root).replace(/\/+$/, "") + "/";
    const a = toPosix(abs);
    return "/" + (a.startsWith(r) ? a.slice(r.length) : a);
  }
}

/**
 * `docengine build [files...] [--no-compile] [--out dir] [--typst path]`
 * With file arguments and no `--out`, output goes to `<outDir>/preview` so a full build's manifest is kept.
 */
export class BuildCommand extends Command {
  readonly name = "build";
  readonly summary = "Validate, generate Typst, compile PDFs, write manifest and upload sheet";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    out: { type: "string", description: "Output directory (default: config outDir; <outDir>/preview when files are named)" },
    "no-compile": { type: "boolean", description: "Write .typ files but skip PDF compilation" },
    typst: { type: "string", description: "Path to the typst executable" },
    base: BASE_OPTION,
    "only-changed": { type: "boolean", description: "build: only documents whose version changed (vs last tag, else --base)" },
    "base-only": { type: "boolean", description: "Compare only against --base, ignoring release tags" },
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, fs, hasher, git } = this.services;
    const ws = await Workspace.open(this.services, inv, { history: true });
    new DiagnosticPrinter(io).print(ws.diagnostics);
    if (ws.hasErrors || ws.documents.length === 0) {
      io.err("Build aborted: fix the errors above.");
      return 1;
    }
    const { project } = ws;
    // Building named files is a preview: it must not overwrite the full-repo manifest.json and upload sheet,
    // so without --out it writes to `<outDir>/preview` instead of `<outDir>`.
    const outLabel =
      typeof inv.values.out === "string"
        ? inv.values.out
        : inv.positionals.length > 0
          ? `${project.config.outDir.replace(/[\\/]+$/, "")}/preview`
          : project.config.outDir;
    const outDir = absolute(project.root, outLabel);
    fs.mkdirp(outDir);

    const templateSrc = project.config.branding.template
      ? absolute(project.root, project.config.branding.template)
      : this.services.defaultTemplate;
    if (!fs.exists(templateSrc)) {
      io.err(`Letterhead template not found: ${templateSrc}`);
      return 1;
    }
    const installer = new TemplateInstaller(fs);
    const templateDest = installer.install(templateSrc, outDir);
    // The cover template: the configured one, else the bundled default beside the default letterhead.
    const coverSrc = project.config.cover.template
      ? absolute(project.root, project.config.cover.template)
      : join(dirname(this.services.defaultTemplate), "default-cover.typ");
    if (project.config.cover.template && !fs.exists(coverSrc)) {
      io.err(`Cover template not found: ${coverSrc}`);
      return 1;
    }
    if (fs.exists(coverSrc)) installer.installCover(coverSrc, outDir);

    const logo = project.config.branding.logo;
    if (logo && !fs.exists(absolute(project.root, logo))) {
      io.err(`${project.configFile ?? "config"}:1:1 warning Logo file "${logo}" not found`);
    }

    const compiler = this.compiler(inv);
    const gitCommit = git.headCommit(project.root);
    const builder = new DocumentBuilder(fs, hasher, ws.host, project.config, io);
    const entries: ManifestEntry[] = [];
    let failed = false;

    // Changed-only marking: a document is changed when its version differs from the last release
    // tag (or the base ref). Drafts are still built; the upload sheet leaves them out.
    const onlyChanged = inv.values["only-changed"] === true;
    const trackChanges = onlyChanged || Workspace.baseRef(inv) !== null;
    const reporter = ws.history ? new ChangeReporter(ws.history, inv.values["base-only"] === true) : null;
    const changedByKey = new Map<string, boolean>();
    if (reporter && trackChanges) {
      for (const c of reporter.classify(ws.documents)) changedByKey.set(c.loaded.file, c.changed);
    }
    const toBuild = onlyChanged ? ws.documents.filter((d) => changedByKey.get(d.file) !== false) : ws.documents;
    if (onlyChanged) io.out(`${toBuild.length} changed document(s) to build, ${ws.documents.length - toBuild.length} unchanged skipped`);

    for (const loaded of toBuild) {
      const changeSummary = project.config.summaryOfChanges && reporter ? reporter.summary(loaded) : null;
      const entry = builder.build(loaded, { project, outDir, outLabel, templateDest, compiler, gitCommit, changeSummary });
      if (entry) entries.push(entry.withChanged(trackChanges ? (changedByKey.get(loaded.file) ?? null) : null));
      else failed = true;
    }

    const manifest = Manifest.create(entries, { gitCommit, engineVersion: this.services.engineVersion });
    fs.writeText(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    fs.writeText(join(outDir, "upload-sheet.md"), this.services.uploadSheet.build(manifest, { changedOnly: onlyChanged }));
    io.out(`wrote manifest.json and upload-sheet.md in ${toPosix(outDir)}`);
    io.out(ws.summary());
    return failed ? 1 : 0;
  }

  /** The compiler, or null when compilation is skipped or typst is not installed (with a message). */
  private compiler(inv: Invocation): TypstCompiler | null {
    if (inv.values["no-compile"] === true) return null;
    const bin = typeof inv.values.typst === "string" ? inv.values.typst : "typst";
    const compiler = new TypstCompiler(this.services.typstRunnerFor(bin));
    if (compiler.version()) return compiler;
    this.services.io.err(
      `typst CLI not found ("${bin}"); writing .typ files only and skipping PDF compilation. Install Typst from https://typst.app/open-source/ or pass --typst <path>.`,
    );
    return null;
  }
}
