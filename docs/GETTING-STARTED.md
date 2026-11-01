# Getting started

This guide is for a FIR (or any organisation) that wants to publish its policy documents with docengine. The examples use the fictional Exampleland FIR (ICAO `ZXEX`).

## 1. What you get

You write Markdown. docengine checks it, turns it into PDFs (cover, table of contents, numbered provisions, figures, footnotes) and writes a manifest and an upload sheet. Every release is a pull request, so every change is reviewed and every PDF can be traced to a commit.

## 2. Install

You need Node.js 22 (what CI and the GitHub Action use; `package.json` does not declare an `engines` range), pnpm, and the [Typst](https://typst.app) command line tool (0.13 or newer; 0.15.1 is what CI uses). Typst is only needed to produce PDFs. Validation works without it.

```sh
pnpm add -D @jackkoskie/docengine
```

## 3. Create a documents repo

1. Create a new, empty repository for your documents.
2. Copy the contents of `template-repo/` from the engine repository into it.
3. In `package.json`, replace the `file:../packages/cli` dependency with the published `@jackkoskie/docengine` version, pinned exactly, set `packageManager` so pnpm's version is pinned, then run `pnpm install` and commit the lockfile.
4. (optional) We recommend replacing `AUTHORING.md` with a guide to how you wish your policies to be written. This document provides explanation for future authors looking to modify files.
5. Replace the sample `documents/operations/departure-release.md` with your own documents. Keep the folder layout `documents/<group>/<doc-name>.md`.

## 4. Edit `docengine.config.json`

```json
{
  "branding": {
    "firName": "Exampleland FIR",
    "footer": "Exampleland FIR 2026"
  },
  "cover": {
    "logo": "assets/example-logo.svg",
    "notice": "For Example Use Only"
  },
  "extensions": { "required": "boolean", "public?": "boolean" }
}
```

- `branding` is used in the page header and footer.
- `cover` sets what the cover page shows. The cover and the table of contents are on by default (`cover.enabled`).
- `extensions` are your own frontmatter fields, checked on every document.
- Fonts, colours, level names and a custom letterhead are described in the [README](../README.md).

## 5. Write a first document

Create `documents/operations/departure-release.md`:

```markdown
---
title: Departure Release (DR) Authority
short: departure-release
group: operations
version: "1.0"
effectiveDate: 2025-03-01
description: When departure release is granted.
required: true
public: true
---

[100.01] # ZXAA Airport

[100.01(1)] Departure release (DR) is granted automatically once the active runway is confirmed.

[100.01(2)] If ZXAA_TWR uses a non-active runway, it must obtain a DR from ZXAA_APP.[^coordination]

[^coordination]: Coordination is by voice or through the ExampleSitu release function.

[100.02] # Other airports

[100.02(1)] Other ZXEX airports require prior coordination, as described in [[200.01(2)]].
```

The essentials:

- Every provision starts with an ID in brackets at the start of a line. The default is the CARs style: Section `[200.01]`, Subsection `[200.01(1)]`, Paragraph `[200.01(1)(a)]`, Subparagraph `[200.01(1)(a)(i)]`, then Clause `(A)` and Subclause `(I)`. Optional Part (`[2]`) and Subpart (`[200]`) headings sit above Sections. Parents must exist and siblings must be contiguous: (1), (2), (3) and (a), (b), (c).
- The numbering scheme is configurable. `numbering: "cars"` (the default), `"legal"` (`1`, `1.1`, `1.1(a)`, `1.1(a)(i)`) or `"decimal"` (`1`, `1.1`, `1.1.1`, up to six levels) in `docengine.config.*` sets the workspace default. The same field in a document's front matter overrides it for that file. A custom scheme lists levels with `label`, `kind`, `joiner`, and optionally `digits`, `min`, `showLabel`, `pageBreak` and `indent`. `cars` and `legal` are presets of that same shape. See the README for the full grammar.
- `[200.01] # ZXAA Airport` gives a provision a title; the body follows on the next lines.
- `[[200.01(2)]]` links to a provision, `[[fig:key]]` to a figure, `[[other-doc#200.01(2)]]` to a provision of another document.
- `[^name]` and `[^name]: text` make footnotes.
- Figures: `![Caption](images/diagram.svg){#fig:diagram width=80%}`.

[`template-repo/AUTHORING.md`](../template-repo/AUTHORING.md) lists every feature.

## 6. Check and build

```sh
pnpm validate   # errors and warnings with file, line and column
pnpm build      # PDFs, manifest.json and upload-sheet.md in dist/
```

If `typst` is not on your `PATH`, run `pnpm exec docengine build --typst /path/to/typst`. Open the PDF in `dist/` and check the cover, the table of contents and the page breaks.

In VS Code, install the docengine extension for live diagnostics, completion, hover and go-to-definition on provision IDs, figure keys and footnotes.

## 7. Pull request and release flow

1. Create a branch, edit the document and bump `version` in the frontmatter (`docengine bump operations/departure-release minor` does this for you).
2. Open a pull request. CI validates, builds a preview PDF and comments with a provision and figure diff.
3. A reviewer approves and merges.
4. On merge, CI creates one GitHub Release per document whose version changed, tagged `operations/departure-release/v1.1`, with the PDF, its manifest entry and an upload sheet.
5. Whoever publishes documents uploads the PDF to your document system using the values in the upload sheet and ticks the box in the release body.

Set up the workflows as described in [docs/ci.md](ci.md). A copy of `template-repo/` already includes `action/examples/.github/`; otherwise copy that directory into the repo. Replace the placeholder `v1` with an actual released tag or commit SHA, and add `docengine-preview/` and `dist/` to `.gitignore`.

## 8. Rules worth remembering

- Never reuse a provision ID. To withdraw one, keep a tombstone: `[200.01(4)] [repealed] Withdrawn 2025-03-01.` It renders as "(4) Repealed. Withdrawn 2025-03-01." and keeps the numbering contiguous.
- Bump `version` whenever the text or an image changes, otherwise `check` fails the pull request.
- Set `draft: true` while a document is not ready; it is built for review but never released. This prevents accidental release on an unfinished policy.
