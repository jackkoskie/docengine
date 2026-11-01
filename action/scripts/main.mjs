#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// Composition root for the docengine CI action. Usage: node main.mjs <command>
// Commands: resolve-base, check, preview-build, preview-publish, preview-cleanup, preview-prune, release
import { DocengineCli } from "./lib/cli.mjs";
import {
  CheckCommand,
  PreviewBuildCommand,
  PreviewCleanupCommand,
  PreviewPruneCommand,
  PreviewPublishCommand,
  ReleaseCommand,
  ResolveBaseCommand,
} from "./lib/commands.mjs";
import { CommentRenderer, StickyComment } from "./lib/comment.mjs";
import { DiagnosticParser } from "./lib/diagnostics.mjs";
import { ManifestFile } from "./lib/documents.mjs";
import { NodeFiles } from "./lib/files.mjs";
import { ActionOutputs, GitHubClient } from "./lib/github.mjs";
import { PreviewBranch } from "./lib/previews.mjs";
import { ReleasePublisher, TagIndex } from "./lib/releases.mjs";
import { PreviewBuilder, PreviewReportReader } from "./lib/report.mjs";
import { CommandLine, NodeCommandRunner } from "./lib/runner.mjs";
import { Settings } from "./lib/settings.mjs";

class Container {
  constructor(env) {
    this.settings = new Settings(env);
    this.env = env;
    this.runner = new NodeCommandRunner();
    this.files = new NodeFiles();
    this.outputs = new ActionOutputs(env.GITHUB_OUTPUT);
  }

  get cli() {
    const s = this.settings;
    return new DocengineCli({ runner: this.runner, commandLine: CommandLine.parse(s.commandLine), cwd: s.cwd });
  }

  get github() {
    return new GitHubClient({ token: this.settings.token, repository: this.settings.repository });
  }

  get branch() {
    const s = this.settings;
    return new PreviewBranch({ runner: this.runner, files: this.files, remoteUrl: s.remoteUrl, branch: s.previewsBranch });
  }

  get renderer() {
    const s = this.settings;
    return new CommentRenderer({ repository: s.repository, branch: s.previewsBranch, runUrl: s.runUrl });
  }

  get sticky() {
    return new StickyComment(this.github);
  }

  resolveBase() {
    return new ResolveBaseCommand({ runner: this.runner, outputs: this.outputs, cwd: this.settings.cwd });
  }

  check() {
    return new CheckCommand({ cli: this.cli, outputs: this.outputs });
  }

  previewBuild() {
    const s = this.settings;
    const builder = new PreviewBuilder({
      cli: this.cli,
      files: this.files,
      manifest: new ManifestFile(this.files, `${s.outDir}/manifest.json`),
      diagnostics: new DiagnosticParser(),
      clock: { now: () => new Date() },
    });
    return new PreviewBuildCommand({ builder, outputs: this.outputs });
  }

  previewPublish() {
    return new PreviewPublishCommand({
      github: this.github,
      reader: new PreviewReportReader(this.files),
      branch: this.branch,
      sticky: this.sticky,
      renderer: this.renderer,
    });
  }

  previewCleanup() {
    return new PreviewCleanupCommand({ branch: this.branch, sticky: this.sticky, renderer: this.renderer });
  }

  previewPrune() {
    return new PreviewPruneCommand({ github: this.github, branch: this.branch });
  }

  release() {
    const s = this.settings;
    const cli = this.cli;
    const tags = new TagIndex(this.runner, s.cwd);
    const publisher = new ReleasePublisher({ runner: this.runner, files: this.files, tags, cli, github: this.github });
    return new ReleaseCommand({ cli, tags, publisher, files: this.files, runner: this.runner, outputs: this.outputs });
  }
}

async function main(argv, env) {
  const [command] = argv;
  const c = new Container(env);
  const s = c.settings;
  switch (command) {
    case "resolve-base":
      await c.resolveBase().run({
        explicit: s.base,
        eventName: env.GITHUB_EVENT_NAME ?? "",
        prBaseSha: env.PR_BASE_SHA ?? "",
        pushBefore: env.EVENT_BEFORE ?? "",
      });
      return 0;
    case "check":
      return c.check().run(s.base);
    case "preview-build":
      return c.previewBuild().run({
        base: s.base,
        prNumber: Number(env.PR_NUMBER) || 0,
        headSha: env.HEAD_SHA ?? "",
        outDir: s.outDir,
        reportDir: s.reportDir,
      });
    case "preview-publish": {
      const outcome = await c.previewPublish().run({
        artifactDir: s.require("ARTIFACT_DIR"),
        runHeadSha: s.require("RUN_HEAD_SHA"),
        runConclusion: env.RUN_CONCLUSION ?? "",
        prHint: env.PR_HINT ?? "",
        runUrl: s.runUrl,
      });
      console.log(`preview-publish: ${outcome}`);
      return 0;
    }
    case "preview-cleanup":
      await c.previewCleanup().run(Number(s.require("PR_NUMBER")));
      return 0;
    case "preview-prune":
      await c.previewPrune().run();
      return 0;
    case "release":
      await c.release().run({ base: s.base, outDir: s.outDir, cwd: s.cwd, sha: s.sha });
      return 0;
    default:
      console.error(`Unknown command: ${command ?? "(none)"}`);
      return 2;
  }
}

main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  },
);
