// SPDX-License-Identifier: MPL-2.0
import type { Position } from "@jackkoskie/docengine-core";

/**
 * Editor-neutral value types. Providers speak only these, so they can be tested without VS Code.
 * Lines and characters are 0-based, like the VS Code API. Files are workspace-relative, forward-slash paths.
 */
export interface Range {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface Loc {
  file: string;
  range: Range;
}

export interface TextEdit {
  file: string;
  range: Range;
  newText: string;
}

export type Severity = "error" | "warning" | "info";

export interface DiagnosticDto {
  range: Range;
  severity: Severity;
  code: string;
  message: string;
}

export const range = (startLine: number, startChar: number, endLine: number, endChar: number): Range => ({
  startLine,
  startChar,
  endLine,
  endChar,
});

/** Converts a core position (1-based line and column) to a single-line range. */
export function rangeOf(p: Position): Range {
  return range(p.line - 1, p.column - 1, p.line - 1, p.column - 1 + p.length);
}

/** A sub-range of a single-line position, by 0-based offset within the position's text. */
export function subRange(p: Position, offset: number, length: number): Range {
  return range(p.line - 1, p.column - 1 + offset, p.line - 1, p.column - 1 + offset + length);
}

export function contains(r: Range, line: number, char: number): boolean {
  if (line < r.startLine || line > r.endLine) return false;
  if (line === r.startLine && char < r.startChar) return false;
  if (line === r.endLine && char > r.endChar) return false;
  return true;
}

export function intersects(a: Range, b: Range): boolean {
  return contains(a, b.startLine, b.startChar) || contains(a, b.endLine, b.endChar) || contains(b, a.startLine, a.startChar);
}
