// SPDX-License-Identifier: MPL-2.0
import { join } from "node:path";
import * as vscode from "vscode";
import type { CompletionItemDto } from "../providers/completion.js";
import type { OutlineNode } from "../providers/structure.js";
import type { DiagnosticDto, Loc, Range, TextEdit } from "../types.js";

export const toRange = (r: Range): vscode.Range => new vscode.Range(r.startLine, r.startChar, r.endLine, r.endChar);

export const fromRange = (r: vscode.Range): Range => ({
  startLine: r.start.line,
  startChar: r.start.character,
  endLine: r.end.line,
  endChar: r.end.character,
});

export function toDiagnostic(d: DiagnosticDto): vscode.Diagnostic {
  const severity =
    d.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : d.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
  const diagnostic = new vscode.Diagnostic(toRange(d.range), d.message, severity);
  diagnostic.code = d.code;
  diagnostic.source = "docengine";
  return diagnostic;
}

export function fromDiagnostic(d: vscode.Diagnostic): DiagnosticDto {
  const severity = d.severity === vscode.DiagnosticSeverity.Error ? "error" : d.severity === vscode.DiagnosticSeverity.Warning ? "warning" : "info";
  const code = typeof d.code === "object" ? String(d.code.value) : String(d.code ?? "");
  return { range: fromRange(d.range), severity, code, message: d.message };
}

export const toLocation = (root: string, loc: Loc): vscode.Location =>
  new vscode.Location(vscode.Uri.file(join(root, loc.file)), toRange(loc.range));

export function toWorkspaceEdit(root: string, edits: readonly TextEdit[]): vscode.WorkspaceEdit {
  const we = new vscode.WorkspaceEdit();
  for (const e of edits) {
    const uri = vscode.Uri.file(join(root, e.file));
    if (e.range.startLine === e.range.endLine && e.range.startChar === e.range.endChar) we.insert(uri, new vscode.Position(e.range.startLine, e.range.startChar), e.newText);
    else we.replace(uri, toRange(e.range), e.newText);
  }
  return we;
}

const COMPLETION_KINDS: Record<CompletionItemDto["kind"], vscode.CompletionItemKind> = {
  provision: vscode.CompletionItemKind.Reference,
  figure: vscode.CompletionItemKind.File,
  document: vscode.CompletionItemKind.Module,
  field: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.Value,
  footnote: vscode.CompletionItemKind.Constant,
};

export function toCompletionItem(d: CompletionItemDto): vscode.CompletionItem {
  const item = new vscode.CompletionItem(d.label, COMPLETION_KINDS[d.kind]);
  item.detail = d.detail;
  if (d.documentation) item.documentation = new vscode.MarkdownString(d.documentation);
  item.insertText = d.insertText;
  item.range = toRange(d.replace);
  if (d.filterText) item.filterText = d.filterText;
  if (d.sortText) item.sortText = d.sortText;
  if (d.retrigger) item.command = { command: "editor.action.triggerSuggest", title: "Suggest" };
  return item;
}

export function toDocumentSymbol(n: OutlineNode): vscode.DocumentSymbol {
  const kinds = [
    vscode.SymbolKind.Package,
    vscode.SymbolKind.Namespace,
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Field,
    vscode.SymbolKind.Variable,
  ];
  const kind = n.kind === "figure" ? vscode.SymbolKind.File : n.kind === "footnote" ? vscode.SymbolKind.Constant : kinds[Math.min(Math.max(n.depth, 1), 8) - 1]!;
  const symbol = new vscode.DocumentSymbol(n.name, n.detail, kind, toRange(n.range), toRange(n.selectionRange));
  symbol.children = n.children.map(toDocumentSymbol);
  return symbol;
}
