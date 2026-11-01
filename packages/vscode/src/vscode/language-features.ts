// SPDX-License-Identifier: MPL-2.0
import * as vscode from "vscode";
import { TOKEN_MODIFIERS, TOKEN_TYPES } from "../providers/structure.js";
import { RenameError } from "../providers/rename.js";
import type { ProjectRegistry } from "./project-services.js";
import {
  fromDiagnostic,
  fromRange,
  toCompletionItem,
  toDocumentSymbol,
  toLocation,
  toRange,
  toWorkspaceEdit,
} from "./convert.js";

const SELECTOR: vscode.DocumentSelector = { language: "markdown", scheme: "file" };

/** Registers every language provider. Each one only looks up the owning project and delegates to an editor-neutral provider. */
export class LanguageFeatures {
  constructor(private readonly projects: ProjectRegistry) {}

  register(): vscode.Disposable[] {
    const legend = new vscode.SemanticTokensLegend([...TOKEN_TYPES], [...TOKEN_MODIFIERS]);
    const l = vscode.languages;
    return [
      l.registerCompletionItemProvider(SELECTOR, this.completion(), "[", ":", "#", "-", " ", "^"),
      l.registerHoverProvider(SELECTOR, this.hover()),
      l.registerDefinitionProvider(SELECTOR, this.definition()),
      l.registerReferenceProvider(SELECTOR, this.references()),
      l.registerRenameProvider(SELECTOR, this.rename()),
      l.registerDocumentSymbolProvider(SELECTOR, this.symbols()),
      l.registerFoldingRangeProvider(SELECTOR, this.folding()),
      l.registerDocumentSemanticTokensProvider(SELECTOR, this.semanticTokens(legend), legend),
      l.registerCodeActionsProvider(SELECTOR, this.codeActions(), {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
      }),
    ];
  }

  private completion(): vscode.CompletionItemProvider {
    return {
      provideCompletionItems: (doc, pos) => {
        const hit = this.projects.resolve(doc.uri);
        return hit?.services.completion.provide(hit.file, pos.line, pos.character).map(toCompletionItem);
      },
    };
  }

  private hover(): vscode.HoverProvider {
    return {
      provideHover: (doc, pos) => {
        const hit = this.projects.resolve(doc.uri);
        const result = hit?.services.hover.provide(hit.file, pos.line, pos.character);
        if (!result) return undefined;
        const md = new vscode.MarkdownString(result.markdown);
        md.isTrusted = false;
        md.supportHtml = false;
        return new vscode.Hover(md, toRange(result.range));
      },
    };
  }

  private definition(): vscode.DefinitionProvider {
    return {
      provideDefinition: (doc, pos) => {
        const hit = this.projects.resolve(doc.uri);
        return hit?.services.navigation.definition(hit.file, pos.line, pos.character).map((loc) => toLocation(hit.services.root, loc));
      },
    };
  }

  private references(): vscode.ReferenceProvider {
    return {
      provideReferences: (doc, pos, ctx) => {
        const hit = this.projects.resolve(doc.uri);
        return hit?.services.navigation
          .references(hit.file, pos.line, pos.character, ctx.includeDeclaration)
          .map((loc) => toLocation(hit.services.root, loc));
      },
    };
  }

  private rename(): vscode.RenameProvider {
    return {
      prepareRename: (doc, pos) => {
        const hit = this.projects.resolve(doc.uri);
        const prepared = hit?.services.rename.prepare(hit.file, pos.line, pos.character);
        if (!prepared) throw new Error("Place the cursor on a provision ID or figure key to rename it.");
        return { range: toRange(prepared.range), placeholder: prepared.placeholder };
      },
      provideRenameEdits: async (doc, pos, newName) => {
        const hit = this.projects.resolve(doc.uri);
        if (!hit) return undefined;
        try {
          const result = await hit.services.rename.rename(hit.file, pos.line, pos.character, newName);
          if (result.warning && !(await hit.services.prompt.confirm(result.warning, "Rename anyway"))) throw new Error("Rename cancelled.");
          return toWorkspaceEdit(hit.services.root, result.edits);
        } catch (e) {
          if (e instanceof RenameError) throw new Error(e.message);
          throw e;
        }
      },
    };
  }

  private symbols(): vscode.DocumentSymbolProvider {
    return {
      provideDocumentSymbols: (doc) => {
        const hit = this.projects.resolve(doc.uri);
        return hit?.services.outline.provide(hit.file).map(toDocumentSymbol);
      },
    };
  }

  private folding(): vscode.FoldingRangeProvider {
    return {
      provideFoldingRanges: (doc) => {
        const hit = this.projects.resolve(doc.uri);
        return hit?.services.folding
          .provide(hit.file)
          .map((f) => new vscode.FoldingRange(f.startLine, f.endLine, f.kind === "region" ? vscode.FoldingRangeKind.Region : undefined));
      },
    };
  }

  private semanticTokens(legend: vscode.SemanticTokensLegend): vscode.DocumentSemanticTokensProvider {
    return {
      provideDocumentSemanticTokens: (doc) => {
        const hit = this.projects.resolve(doc.uri);
        if (!hit) return undefined;
        const builder = new vscode.SemanticTokensBuilder(legend);
        for (const t of hit.services.semantic.provide(hit.file)) {
          builder.push(t.line, t.startChar, t.length, TOKEN_TYPES.indexOf(t.type as (typeof TOKEN_TYPES)[number]), t.modifiers.length ? 1 : 0);
        }
        return builder.build();
      },
    };
  }

  private codeActions(): vscode.CodeActionProvider {
    return {
      provideCodeActions: (doc, range, ctx) => {
        const hit = this.projects.resolve(doc.uri);
        if (!hit) return undefined;
        const diagnostics = ctx.diagnostics.filter((d) => d.source === "docengine").map(fromDiagnostic);
        return hit.services.codeActions.provide(hit.file, fromRange(range), diagnostics).map((a) => {
          const action = new vscode.CodeAction(a.title, a.kind === "quickfix" ? vscode.CodeActionKind.QuickFix : vscode.CodeActionKind.RefactorRewrite);
          action.edit = toWorkspaceEdit(hit.services.root, a.edits);
          action.isPreferred = a.preferred ?? false;
          if (a.fixes) action.diagnostics = ctx.diagnostics.filter((d) => d.code === a.fixes);
          return action;
        });
      },
    };
  }
}
