# Architecture

This page covers `@jackkoskie/docengine-core` (pure library, no Node APIs) and `docengine` (CLI plus Node adapters). The VS Code and Cursor extension is a third package, `packages/vscode`; see [packages/vscode/README.md](../packages/vscode/README.md). The function API (`parse`, `validate`, `generateTypst`, `buildManifest`, `loadConfig`, ...) is a set of thin facades over the classes below.

## core: domain model (`src/model`)

Immutable classes with behaviour.

- `ProvisionId`: value object for a provision ID. Parses without throwing (`parse(text, scheme = CARS)`); the instance keeps its scheme and knows `depth`, `level`, `parent`, `child(n)`, `sibling(n)`, `nextSection()`, `compare`, `sortKey`, `isChildOf`, `typstLabel` (`p602-60-1-c`) and `formProblems()`. The level is decided by position. Segment alphabets live in strategy classes (`NumberKind`, `LowerLetterKind`, `LowerRomanKind`, `UpperLetterKind`, `UpperRomanKind`); width and padding live on the level. Numeral helpers (`toLetters`, `toRoman`) stay exported.
- `NumberingScheme` (`model/numbering/`): the grammar. `cars` and `legal` are presets compiled from `CARS_TEMPLATE` and `LEGAL_TEMPLATE`, which are ordinary custom level lists (`digits`, `min`, and a concatenate joiner express the CARs head `602.60`). `decimal` (`1`, `1.1`, `1.1.1`, capped at six) is the all-dots preset. Custom schemes may also use consecutive dotted numbers; each dot is one segment. `buildCustomScheme` validates a user level list. The first `topLevels` levels are headings (gaps allowed, no parent required); deeper levels are nested and contiguous. `showLabel: false` drops the level name from rendered headings and the table of contents. `pageBreak` on a level forces or suppresses a page break before each of its headings; omitted, the level follows `headings.pageBreakBefore`. `indent` is a whole number of `2.2em` steps for a hanging-label provision (default `0`, flush with the margin). It is that level's own inset, headings ignore it, and it stays out of the scheme key. The cars preset sets Paragraph 1, Subparagraph 2, Clause 3 and Subclause 4; decimal sets Paragraph 1 and Subparagraph 2. `LEVELS` / `levelAt` / `levelByName` remain the CARs table for callers that assume it. Workspace config `numbering` is the default; a document's front matter `numbering` overrides it. A cross-document reference whose target uses a different grammar (scheme `key`) is a warning.
- Tombstones (`[602.60(2)] [repealed] note`) are provisions with `repealed: true` and a `repealNote`; a titled tombstone is `[602.60] # Title [repealed] note`.
- `Provision`, `Figure`, `Reference`: tree nodes with source positions. `Provision.toIndexEntry()` and `Figure.toIndexEntry()` feed the manifest.
- `Document`: the parsed tree plus metadata accessors (`group`, `short`, `version`, ...), lookups (`findProvision`, `childrenOf`, `findFigure`) and `usableProvisions`.
- `Diagnostic` (immutable, `format()` gives `file:line:col severity message`) and `DiagnosticCollector`.

## core: services (each behind an interface)

| Concern | Interface | Default class |
| --- | --- | --- |
| Parsing | `Parser` | `MarkdownParser` (collaborators: `FrontmatterParser`, `BlockParser`, `FigureParser`, `ReferenceScanner`, `FootnoteScanner`) |
| Validation | `DocumentValidator` | `Validator`, which runs a list of `Rule`s |
| Typst output | `DocumentGenerator` | `TypstGenerator` (with `InlineConverter`) |
| Compiling | n/a | `TypstCompiler`, driven by a `TypstRunner` port |
| Manifest | n/a | `ManifestBuilder`, `Manifest`, `ManifestEntry` (`toJSON()` gives the DTO) |
| Upload sheet | `UploadSheetRenderer` | `UploadSheetBuilder` |
| Config | `ConfigLoader` | `DefaultConfigLoader` (`ResolvedConfig` is a plain DTO) |
| Git history | `HistoryProvider` | `GitHistoryProvider` (per-document `DocumentHistory`: last tag, base snapshot, diff) |
| Diff output | `DiffRenderer` | `TextDiffRenderer`, `MarkdownDiffRenderer`, `JsonDiffRenderer`; `ReleaseNotesBuilder` |

### Rules

