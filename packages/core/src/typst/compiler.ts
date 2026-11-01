// SPDX-License-Identifier: MPL-2.0
import type { TypstRunner } from "../ports.js";

export interface CompileRequest {
  /** Typst project root (`--root`). */
  root: string;
  input: string;
  output: string;
  /** Absolute directories searched for font files (`--font-path`, one per entry). */
  fontPaths?: readonly string[];
  /** Ignore fonts installed on the machine (`--ignore-system-fonts`). */
  ignoreSystemFonts?: boolean;
}

export interface CompileResult {
  ok: boolean;
  /** Compiler diagnostics when `ok` is false. */
  error?: string;
}

/** Drives the Typst CLI through an injected `TypstRunner`. */
export class TypstCompiler {
  constructor(private readonly runner: TypstRunner) {}

  /** Typst's version string, or null when it is not installed. */
  version(): string | null {
    const r = this.runner.run(["--version"]);
    return r.status === 0 ? r.stdout.trim() : null;
  }

  /** The `typst compile` argument list for a request (font options come before the positional paths). */
  static compileArgs(req: CompileRequest): string[] {
    const args = ["compile", "--root", req.root];
    for (const p of req.fontPaths ?? []) args.push("--font-path", p);
    if (req.ignoreSystemFonts) args.push("--ignore-system-fonts");
    args.push(req.input, req.output);
    return args;
  }

  compile(req: CompileRequest): CompileResult {
    const r = this.runner.run(TypstCompiler.compileArgs(req));
    return r.status === 0 ? { ok: true } : { ok: false, error: r.stderr || `typst exited with status ${r.status}` };
  }
}
