// SPDX-License-Identifier: MPL-2.0
import type { WorkspaceIndex } from "../index/workspace-index.js";
import type { FileOpener, ProcessRunner, UserPrompt } from "../ports.js";

/** Builds a PDF for one document via the docengine CLI and opens it. */
export class PdfPreviewService {
  constructor(
    private readonly index: WorkspaceIndex,
    private readonly runner: ProcessRunner,
    private readonly opener: FileOpener,
    private readonly prompt: UserPrompt,
    private readonly root: string,
    private readonly cliCommand: () => string,
    private readonly outDir: () => string,
  ) {}

  /** The PDF path (relative to the root) the CLI writes for this document. */
  pdfPath(file: string): string | undefined {
    const doc = this.index.get(file)?.doc;
    if (!doc || !doc.group || !doc.short || !doc.version) return undefined;
    return `${this.previewDir()}/${doc.group}/${doc.short}-v${doc.version}.pdf`;
  }

  /** Previews go to `<outDir>/preview` so they never replace a full build's manifest.json. */
  private previewDir(): string {
    return `${this.outDir().replace(/[\\/]+$/, "")}/preview`;
  }

  async build(file: string): Promise<boolean> {
    const pdf = this.pdfPath(file);
    if (!pdf) {
      this.prompt.error("This document needs title, group, short and version in its frontmatter before it can be built.");
      return false;
    }
    const [command, ...baseArgs] = this.splitCommand(this.cliCommand());
    if (!command) {
      this.prompt.error("Set docengine.cli.command to run the docengine CLI.");
      return false;
    }
    const result = await this.runner.run(command, [...baseArgs, "build", file, "--out", this.previewDir(), "--cwd", this.root], this.root);
    if (result.status === null) {
      this.prompt.error(`Could not run "${this.cliCommand()}". Install docengine or set docengine.cli.command.`);
      return false;
    }
    if (result.status !== 0) {
      this.prompt.error(`docengine build failed:\n${(result.stderr || result.stdout).trim().split(/\r?\n/).slice(0, 8).join("\n")}`);
      return false;
    }
    if (/typst CLI not found/.test(result.stderr)) {
      this.prompt.error("The typst CLI is not installed, so no PDF was produced. Install Typst from https://typst.app/open-source/.");
      return false;
    }
    await this.opener.open(`${this.root.replace(/[\\/]+$/, "")}/${pdf}`);
    return true;
  }

  /** Splits `pnpm exec docengine` into its words (no quoting support beyond double quotes). */
  private splitCommand(text: string): string[] {
    return [...text.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
  }
}
