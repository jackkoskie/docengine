// SPDX-License-Identifier: MPL-2.0
// ---- facades (function API) ----
export { parse } from "./parser/parser.js";
export { validate, validateRepository } from "./validation/validator.js";
export { findRemovedProvisionIds } from "./validation/removed-ids.js";
export { generateTypst } from "./typst/generator.js";
export { buildManifest, buildManifestEntry, buildUploadSheet } from "./manifest/builders.js";
export { loadConfig, resolveConfig } from "./config/loader.js";
export { schema, createSchema, toJsonSchema, baseDefinition, baseSchema, BASE_KEYS, extensionKeys, type BaseFrontmatter } from "./schema.js";

// ---- domain model ----
export { Diagnostic, DiagnosticCollector, formatDiagnostic, hasErrors, type Position, type Severity } from "./model/diagnostic.js";
export { ProvisionId, ProvisionLevel, LEVELS, LEVEL_NAMES, MAX_LEVEL, levelAt, levelByName, levelLabel, ID_PATTERN, typstLabelForProvision, ids, type LevelName, type SegmentKind, type SegmentKindName, type NumberingScheme } from "./model/provision-id.js";
export { CARS, LEGAL, DECIMAL, PRESETS, CARS_TEMPLATE, LEGAL_TEMPLATE, buildCustomScheme, resolveNumbering, type NumberingInput, type NumberingResult, type CustomLevelInput, type CustomSchemeInput } from "./model/numbering/presets.js";
export { toLetters, toRoman, fromLetters, fromRoman } from "./model/numbering/kinds.js";
export { Provision, type ProvisionIndexEntry, type ProvisionKeep, type ProvisionPage, type ProvisionProps } from "./model/provision.js";
export { Footnote, FootnoteReference } from "./model/footnote.js";
export { Figure, type FigureAlign, type FigurePlacement, type FigureIndexEntry, type FigureProps } from "./model/figure.js";
export { Reference, type ReferenceKind } from "./model/reference.js";
export { Document, type DocumentProps, type FrontmatterKeyPosition } from "./model/document.js";
export type { Block, BlockType, TableMerge, TableMerges } from "./model/block.js";
export { resolveAssetPath, imageFormat } from "./model/paths.js";

// ---- services ----
export { MarkdownParser, type Parser, type ParseOptions } from "./parser/parser.js";
export { Validator, type DocumentValidator, type ValidationOptions, type ValidateContext } from "./validation/validator.js";
export type { Rule, RuleContext, RepositoryEntry } from "./validation/rule.js";
export { FrontmatterSchemaRule, FrontmatterDateRule, CoverFieldsRule } from "./validation/rules/frontmatter-rules.js";
export {
  HasProvisionsRule,
  ProvisionIdFormatRule,
  DuplicateProvisionRule,
  DivisionConsistencyRule,
  ProvisionParentRule,
  ProvisionOrderRule,
  EmptyTitleRule,
  MisplacedTitleMarkerRule,
} from "./validation/rules/provision-rules.js";
export { FootnoteReferenceRule, FootnoteDefinitionRule } from "./validation/rules/footnote-rules.js";
export { ReferenceRule } from "./validation/rules/reference-rule.js";
export { FigureDeclarationRule, FigureFileRule } from "./validation/rules/figure-rules.js";
export { PathMatchesFrontmatterRule, UniqueShortRule } from "./validation/rules/repository-rules.js";
export { TypstGenerator, type DocumentGenerator, type TypstOptions } from "./typst/generator.js";
export { TypstCompiler, type CompileRequest, type CompileResult } from "./typst/compiler.js";
export { escapeTypst, typstString } from "./typst/text.js";
export { ManifestBuilder, UploadSheetBuilder, type UploadSheetRenderer, type UploadSheetOptions } from "./manifest/builders.js";
export {
  Manifest,
  ManifestEntry,
  type ManifestDto,
  type ManifestEntryDto,
  type ManifestEntryInput,
  type ManifestOptions,
  type PdfInfo,
} from "./manifest/manifest.js";
export { DefaultConfigLoader, type ConfigLoader } from "./config/loader.js";
export {
  defineConfig,
  ConfigError,
  type DocengineConfig,
  type ResolvedConfig,
  type BrandingConfig,
  type ImagesConfig,
  type ImageFormat,
} from "./config/config.js";
export { FrontmatterSchema, type SchemaProblem } from "./schema.js";
export { imageDimensions } from "./images.js";

// ---- ports and adapters ----
export type { Clock, FileSystem, GitClient, Hasher, Host, FileInfo, ProcessResult, TypstRunner } from "./ports.js";
export { FileSystemHost } from "./host.js";
export { InMemoryFileSystem, InMemoryHost, FakeGitClient, FakeHasher, FixedClock, type FakeGitHistory, FakeTypstRunner } from "./testing.js";

// ---- git history, diff, authoring ----
export { DocVersion, type BumpKind } from "./git/version.js";
export { ReleaseTags, type ReleaseTag } from "./git/release-tags.js";
export { DocumentSnapshot, SnapshotLoader, ProvisionContent } from "./git/snapshot.js";
export {
  DocumentDiff,
  type DocumentDiffDto,
  type ProvisionRef,
  type MovedProvision,
  type FigureChange,
  type RenumberedFigure,
} from "./git/diff.js";
export { GitHistoryProvider, ChangeDetector, type DocumentHistory, type HistoryProvider } from "./git/history.js";
export {
  TextDiffRenderer,
  MarkdownDiffRenderer,
  JsonDiffRenderer,
  ReleaseNotesBuilder,
  type DiffRenderer,
  type DiffReport,
  type DocumentDiffEntry,
} from "./git/diff-report.js";
export { ChangeSummary } from "./git/change-summary.js";
export { VersionBumpRule, VersionAfterTagRule, RemovedIdsRule } from "./validation/rules/git-rules.js";
export {
  Formatter,
  BlankIdFiller,
  FigureAttributeNormalizer,
  TombstoneNormalizer,
  TombstoneRestorer,
  type FormatChange,
  type FormatProblem,
  type FormatResult,
  type FormatOptions,
} from "./authoring/formatter.js";
export {
  Renumberer,
  type RenumberChange,
  type RenumberMapping,
  type RenumberOptions,
  type RenumberPlan,
  type RenumberSource,
} from "./authoring/renumberer.js";
export { VersionBumper, FrontmatterEditor, type BumpResult } from "./authoring/bumper.js";
export { DocumentScaffold, type ScaffoldOptions } from "./authoring/scaffold.js";