# docengine for VS Code and Cursor

In-process editor support for docengine policy documents. It reuses `@jackkoskie/docengine-core` (parser, `Validator`, schema, reference resolution), so the editor reports exactly what `docengine validate` reports. There is no separate language server (see "LSP" below).

## Activation

The extension activates in workspaces that contain `docengine.config.*` or `documents/**/*.md`. It works on Markdown files that match the document glob (the `documents` setting of `docengine.config.json`, else `documents/**/*.md`; override with `docengine.documents`).

## Features

| Feature | Details |
| --- | --- |
| Diagnostics | Same validator and rules as the CLI, with line, column and length. Runs on open, on change (debounced 150 ms, `docengine.validation.debounceMs`) and on save. The whole workspace is indexed, so cross-document `[[other-doc#100.2]]` references, `unique short` and path checks are all validated. File watchers keep the index current for edits made outside the editor. |
| Completion | After `[[`: provision IDs (provision text as detail), `fig:` keys and `other-doc#` targets; after `other-doc#`: that document's provisions and figures; after `fig:`: figure keys; after `[^`: footnote ids defined in the document (and the next unused id). Typing `[` at the start of a line offers the next unused ID at the right depth (next sibling, first child, next sibling of each ancestor, next Section, including the section after the last declared Subpart). In frontmatter: missing keys (base keys plus the config's extension keys) and values for `group`, `short`, `effectiveDate`, `expiryDate`, `version`, `draft`, `version-note`. |
| Hover | On `[[602.60(1)(a)]]`: the provision text and its level (for example **Paragraph 602.60(1)(a)**). On `[[fig:key]]`: caption and a thumbnail. Cross-document references also show the target document's title and version. On a `[^id]` footnote reference: the footnote text. |
| Navigation | Go to definition and find all references for provision IDs and figure keys, across documents. Footnotes: go from `[^id]` to its definition and find all references (within the document). |
| Rename (F2) | Renames a provision ID, its nested provisions and every `[[reference]]` repo-wide (including `[[doc#id]]`). Renaming a figure key updates `{#fig:key}` and all `[[fig:key]]`. The new ID must be at the same level (a Subsection stays a Subsection). If the ID exists in the last published version (the newest `<group>/<short>/v*` git tag), a modal warning asks for confirmation. |
| Outline and folding | A Part / Subpart / Section / Subsection tree (figures sit under their provision) for the outline and breadcrumbs, and one folding range per provision, covering nested provisions. The frontmatter folds too. Titles (`[602.60] # Title`) are used as outline names, and footnote definitions are listed as `[^id]` entries. |
| Semantic highlighting | Provision IDs are colored by level (Part, Subpart, Section, Subsection, Paragraph, Subparagraph, Clause, Subclause), and figure keys have their own token. Token types: `docenginePart`, `docengineSubpart`, `docengineSection`, `docengineSubsection`, `docengineParagraph`, `docengineSubparagraph`, `docengineClause`, `docengineSubclause`, `docengineFigure`. Override colors in `editor.semanticTokenColorCustomizations`. |
| Code actions | **Insert missing parent**, **Renumber out-of-sequence sibling** (renumbers nested provisions and references too), and **Convert "Section 602.60(1)" to a `[[602.60(1)]]` reference** (rewrite action, only when the provision exists). |
| Snippets | `de-frontmatter`, `de-part`, `de-subpart`, `de-section`, `de-subsection`, `de-paragraph`, `de-subparagraph`, `de-clause`, `de-subclause`, `de-provision`, `de-repealed`, `de-ref`, `de-xref`, `de-figure`, `de-figref`, `de-title`, `de-footnote`, `de-footnote-def`, `de-underline`, `de-highlight`, `de-keep`. |

## Commands

