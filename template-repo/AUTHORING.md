# Authoring guide

Documents live at `documents/<group>/<doc-name>.md`. Each is YAML frontmatter plus a body of provisions.

## Frontmatter

```yaml
---
# yaml-language-server: $schema=<engine schema URL>
title: Departure Release (DR) Authority
short: departure-release # must match the file name
group: operations # must match the folder name
version: "1.0" # quoted string
effectiveDate: 2023-06-06
expiryDate: 2030-01-01 # optional, after effectiveDate
description: One line summary.
draft: true # optional: builds for review, never released
required: true # extension fields come from docengine.config
public: true
---
```

## Provision IDs

Every provision (the engine's word for any addressable unit) starts with its bracketed ID at the start of a line: `[602.60(1)(c)] Text...`. IDs follow the CARs-style grammar `602.60(1)(c)(i)(A)(I)` and have eight levels:

| Level | Name         | Form                                | Example                               |
| ----- | ------------ | ----------------------------------- | ------------------------------------- |
| 1     | Part         | one digit                           | `[6]`                                 |
| 2     | Subpart      | three digits, the first is the Part | `[602]`                               |
| 3     | Section      | Subpart, dot, two or three digits   | `[602.60]`                            |
| 4     | Subsection   | number                              | `(1)`, `(2)`, `(10)`                  |
| 5     | Paragraph    | lowercase letter                    | `(a)`, `(b)`, ..., `(z)`, then `(aa)` |
| 6     | Subparagraph | lowercase roman numeral             | `(i)`, `(ii)`, `(iv)`                 |
| 7     | Clause       | uppercase letter                    | `(A)`, `(B)`                          |
| 8     | Subclause    | uppercase roman numeral             | `(I)`, `(II)`                         |

"Clause" is the name of level 7 only; the generic word for any unit is "provision". The level is decided by position, so `(i)` is the ninth letter at Paragraph level but a roman numeral at Subparagraph level. `[602.60(1)(c)(i)(A)(I)]` is Subclause (I) of Clause (A) of Subparagraph (i) of Paragraph (c) of Subsection (1) of Section 602.60. Nothing goes deeper.

Parts and Subparts are optional headings. Declare them with a title when you want them (`[6] # Exampleland FIR Policy`, `[602] # Operations`), otherwise start straight at a Section; the Part and Subpart are implied by the digits.

Rules:

- A parent must exist (`602.60(1)(c)` needs `602.60(1)`). Declared Parts and Subparts are optional, undeclared ones are fine.
- Siblings are contiguous from the first label: `(1), (2), (3)`; `(a), (b), (c)`; `(i), (ii), (iii)`; `(A), (B)`. Sections need not be contiguous (`602.60`, then `602.65`), but must ascend.
- Declared Parts, Subparts and Sections ascend through the document, a Section follows its declared Subpart, and a declared Subpart follows its Part.
- Never reuse an ID. To repeal a provision, keep it as a tombstone: `[602.60(4)] [repealed] Withdrawn 2024-03-01.` It prints as its label, "Repealed" and the note; it stands in for the number (no gap error), still counts as a parent, appears in the table of contents when titled (`[602.60] # Title [repealed]`), and shows as "repealed" (not removed) in `diff` and release notes.
- Removing a published ID produces a warning, because other documents may reference it.
- `docengine fmt` fills blank `[]` IDs from the indentation (no indent is the next Section, then Subsection, Paragraph and so on); `docengine renumber` is the only way to change an existing ID (same level only).
- The default level names are the CARs ones above. A workspace can choose another scheme, and one document can override it. See [Numbering schemes](#numbering-schemes).

How it prints: headings read "Section 602.60 — Title" (Parts and Subparts "Part 6 — Title", "Subpart 602 — Title"); Subsection and deeper provisions show a hanging label at the left. `(1)` is flush; `(a)` (Paragraph labels in italics), `(i)`, `(A)` and `(I)` sit at that level's `indent` (1, 2, 3 and 4).

## Numbering schemes

The workspace default is `numbering` in `docengine.config.*`. A document overrides it with the same field in front matter. Depth is however many levels the scheme has.

```yaml
# docengine.config.json, or a document's front matter
numbering: cars       # default
numbering: legal      # 1, 1.1, 1.1(a), 1.1(a)(i)
numbering: decimal    # 1, 1.1, 1.1.1, up to six levels
```

```yaml
numbering:
  scheme: custom
  levels:
    - label: Book
      kind: number
    - label: Chapter
      kind: number
      joiner: "."
    - label: Clause
      kind: lower-letter
      joiner: "()"
      italic: true
```

| Scheme    | Example             | Headings (gaps allowed)        | Nested (contiguous, parent required) |
| --------- | ------------------- | ------------------------------ | ------------------------------------ |
| `cars`    | `[602.60(1)(a)(i)]` | Part, Subpart, Section         | Subsection through Subclause         |
| `legal`   | `[1.1(a)(i)]`       | Article `1`, Section `1.1`     | Paragraph `(a)`, Subparagraph `(i)`  |
| `decimal` | `[1.2.3.4]`         | Division, Subdivision, Section | three deeper dotted levels           |
| `custom`  | from `levels`       | the first `topLevels`          | the rest                             |

`kind` is `number`, `lower-letter`, `lower-roman`, `upper-letter` or `upper-roman`. The first level has no joiner; later levels use `"."`, `"()"` or `""`. `joiner: ""` concatenates a fixed-width number (`digits: 2` turns `6` and ordinal `2` into `602`). `digits: { min: 2, max: 3 }` pads to two digits and also accepts three (`602.01`, `602.100`). `min: 0` allows `00`. `showLabel: false` prints a heading as `2 — Title` instead of `Section 2 — Title`, and the table of contents drops the level name too. `pageBreak: true` starts each heading of that level on a new page; `pageBreak: false` does not. A level that omits `pageBreak` follows `headings.pageBreakBefore`. `indent` is a whole number of 0 or more (default 0): a hanging label sits that many steps of 2.2em in from the margin. The number is that level's own inset, and headings stay full width. Cars sets Paragraph 1, Subparagraph 2, Clause 3 and Subclause 4; decimal sets Paragraph 1 and Subparagraph 2. Config loading rejects an empty list, an unknown kind, and concatenation without an exact `digits`. Consecutive dotted number levels are read one segment per dot (`1.1.1`). `decimal` remains the six-level all-dots preset. `cars` and `legal` are presets of this same shape. A `[[other-doc#...]]` reference into a document that uses a different grammar is a warning.

With `legal`, a blank `[]` at the left margin continues the Section (`1.1`, `1.2`, ...) and one indent is a Paragraph. With `decimal`, the first three dotted levels are headings and deeper ones must be contiguous.

## References

- Same document: `[[602.60(1)(c)]]`
- Other document: `[[other-doc#602.60(1)]]`
- Figure: `[[fig:key]]`, or `[[other-doc#fig:key]]`

Every reference must resolve. Wrap literal brackets in backticks to avoid a reference: `` `[[not a ref]]` ``.

## Figures

```markdown
[602.60(2)] The transition follows [[fig:profile]].

![Transition profile at the boundary](images/profile.svg){#fig:profile width=80% align=center}
```

- Put the image in `images/` next to the document. SVG (preferred for diagrams), PNG or JPEG; 2 MB limit by default.
- The text in brackets is both the caption and the alt text, and is required.
- `#fig:<key>` (`a-z`, `0-9`, `-`) is the permanent identity of the figure. Numbers ("Figure 1") are derived from order, never typed. A figure without a key cannot be referenced and gives a warning, as does an unreferenced figure.
- A figure belongs to the provision it follows.
- Optional attributes: `width` (`80%` or a length), `align`, `placement`.

## Titles

Any provision can have a title. Write `#` after the ID and put the body on the following lines:

```markdown
[602.70(4)] # Interim altitudes
Controllers assign interim altitudes when ...
```

- Parts, Subparts and Sections are always headings ("Section 602.70 — Title"). Deeper titles up to level `headings.maxDepth` (default 3) are headings too; deeper ones run in as bold text.
- `headings.format` (default `{level} {id} — {title}`) sets the heading text.
- A lone `#` is an empty title and gives a warning. `#` is a title only when it follows the ID on the same line.
- Titles feed the table of contents and the editor outline and hover.

## Cover page and table of contents

```yaml
cover: true # default; `cover: false` turns the cover off for this document
subtitle: Policies for the whole FIR
effectiveTime: 0300Z # HHMMZ, shown next to the effective date
notice: For Flight Simulation Use Only
toc: true # default: on whenever there is a cover; false turns it off
```

The cover shows the FIR name and logo from `docengine.config` (`cover.firName`, `cover.logo`), then the title, subtitle, version, effective date and the notice. The table of contents follows on its own page and lists titled provisions down to `toc.depth` (default 3: Part, Subpart, Section). Page numbers start at 1 after it.

## Page breaks

In a document with a table of contents (the default), each Part and Subpart starts on a new page. `headings.pageBreakBefore` in `docengine.config` is the deepest level number that breaks (default `2`); `3` also breaks before each Section, `false` turns it off. A numbering level can override that cutoff with `pageBreak: true` or `pageBreak: false`. For a single provision, write `{page}` (start a new page here) or `{nopage}` (do not) after the ID: `[699.01]{nopage} # Appendix`. Those markers win over both the level and the cutoff. Documents without a table of contents (for example `toc: false`) flow continuously unless a level sets `pageBreak: true` or a provision has `{page}`.

## Keeping things together

Headings never end up alone at the bottom of a page. A paragraph that introduces a figure stays on the same page as the figure. Override per provision with `[602.70(4)]{keep}` (keep with the next block) or `[602.70(4)]{break}` (allow a break). Set `keepWithNext: false` in the config to disable the default.

## Fonts

To make PDFs identical on every machine, put open-licensed static font files (with their license text) in `assets/fonts/` and set `"fonts": { "paths": ["assets/fonts"], "ignoreSystemFonts": true }` in `docengine.config`. Then request only those families in `branding.font` or a custom cover template. Never commit proprietary fonts such as Arial. See "Deterministic fonts" in the engine README.

## Footnotes

```markdown
[602.70(1)] Radar vectoring is described in the manual.[^radar]

[^radar]:
    Source: the Radar Manual,
    chapter 4.
```

- The definition can sit anywhere in the document; continue it on lines indented by two spaces.
- Every `[^id]` needs a definition (error); unused definitions give a warning, duplicate definitions an error.
- Footnotes work in table cells and figure captions, not in titles or inside other footnotes.
- In the editor: hover shows the text, go to definition jumps between reference and definition, and typing `[^` completes ids.

## Inline formatting and table spans

- `++underline++` and `==highlight==` (in addition to `**bold**`, `*italic*`).
- Table cells: `||` merges a cell into the left one, a cell with only `^` merges into the cell above.

## Versioning

Bump `version` in the frontmatter whenever the body or an image changes. A pull request that changes content without a version bump fails the version check. Purely editorial fixes need an explicit opt-out (`version-note: editorial`). The effective date can be later than the merge date.

## Drafts

Set `draft: true` to build and preview a document without ever releasing it. Remove the line when it is ready.

## Release flow

1. Branch, edit, bump `version`, run `pnpm validate` and `pnpm build`.
2. Open a pull request. CI validates, builds preview PDFs and comments with the provision diff.
3. A reviewer approves and merges. There are no manual tags.
4. On merge, CI creates one GitHub Release per document whose version changed (tag `<group>/<short>/v<version>`) with the PDF, manifest entry and upload sheet.
5. Whoever owns publication enters the values from the upload sheet into your document system and uploads the PDF.

Release automation is provided by the engine's reusable workflows; the files in `.github/` are placeholders until you set the engine owner and tag.
