// SPDX-License-Identifier: MPL-2.0
import {
  BASE_OPTION,
  Command,
  DiagnosticPrinter,
  FORMAT_OPTION,
  diagnosticFormatterFor,
  type Invocation,
  type OptionSpec,
} from "../command.js";
import type { Services } from "../services.js";
import { Workspace, type WorkspaceOptions } from "../workspace.js";

/** Shared flow of `validate` and `check`: open the workspace, print diagnostics, set the exit code. */
abstract class DiagnosticsCommand extends Command {
  protected abstract readonly workspaceOptions: WorkspaceOptions;

  constructor(protected readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const formatter = diagnosticFormatterFor(inv.values.format);
    const ws = await Workspace.open(this.services, inv, this.workspaceOptions);
    new DiagnosticPrinter(this.services.io, formatter).print(ws.diagnostics);
    this.services.io.out(ws.summary());
    return ws.hasErrors || ws.documents.length === 0 ? 1 : 0;
  }
}

/** `docengine validate [paths...] [--format text|github]` */
export class ValidateCommand extends DiagnosticsCommand {
  readonly name = "validate";
  readonly summary = "Parse and validate documents (exit code 1 on errors)";
  override readonly options: Readonly<Record<string, OptionSpec>> = { format: FORMAT_OPTION };
  protected readonly workspaceOptions: WorkspaceOptions = {};
}

/** `docengine check [paths...] [--base ref] [--format text|github]`: validate plus the git-aware rules. */
export class CheckCommand extends DiagnosticsCommand {
  readonly name = "check";
  readonly summary = "validate plus git-aware rules (version bump, removed IDs, version after last tag)";
  override readonly options: Readonly<Record<string, OptionSpec>> = { format: FORMAT_OPTION, base: BASE_OPTION };
  protected readonly workspaceOptions: WorkspaceOptions = { history: true, gitRules: true };
}