- `docengine: Build PDF preview`: saves the active document, runs `<docengine.cli.command> build <file> --out <outDir>/preview --cwd <root>` (so a full build's manifest is not overwritten) and opens the resulting `<outDir>/preview/<group>/<short>-v<version>.pdf` in the system viewer. Needs the `docengine` CLI (set `docengine.cli.command`, for example `pnpm exec docengine`) and the `typst` CLI for PDF output.
- `docengine: Validate workspace`: re-validates everything and reports the totals.
- `docengine: Insert frontmatter schema modeline`: adds `# yaml-language-server: $schema=...` inside the frontmatter, pointing at `schema/frontmatter.schema.json` in the workspace when it exists, else the copy bundled with the extension. The modeline is picked up by YAML-aware tooling; it does not affect the Markdown body.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `docengine.cli.command` | `docengine` | Command used for PDF previews. May include arguments (`pnpm exec docengine`). |
| `docengine.validation.debounceMs` | `150` | Delay after the last edit before re-validating. |
| `docengine.documents` | empty | Document glob override. |

## Config support

`docengine.config.json` is parsed with `JSON.parse` and resolved through core's pure `resolveConfig(object)` (no file loading in core, so it runs inside the extension host). `docengine.config.ts`, `.mts`, `.js` and `.mjs` files are not executed by the extension (running them means executing arbitrary project code inside the editor process, which the extension deliberately does not do; the CLI's Node adapter loads them), so the extension falls back to default settings and hides "unknown frontmatter key" findings, because it cannot know the FIR's extension fields. Keep a JSON config next to it, or run `docengine validate` for the authoritative result.

## Architecture

All feature logic is editor-neutral and tested without VS Code. Providers take a `WorkspaceIndex` and plain data (0-based ranges, workspace-relative paths) and return DTOs. Only `src/vscode/` imports `vscode`.

```
src/
  types.ts, ports.ts        DTOs and the thin interfaces the VS Code glue implements
  index/                    WorkspaceIndex (file -> parsed Document), IndexedDocument, SymbolLocator, UsageFinder
  providers/                CompletionProvider, HoverProvider, NavigationProvider, RenamePlanner/RenameService,
                            OutlineProvider, FoldingProvider, SemanticTokensProvider, CodeActionProvider
  services/                 Project (index sync + debounced validation), DiagnosticsService, Debouncer, GlobMatcher,
                            ProjectConfigLoader, CachingAssetHost, GitPublishedIds, PdfPreviewService, SchemaModeline
  vscode/                   ports-impl.ts (VS Code and Node implementations), convert.ts, language-features.ts,
                            commands.ts, project-services.ts (per-folder composition root)
  extension.ts              activate/deactivate and event wiring
```

Ports (`TextSource`, `FileLister`, `DiagnosticSink`, `AssetReader`, `AssetUriResolver`, `ProcessRunner`, `Scheduler`, `UserPrompt`, `FileOpener`, `ConfigFiles`) are injected through constructors, so tests use small fakes.

## Develop, debug, package

```
pnpm install
pnpm --filter docengine-vscode build        # esbuild bundle to packages/vscode/dist/extension.cjs
pnpm --filter docengine-vscode typecheck
pnpm test                                   # from the repo root (vitest)
```

Debug: open `packages/vscode` in VS Code or Cursor, run `pnpm --filter docengine-vscode build -- --watch` (or `node scripts/build.mjs --watch` from `packages/vscode`), then launch an Extension Development Host from the repository root (`code --extensionDevelopmentPath=packages/vscode fixtures/sample-repo`).

Package a `.vsix`:

```
pnpm --filter docengine-vscode package      # writes packages/vscode/dist/docengine.vsix
```

The workspace package is named `docengine-vscode` (the extension id is `<publisher>.docengine-vscode`), so use that name with `--filter` (or `pnpm --filter ./packages/vscode package`). This builds the bundle and packages it using the workspace's `@vscode/vsce` dependency. Before publishing, replace the `publisher` placeholder (`your-publisher-id`) in `package.json` with a Marketplace publisher ID you control.

The bundle inlines `@jackkoskie/docengine-core` from `packages/core/src`, so core does not need to be built first.

Install locally: `code --install-extension packages/vscode/dist/docengine.vsix` (or "Extensions: Install from VSIX..." in Cursor).

## LSP (future option)

Everything the extension does goes through editor-neutral providers over `WorkspaceIndex`, so a Language Server Protocol server could host the same classes (swapping the `src/vscode/` glue for `vscode-languageserver` handlers) when other editors need support. That is deliberately not built now.

## Known limits

- Not exercised in a real VS Code or Cursor host yet; behavior is covered by unit tests with fakes plus a bundle smoke test.
- Hover thumbnails rely on VS Code rendering local `file:` images in hover markdown (SVG, PNG, JPEG).
- Rename confirmation for published IDs needs `git` on PATH and release tags named `<group>/<short>/v<version>`; without tags there is no warning.
- Multi-root workspaces get one index per folder; references do not cross folders.