`Rule { name; check(ctx: RuleContext) }`. `Validator.standard()` runs, in order: `FrontmatterSchemaRule`, `FrontmatterDateRule`, `CoverFieldsRule` (`subtitle` and `notice` belong on the cover), `HasProvisionsRule`, `ProvisionIdFormatRule`, `DuplicateProvisionRule`, `ProvisionParentRule`, `ProvisionOrderRule` (siblings contiguous from the first label; declared Parts, Subparts and Sections ascending; a repealed tombstone stands in for its number), `DivisionConsistencyRule` (a Section follows its declared Subpart, a Subpart its Part), `EmptyTitleRule`, `MisplacedTitleMarkerRule`, `ReferenceRule`, `FootnoteReferenceRule`, `FootnoteDefinitionRule`, `FigureDeclarationRule`, `FigureFileRule`, and the repo-level `PathMatchesFrontmatterRule` and `UniqueShortRule` (these only act during repository validation). The same list ends with the git-aware rules below. `Validator.standard(extra)` appends rules without replacing the built-in ones; results are ordered by position.

## core: history, diff and authoring (src/git, src/authoring)

- `DocVersion` (`major.minor` value object), `ReleaseTags` (the `<group>/<short>/v<version>` convention), `SnapshotLoader` / `DocumentSnapshot` (a document and its figure hashes at a ref, read through `GitClient` and `Hasher`).
- `DocumentDiff.compare(before, after)`: provisions by ID (added, changed, removed, moved when a removed and an added provision have identical content) and figures by key (added, changed hash/caption/attributes, removed, renumbered). `ProvisionContent` is the canonical text compared; whitespace layout is ignored and figure image hashes are part of it.
- `ChangeDetector`: `version` differs from the last tag, else from the base ref. `ChangeSummary` feeds the optional PDF page via `TypstOptions.changeSummary`.
- Git-aware rules are in `Validator.standard()` and read `RuleContext.history` (undefined unless `check` requested it, so `validate` and `build` are unaffected): `VersionBumpRule`, `VersionAfterTagRule`, `RemovedIdsRule` (wraps `findRemovedProvisionIds`).
- Authoring, all pure text-in/text-out: `Formatter` (a pipeline of `LineStep`s: `BlankIdFiller`, `TombstoneNormalizer`, `TombstoneRestorer`, `FigureAttributeNormalizer`), `Renumberer` (plans edits across documents), `VersionBumper` / `FrontmatterEditor`, `DocumentScaffold`.

## core: ports (`src/ports.ts`)

`FileSystem`, `Host` (asset inspection for validation), `Hasher`, `GitClient` (`headCommit`, `refExists`, `readFileAt`, `listTags`), `Clock`, `TypstRunner`. Core only depends on these interfaces. `FileSystemHost` adapts a `FileSystem` to `Host`. `src/testing.ts` has in-memory fakes: `InMemoryFileSystem`, `InMemoryHost`, `FakeGitClient` (refs, tags and their files), `FixedClock`, `FakeHasher`, `FakeTypstRunner`.

## cli

- `Services` (`services.ts`) is the dependency bundle; `createNodeServices` (`node/adapters.ts`) is the composition root with `NodeFileSystem`, `NodeGitClient`, `SystemClock`, `FsFileWatcher`, `NodeHasher`, `ProcessTypstRunner` and `JitiModuleImporter`. `FileWatcher` (`watch(options, onChange)` returning a `WatchSession`) is the injected port behind `watch`.
- `Command` is an abstract base class (`name`, `summary`, optional `options`, `run(invocation)`). Every command extends it: `ValidateCommand`, `CheckCommand`, `BuildCommand`, `SchemaCommand`, `FormatCommand` (fmt), `RenumberCommand`, `NewCommand`, `BumpCommand`, `WatchCommand`, `DiffCommand`, `ChangedCommand` and `ReleaseNotesCommand`. `DiagnosticPrinter` takes a `DiagnosticFormatter` (`TextDiagnosticFormatter` or `GithubDiagnosticFormatter` for `--format github`). `ChangeReporter` turns the workspace's `HistoryProvider` into changed flags, diff entries and summaries for `diff`, `changed`, `release-notes` and `build --only-changed`. `CommandRegistry` holds them and `CommandRunner` parses argv and dispatches.
- Adding a command: write a `Command` subclass and register it in `createDefaultRegistry`.
- `Workspace` (project + documents + diagnostics, plus an optional `HistoryProvider` built from `--base`) is the shared starting point for commands. `ProjectLoader` and `DocumentRepository` do the file work through the `FileSystem` port. `DocumentBuilder` and `TemplateInstaller` are the build steps.

## Testing

Unit tests use the in-memory fakes, so nothing needs typst, git or a real disk. `packages/cli/test/cli.test.ts` additionally runs the real adapters against `fixtures/`.
