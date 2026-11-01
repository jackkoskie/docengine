// SPDX-License-Identifier: MPL-2.0
/** 1-based line and column, length in UTF-16 code units. */
export interface Position {
  line: number;
  column: number;
  length: number;
}

export type Severity = "error" | "warning" | "info";

/** Immutable problem report tied to a source position. */
export class Diagnostic {
  constructor(
    readonly severity: Severity,
    readonly code: string,
    readonly message: string,
    readonly position: Position,
    readonly file?: string,
  ) {
    Object.freeze(this);
  }

  static error(code: string, message: string, position: Position, file?: string): Diagnostic {
    return new Diagnostic("error", code, message, position, file);
  }

  static warning(code: string, message: string, position: Position, file?: string): Diagnostic {
    return new Diagnostic("warning", code, message, position, file);
  }

  get isError(): boolean {
    return this.severity === "error";
  }

  withFile(file: string): Diagnostic {
    return new Diagnostic(this.severity, this.code, this.message, this.position, file);
  }

  /** `file:line:col severity message` */
  format(fallbackFile = "<input>"): string {
    return `${this.file ?? fallbackFile}:${this.position.line}:${this.position.column} ${this.severity} ${this.message}`;
  }

  toJSON() {
    return { severity: this.severity, code: this.code, message: this.message, position: this.position, file: this.file };
  }
}

/** Accumulates diagnostics for one file; shared by the parser and validation rules. */
export class DiagnosticCollector {
  private readonly list: Diagnostic[] = [];

  constructor(readonly file?: string) {}

  error(code: string, message: string, position: Position): void {
    this.list.push(Diagnostic.error(code, message, position, this.file));
  }

  warning(code: string, message: string, position: Position): void {
    this.list.push(Diagnostic.warning(code, message, position, this.file));
  }

  add(d: Diagnostic): void {
    this.list.push(d);
  }

  get items(): Diagnostic[] {
    return [...this.list];
  }
}

export function formatDiagnostic(d: Diagnostic, fallbackFile = "<input>"): string {
  return d.format(fallbackFile);
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.isError);
}
