// SPDX-License-Identifier: MPL-2.0
import type { Diagnostic } from "@jackkoskie/docengine-core";
import type { Io } from "./services.js";

export type OptionValue = string | boolean | undefined;

/** A parsed command-line invocation handed to a command. */
export interface Invocation {
  /** Absolute project root. */
  cwd: string;
  config?: string;
  positionals: string[];
  values: Record<string, OptionValue>;
}

export interface OptionSpec {
  type: "string" | "boolean";
  description: string;
  short?: string;
}

/**
 * Base class for CLI commands. A new command is one subclass registered in the
 * `CommandRegistry`; nothing else changes.
 */
export abstract class Command {
  abstract readonly name: string;
  abstract readonly summary: string;
  /** Options this command adds to the global ones (`--cwd`, `--config`). */
  readonly options: Readonly<Record<string, OptionSpec>> = {};

  /** Returns the process exit code. */
  abstract run(invocation: Invocation): Promise<number>;
}

/** Renders one diagnostic as a line of output. */
export interface DiagnosticFormatter {
  readonly name: string;
  format(d: Diagnostic): string;
  /** Stream the lines go to: GitHub reads workflow commands from stdout. */
  readonly stream: "out" | "err";
}

export class TextDiagnosticFormatter implements DiagnosticFormatter {
  readonly name = "text";
  readonly stream = "err" as const;
  format(d: Diagnostic): string {
    return d.format();
  }
}

/** GitHub Actions workflow commands: `::error file=f,line=1,col=2::message`. */
export class GithubDiagnosticFormatter implements DiagnosticFormatter {
  readonly name = "github";
  readonly stream = "out" as const;

  format(d: Diagnostic): string {
    const level = d.severity === "info" ? "notice" : d.severity;
    const props = [
      ...(d.file ? [`file=${this.property(d.file)}`] : []),
      `line=${d.position.line}`,
      `col=${d.position.column}`,
    ];
    return `::${level} ${props.join(",")}::${this.data(d.message)}`;
  }

  private data(s: string): string {
    return s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  }

  private property(s: string): string {
    return this.data(s).replaceAll(":", "%3A").replaceAll(",", "%2C");
  }
}

/** Picks a formatter from `--format`. */
export function diagnosticFormatterFor(format: OptionValue): DiagnosticFormatter {
  if (format === undefined || format === "text") return new TextDiagnosticFormatter();
  if (format === "github") return new GithubDiagnosticFormatter();
  throw new Error(`Unknown --format "${String(format)}" (expected text or github)`);
}

/** Shared definition so every command that takes `--format` describes it the same way. */
export const FORMAT_OPTION: OptionSpec = {
  type: "string",
  description: "Output format. validate/check: text|github. diff: text|markdown|json",
};

export const BASE_OPTION: OptionSpec = {
  type: "string",
  description: "Git ref to compare against (branch, tag or SHA)",
};

/** Prints diagnostics ordered by file then position, through a formatter. */
export class DiagnosticPrinter {
  constructor(
    private readonly io: Io,
    private readonly formatter: DiagnosticFormatter = new TextDiagnosticFormatter(),
  ) {}

  print(diagnostics: readonly Diagnostic[]): void {
    const order = { error: 0, warning: 1, info: 2 } as const;
    const sorted = [...diagnostics].sort(
      (a, b) => (a.file ?? "").localeCompare(b.file ?? "") || a.position.line - b.position.line || order[a.severity] - order[b.severity],
    );
    const write = this.formatter.stream === "out" ? this.io.out : this.io.err;
    for (const d of sorted) write(this.formatter.format(d));
  }
}