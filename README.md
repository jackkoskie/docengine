# docengine

Docs-as-code for policy documents. Write Markdown with bracketed provision IDs, get validated Typst PDFs plus a JSON manifest and an upload sheet. The engine is FIR-agnostic and has no dependency on any particular organisation's systems. It was created for the document pipeline of the CZQM/CZQX FIR; this repository contains no policy content, only fictional examples.

New here? Start with [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

Maintainers: see [docs/RELEASING.md](docs/RELEASING.md) before publishing packages or the editor extension.

Looking for an example of this being used? See how the CZQM FIR manages their policies: [https://github.com/CZQM-FIR/policies](https://github.com/CZQM-FIR/policies)

## Layout

- `packages/core` (`@jackkoskie/docengine-core`): pure library (parser, validator, schema, Typst generator, manifest, config). No filesystem or process assumptions.
- `packages/cli` (`@jackkoskie/docengine`): the CLI (command `docengine`). It also re-exports core, so `import { defineConfig } from "@jackkoskie/docengine"` works in config files.
- `packages/vscode` (`docengine-vscode`): the VS Code and Cursor extension. See [packages/vscode/README.md](packages/vscode/README.md).
- `templates/default-letterhead.typ`: neutral letterhead template.
- `schema/frontmatter.schema.json`: generated JSON Schema (kept in sync by a test).
- `fixtures/`: fictional example repos used by tests: `example-policy` (short policy), `example-handbook` (long document that uses every feature, plus a small companion document), `sample-repo`, and `invalid`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the class structure.

## Document format

```markdown
---
title: Sample Coordination Policy
short: sample-policy
group: operations
version: "1.0"
effectiveDate: 2024-01-15
---

[1] # Example Part

[100] # General

[100.01] # Scope

[100.01(1)] Handoffs follow [[fig:handoff]] and [[100.01(2)(a)]].

[100.01(2)] Details:

[100.01(2)(a)] A paragraph.

[100.01(2)(b)] Another paragraph.

![Handoff profile](images/handoff.svg){#fig:handoff width=80%}
```

- IDs may follow any sort of style, by default they follow the CARs-style grammar `602.60(1)(c)(i)(A)(I)`. The engine calls every addressable unit a **provision**; there are eight levels:

  | Level          | Form                                   | Example                   |
  | -------------- | -------------------------------------- | ------------------------- |
  | 1 Part         | one digit                              | `[6]`                     |
  | 2 Subpart      | three digits (first digit is the Part) | `[602]`                   |
  | 3 Section      | Subpart, a dot and 2 or 3 digits       | `[602.60]`                |
  | 4 Subsection   | number                                 | `[602.60(1)]`             |
  | 5 Paragraph    | lowercase letter                       | `[602.60(1)(c)]`          |
  | 6 Subparagraph | lowercase roman numeral                | `[602.60(1)(c)(i)]`       |
  | 7 Clause       | uppercase letter                       | `[602.60(1)(c)(i)(A)]`    |
  | 8 Subclause    | uppercase roman numeral                | `[602.60(1)(c)(i)(A)(I)]` |

  Parts and Subparts are optional headings: declare them (`[6] # Title`, `[602] # Title`) only when you want them; a Section such as `[602.60]` is always valid on its own. Declared Parts, Subparts and Sections must ascend through the document, a Section must follow its declared Subpart, and a declared Subpart must follow its Part. A parent must exist, and siblings are contiguous from the first label ((1), (2), ... or (a), (b), ...). Labels are positional: `(i)` is the ninth letter at Paragraph level but the first roman numeral at Subparagraph level. "Clause" is the name of level 7 only. Repeal a provision with a tombstone `[602.60(2)] [repealed] optional note`: it renders as its label followed by "Repealed" and the note, stands in for the number when siblings are checked for gaps, still counts as an existing parent, appears in the table of contents when titled (`[602.60] # Title [repealed]`), and `diff` / `release-notes` report it as repealed rather than removed.

  The grammar is a numbering scheme. `cars` above is the default. Set `numbering` in `docengine.config.*` for the workspace, or the same field in a document's front matter to override that one file. Depth is the length of the scheme.

  | Scheme           | IDs                                           | Heading levels                                                             |
  | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
  | `cars` (default) | `6`, `602`, `602.60`, `602.60(1)(a)(i)(A)(I)` | Part, Subpart, Section                                                     |
  | `legal`          | `1`, `1.1`, `1.1(a)`, `1.1(a)(i)`             | Article, Section                                                           |
  | `decimal`        | `1`, `1.1`, `1.1.1`, up to six levels         | Division, Subdivision, Section                                             |
  | `custom`         | whatever the `levels` list describes          | the first `topLevels` (default: levels before the first parenthesised one) |

  ```ts
  numbering: "legal"
  // or
  numbering: {
    scheme: "custom",
    levels: [
      { label: "Book", kind: "number" },
      { label: "Chapter", kind: "number", joiner: "." },
      { label: "Clause", kind: "lower-letter", joiner: "()", italic: true },
    ],
  }
  ```

  `kind` is `number`, `lower-letter`, `lower-roman`, `upper-letter` or `upper-roman`. `joiner` is `"."`, `"()"` or `""` (concatenate a fixed-width number, so `6` + `02` is `602`). The first level has no joiner. `digits` is an exact width (`2`) or `{ min, max }` (`{ min: 2, max: 3 }` writes `01` and also accepts `100`). `min` is the lowest ordinal (`0` allows `00`). `showLabel: false` prints the id alone in headings and the table of contents (`2 — Title` rather than `Section 2 — Title`); diagnostics still name the level. `pageBreak: true` starts each heading of that level on a new page; `pageBreak: false` keeps it in the flow. A level that omits `pageBreak` follows `headings.pageBreakBefore`. `indent` is a whole number of 0 or more (default 0). A hanging label at that level sits that many steps of 2.2em in from the margin; 0 is flush. The number is that level's own inset, not a step added to its parent, and headings stay full width. The cars preset sets Paragraph 1, Subparagraph 2, Clause 3 and Subclause 4. Decimal sets its Paragraph to 1 and its Subparagraph to 2. Consecutive dotted number levels are read one segment per dot (`1.1.1`). `decimal` is the six-level all-dots preset. `cars` and `legal` are presets compiled from those same fields. A reference into a document that uses a different grammar produces a warning; pasting the cars or legal levels as `custom` is the same grammar and does not warn.

- References: `[[100.01(2)(a)]]`, `[[other-doc#100.01(2)]]`, `[[fig:key]]`, `[[other-doc#fig:key]]`.
- Figures: `![caption](path){#fig:key width=80% align=center placement=float}`. The caption is also the alt text. SVG, PNG and JPEG, 2 MB limit by default.
- Documents live at `documents/<group>/<short>.md`.

### Titles, cover page, table of contents, footnotes

- Titles at any level: `[602.60] # Title` followed by the body on the next lines (a lone `#` is an empty title). Parts, Subparts and Sections are always headings ("Section 602.60 — Title"); deeper titles up to `headings.maxDepth` (default 3) are headings too and deeper ones run in as bold text. `headings.format` (default `{level} {id} — {title}`) sets the heading text. Labels hang at the left margin. Subsections `(1)` are flush; Paragraphs `(a)` in italics, then `(i)`, `(A)` and `(I)`, sit at the `indent` of that level (1, 2, 3 and 4 for cars).
- Cover page: on by default (`cover.enabled: true`; `cover: false` in a document, or `cover.enabled: false` in the config, turns it off), plus `subtitle`, `effectiveTime` (`0300Z`, shown with the effective date) and `notice`. The cover has no header, footer or page number; numbering starts at 1 after the table of contents. Replace the cover with `cover.template`.
- Table of contents: built from titled provisions down to `toc.depth` (default 3, so Part / Subpart / Section), with dotted leaders, page numbers and links. On whenever the document has a cover (so by default); `toc: true` forces it without a cover, `toc: false` turns it off.
- Page breaks: with a table of contents, every Part and Subpart starts a new page (`headings.pageBreakBefore` is the deepest level number that breaks, default `2`; `3` also breaks before each Section, `false` never). A numbering level can override that with `pageBreak: true` or `pageBreak: false`. Documents without a table of contents flow continuously unless a level sets `pageBreak: true`. `[602.60]{page}` forces a break before one provision and `[602.60]{nopage}` suppresses it; both work with `{keep}` / `{break}` (`[602.60]{keep}{page}`) and win over the level.
- Keep with next: headings are never left alone at the bottom of a page, and a paragraph that introduces a figure stays with it. Per provision, `[602.60(4)]{keep}` or `[602.60(4)]{break}` forces or allows a page break. `keepWithNext: false` turns the default off.
- Footnotes: `text[^id]` and, anywhere in the file, `[^id]: Footnote text` (continue on lines indented by two spaces). Undefined references and duplicate definitions are errors; unused definitions are warnings. Footnotes work in table cells and figure captions.
- Inline: `++underlined++`, `==highlighted==` (colour `branding.colors.highlight`).
- Tables: an empty cell between pipes (`||`) merges the cell into the one on its left (column span); a cell containing only `^` merges into the cell above (row span).

## Usage

```sh
pnpm install
pnpm build

docengine validate [paths...] [--format text|github]   # file:line:col severity message; exit 1 on errors or when nothing matched
docengine check [paths...] [--base <ref>] [--format text|github]   # validate + git-aware rules
docengine build [--no-compile] [--only-changed] [--base <ref>] [--base-only]   # .typ + PDF (needs typst), dist/manifest.json, dist/upload-sheet.md
docengine build <file...>                                           # preview of named files, written to dist/preview/ (the full manifest.json is left alone)
docengine schema [--out file]        # frontmatter JSON Schema

# authoring
docengine new <group> <short> [--title t]          # scaffold documents/<group>/<short>.md
docengine fmt [paths...] [--check] [--tombstones] [--base <ref>] [--indent n]  # fill blank [] IDs, normalize figures
docengine renumber <group>/<short> <from> <to> ... # explicit, logged renumbering
docengine bump <group>/<short> major|minor         # version + effectiveDate
docengine watch [group/short | paths...]           # rebuild on change

# release and review
docengine diff --base <ref> [--format text|markdown|json]
docengine changed --base <ref> [--json]
docengine release-notes <group>/<short> --base <tag>
```

Shared options: `--cwd <dir>`, `--config <file>`. `build` and `watch` also take `--out <dir>` and `--typst <path>` (`schema` takes `--out` as well).

### CLI interfaces for CI (stable)

The GitHub Action relies on exactly these. `<ref>` is any git ref (branch, tag, SHA) that exists in the checkout, so fetch full history (`fetch-depth: 0`) and tags.

| Command                                                | Output and exit code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docengine check --base <ref> --format github`         | Runs `validate` plus the git-aware rules. Prints one `::error file=<path>,line=<n>,col=<n>::<message>` (or `::warning`; an info finding is `::notice`) per finding on stdout, then a summary line. Exit 1 if any error, or when nothing matched.                                                                                                                                                                                                                                                                                            |
| `docengine diff --base <ref> --format markdown`        | Markdown per changed document: provisions (Added, Changed, Repealed, Removed, Moved) and figures (Added, Changed with before/after hash, Removed, renumbered). Prints `No document changes.` when nothing differs.                                                                                                                                                                                                                                                                                                                          |
| `docengine diff --base <ref> --format json`            | `{ base, documents: [{ group, short, key, title, file, draft, isNew, against, version: { from, to }, provisions: { added, changed, repealed, removed, moved }, figures: { added, changed, removed, renumbered } }] }`. Provision entries are `{ id, excerpt }`; moves are `{ from, to, excerpt }`. Added, changed and removed figures are `{ key, path, caption, number, before, after, reason? }` (`key` and the hashes are null when absent; `reason` is `image`, `caption` or `attributes`). Renumbered figures are `{ key, from, to }`. |
| `docengine changed --base <ref> --json`                | JSON array of `{ key, group, short, title, file, version, previousVersion, effectiveDate, tag, draft }` for documents whose `version` differs from the last release tag `<group>/<short>/v<version>` (when one exists) or else from the version at `<ref>` (a document that is new at `<ref>` counts as changed). `draft: true` documents are left out (built but never released); add `--include-drafts` to list them. `--base-only` ignores tags. Without `--json`, one line per document.                                                |
| `docengine release-notes <group>/<short> --base <tag>` | Markdown release notes: the provision and figure diff since `<tag>` and a final line `Pull request: {{PR_URL}}` for the Action to substitute. Without `--base` it compares with the last tag, and prints `Initial release.` when there is none.                                                                                                                                                                                                                                                                                             |
| `docengine build --only-changed --base <ref>`          | Builds only changed documents (same rule as `changed`, drafts included so reviewers get previews), marks them `changed: true` in `manifest.json`, and lists only changed non-draft documents in `upload-sheet.md`. Without `--only-changed` every document is built and `changed` stays `null` unless `--base` is given. `--base-only` ignores release tags, the same as `changed`.                                                                                                                                                         |

### Git-aware checks (`check`)

These rules use the `GitClient` port and do nothing without history, so `validate` and `build` are unaffected.

- **`version-not-bumped` (error):** a document's body (provision content, ignoring whitespace layout) or any figure image hash changed against `--base` but `version` did not. Without `--base` the document is compared with its last release tag. Editorial-only changes opt out with `version-note: editorial` in the frontmatter.
- **`removed-provision-id` / `removed-figure-key` (warning):** a provision ID or figure key of the previous version (last tag, else `--base`) is gone. Repeal with a tombstone (`[602.60(4)] [repealed]`) instead; `docengine fmt --tombstones` puts missing ones back.
- **`version-below-tag` (error):** `version` is lower than the last tag `<group>/<short>/v<version>`.

### Authoring tools

- **`fmt`** fills each blank `[]` with the next ID. Depth comes from indentation (one level per indent unit, auto-detected from the smallest indent in the file, otherwise 2 spaces; `--indent n` sets it): no indent is the next Section after the previous Section or Subpart (`[602.61]`), one level is a Subsection under the previous Section, then Paragraph, and so on. It also rewrites figure attribute blocks as `{#fig:key width= align= placement=}` and normalizes `[repealed]` tombstones. It never changes an existing ID, and refuses a fill whose ID is already used further down. `--check` reports without writing and exits 1. `--tombstones` restores `[id] [repealed]` for IDs removed since the last release tag (or `--base`).
- **`renumber <group>/<short> <from> <to> [<from> <to> ...]`** is the only way IDs change. It moves the provision and its descendants (`602.60(2)` to `602.60(4)` also moves `602.60(2)(a)` to `602.60(4)(a)`; both IDs must be at the same level), rewrites every `[[ref]]` repo-wide (`[[602.60(2)]]` in the document, `[[short#602.60(2)]]` and `[[group/short#602.60(2)]]` elsewhere), and logs each change as `file:line provision|reference [from] -> [to]`. `--tombstone` leaves `[old] [repealed] Renumbered to [[new]]` behind, `--dry-run` writes nothing. It refuses collisions.
- **`new <group> <short>`** creates `documents/<group>/<short>.md` with full frontmatter, the `# yaml-language-server: $schema=...` modeline (`--schema` overrides the relative default; generate the file with `docengine schema --out schema/frontmatter.schema.json`) and a one-section skeleton (`[100.01] # Section title`, `[100.01(1)] First subsection.`).
- **`bump <group>/<short> major|minor [--date YYYY-MM-DD]`** rewrites `version` (`1.1` or `2.0`) and sets `effectiveDate` (default today), keeping the rest of the file untouched.
- **`watch`** builds once, then rebuilds when documents, images or the config change. It takes the same options as `build`. It uses `fs.watch` (recursive) with debouncing; failed builds keep the watcher running.
- **Summary of changes page:** set `summaryOfChanges: true` in the config to append a generated page to each PDF listing provision and figure changes since the previous release (last tag, else `--base`). Off by default.

### VS Code / Cursor extension

The extension (`packages/vscode`) gives live diagnostics (the same validator as `docengine validate`), ID and reference completion, hover, go to definition, rename, outline, quick fixes, snippets and a PDF preview command. See `packages/vscode/README.md` for the full feature list.

Install from a release (no build needed): download `docengine-<version>.vsix` from the engine's GitHub Release, then either run

```sh
code --install-extension docengine-<version>.vsix
```

or use "Extensions: Install from VSIX..." in the command palette (VS Code or Cursor), and reload the window.

Install from source:

```sh
pnpm install
pnpm --filter docengine-vscode package      # writes packages/vscode/dist/docengine.vsix
code --install-extension packages/vscode/dist/docengine.vsix
```

Open the documents repo as the workspace folder; the extension activates when it contains `docengine.config.*` or `documents/**/*.md`. `docengine: Build PDF preview` needs the `docengine` CLI on your PATH (or set `docengine.cli.command`) and the `typst` CLI on your PATH.

### Editor snippets and pre-commit hook

- `editors/snippets/docengine.code-snippets`: VS Code snippets (`de-frontmatter`, `de-part`, `de-subpart`, `de-section`, `de-subsection`, `de-paragraph`, `de-subparagraph`, `de-clause`, `de-subclause`, `de-provision`, `de-repealed`, `de-ref`, `de-xref`, `de-figure`, `de-figref`, `de-title`, `de-footnote`, `de-footnote-def`, `de-underline`, `de-highlight`, `de-keep`). The extension contributes the same prefixes from `packages/vscode/snippets/docengine.code-snippets`. Copy the file to `.vscode/` in the documents repo.
- `.githooks/pre-commit` runs `docengine fmt --check` and `docengine check` when documents or images are staged. Install with `git config core.hooksPath .githooks` (and `chmod +x .githooks/pre-commit`); set `DOCENGINE_BASE=origin/main` to compare against a branch instead of the last tag. `.githooks/lefthook.yml` is the same as a lefthook config.

Config: `docengine.config.ts` (or `.mts`, `.js`, `.mjs`, `.json`):

```ts
import { defineConfig } from "@jackkoskie/docengine";

export default defineConfig({
  branding: {
    firName: "My FIR",
    logo: "assets/logo.svg",
    footer: "My FIR Policies",
  },
  cover: {
    enabled: true,
    firName: "My FIR",
    logo: "assets/logo.svg",
    notice: "For Flight Simulation Use Only",
  },
  toc: { depth: 3, title: "Table of Contents" },
  numbering: "cars", // "legal", "decimal", or { scheme: "custom", levels: [...] }
  headings: {
    format: "{level} {id} — {title}",
    maxDepth: 3,
    pageBreakBefore: 2,
  },
  fonts: { paths: ["assets/fonts"], ignoreSystemFonts: true }, // bundled fonts, see "Deterministic fonts"
  keepWithNext: true,
  summaryOfChanges: false, // append a "Summary of changes" page to each PDF
  extensions: { required: "boolean", "public?": "boolean" }, // arktype definitions
});
```

PDF compilation needs the [`typst`](https://typst.app) CLI (0.13 or newer supported; 0.15.1 is what CI uses) on `PATH`. Without it, `build` writes the `.typ` files, the manifest and the upload sheet, and skips compilation with a message.

### Deterministic fonts

By default Typst uses the fonts installed on the machine, so a template that asks for "Arial" renders differently (or falls back with a warning) on a machine without it. To make output independent of the machine, bundle font files in the documents repo and configure:

```json
{ "fonts": { "paths": ["assets/fonts"], "ignoreSystemFonts": true } }
```

- `fonts.paths`: directories (relative to the config directory) searched for font files. Each is passed to `typst compile` as `--font-path`, by `build` and `watch` alike (the VS Code preview and the GitHub Action both run the CLI, so they pick this up).
- `fonts.ignoreSystemFonts` (default `false`): passes `--ignore-system-fonts`, so only the bundled fonts and the fonts embedded in the Typst binary (such as the default "Libertinus Serif") are available.

Use static TTF/OTF files (Typst's variable font support is limited), include every style you use (regular, bold, italic, bold italic), and request those family names in `branding.font` or your custom templates, with no system fallbacks. Typst's own output lists any "unknown font family" warning if a family is missing.

License caveat: only bundle fonts whose license allows redistribution, and ship their license text next to them. Do not bundle proprietary fonts such as Arial or Segoe UI. Liberation Sans (SIL OFL 1.1) is a metric-compatible, open alternative to Arial.

## Development

```sh
pnpm test         # vitest (no typst required)
pnpm typecheck    # tsc -b plus type-check of tests
pnpm schema       # regenerate schema/frontmatter.schema.json after schema changes
pnpm sample       # build the sample repo
```

## License

The engine (`packages/*`, `action/`, `.github/`, `docs/`, `scripts/`) is licensed under the [Mozilla Public License 2.0](LICENSE) (MPL-2.0), copyright 2026 Jack Koskie. `templates/` and `template-repo/` are [MIT](templates/LICENSE). Third-party dependencies are listed in [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md).

In plain language, for other FIRs:

- **Using the engine** (the CLI, the GitHub Action, the VS Code extension) puts no obligation on you. You do not have to publish anything.
- **Your documents and output are yours.** The PDFs, `manifest.json`, upload sheet and your Markdown policies belong entirely to you, whatever licence you choose for them.
- **Changing engine files and sharing the result is where MPL applies.** If you modify an engine file and distribute it (for example in a fork you publish), you must make your version of that file available under MPL-2.0. This is "file-level" copyleft: it covers the files, not your whole project.
  - _Example:_ you edit `packages/core/src/parser/parser.ts` and publish your fork, so that edited `parser.ts` must be shared under MPL-2.0. A new file you add next to it, or your own config and documents, can stay under any licence, including private ones.
- **Templates and the starter are MIT.** Copy and modify `templates/` and `template-repo/` freely, keeping the MIT notice.
- **Contributions** need a DCO sign-off (`git commit -s`); see [CONTRIBUTING.md](CONTRIBUTING.md).

This is a plain-language summary, not legal advice. The licence texts are what count.
