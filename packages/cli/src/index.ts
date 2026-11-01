// SPDX-License-Identifier: MPL-2.0
// The `docengine` package re-exports the core API so config files can `import { defineConfig } from "@jackkoskie/docengine"`.
export * from "@jackkoskie/docengine-core";
export { main, createDefaultRegistry } from "./main.js";
export {
  Command,
  DiagnosticPrinter,
  TextDiagnosticFormatter,
  GithubDiagnosticFormatter,
  diagnosticFormatterFor,
  type DiagnosticFormatter,
  type Invocation,
  type OptionSpec,
} from "./command.js";
export { CommandRegistry, CommandRunner } from "./registry.js";
export { ValidateCommand, CheckCommand } from "./commands/validate-command.js";
export { FormatCommand, RenumberCommand, NewCommand, BumpCommand, WatchCommand } from "./commands/authoring-commands.js";
export { DiffCommand, ChangedCommand, ReleaseNotesCommand, diffRendererFor } from "./commands/change-commands.js";
export { ChangeReporter, type ChangedDocument } from "./change-report.js";
export { BuildCommand, DocumentBuilder, TemplateInstaller } from "./commands/build-command.js";
export { SchemaCommand } from "./commands/schema-command.js";
export { Workspace, ProjectLoader, DocumentRepository, type Project, type LoadedDocument } from "./workspace.js";
export { createNodeServices, SystemClock, FsFileWatcher, NodeFileSystem, NodeGitClient, NodeHasher, ProcessTypstRunner, JitiModuleImporter } from "./node/adapters.js";
export type { Io, Services, ModuleImporter, FileWatcher, WatchOptions, WatchSession } from "./services.js";
