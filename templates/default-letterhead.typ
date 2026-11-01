// SPDX-License-Identifier: MIT
// docengine default letterhead: neutral, no branding. Requires Typst >= 0.13 (CI uses 0.15.1).
// Variables are passed by the generated document via `#show: letterhead.with(...)`.
// Copy this file and point `branding.template` at it to restyle documents. `cover` and `toc-*`
// are only passed when the document has a cover page or a table of contents.

#let letterhead(
  fir-name: "Flight Information Region",
  logo: none,
  primary: rgb("#1f3a5f"),
  accent: rgb("#6b7c93"),
  font: "Libertinus Serif",
  footer-text: "",
  title: "",
  short: "",
  group: "",
  version: "",
  effective-date: "",
  effective-time: none,
  expiry-date: none,
  highlight-color: none,
  // Table of contents: `none` means no table of contents.
  toc-depth: none,
  toc-title: "Table of Contents",
  // Cover page content (from the cover template), or `none`.
  cover: none,
  draft: false,
  body,
) = {
  set document(title: title)
  set text(font: font, size: 11pt)
  set par(justify: true, leading: 0.65em)
  set highlight(fill: if highlight-color != none { highlight-color } else { rgb("#fffd11a1") })

  let page-header = {
    grid(
      columns: (auto, 1fr, auto),
      column-gutter: 0.8em,
      align: horizon,
      if logo != none { logo } else { [] },
      text(weight: "bold", fill: primary, size: 12pt)[#fir-name],
      text(fill: accent, size: 9pt)[#title],
    )
    v(-0.4em)
    line(length: 100%, stroke: 0.8pt + primary)
  }
  let footer-left = [#footer-text #if draft [ #h(0.5em) *DRAFT*]]
  // Front matter (table of contents after a cover) carries no page number.
  let front-footer = {
    set text(size: 8.5pt, fill: accent)
    line(length: 100%, stroke: 0.4pt + accent)
    v(-0.2em)
    footer-left
  }

  set page(
    paper: "us-letter",
    margin: (top: 3.2cm, bottom: 2.6cm, x: 2.5cm),
    header: page-header,
    footer: context {
      set text(size: 8.5pt, fill: accent)
      line(length: 100%, stroke: 0.4pt + accent)
      v(-0.2em)
      grid(
        columns: (1fr, auto),
        footer-left,
        [Version #version #sym.dot.c Page #counter(page).display() of #counter(page).final().first()],
      )
    },
  )

  show link: set text(fill: primary)
  // Headings are styled here; `provision` supplies the spacing and the keep-with-next block around them.
  show heading: it => {
    // Sizes are set by `provision`, which knows the absolute level.
    set text(weight: "bold", fill: primary)
    set par(justify: false)
    it.body
  }

  let contents = {
    // Entries come from each heading's `supplement` ("602.60  Title"), with dotted leaders.
    show outline.entry: it => {
      let entry = it.element
      link(entry.location(), block(above: if it.level == 1 { 0.9em } else { 0.45em }, below: 0pt, inset: (left: (it.level - 1) * 1.4em), {
        set par(justify: false)
        set text(weight: if it.level == 1 { "semibold" } else { "regular" })
        entry.supplement
        h(0.4em)
        box(width: 1fr, repeat(text(fill: accent)[.], gap: 0.3em))
        h(0.4em)
        it.page()
      }))
    }
    outline(title: none, depth: toc-depth)
  }
  let contents-heading = block(below: 1.2em, text(size: 20pt, weight: "bold", fill: primary)[#toc-title])

  if cover != none {
    // No header, footer or page number on the cover.
    page(header: none, footer: none, cover)
    if toc-depth != none {
      page(footer: front-footer)[#contents-heading #contents]
    }
    // Page numbering of the body starts at 1.
    counter(page).update(1)
  } else {
    // Title block
    block(below: 1.4em)[
      #text(size: 20pt, weight: "bold", fill: primary)[#title]
      #v(0.2em)
      #set text(size: 9.5pt, fill: accent)
      #group / #short #sym.dot.c Version #version #sym.dot.c Effective #effective-date#if effective-time != none [ #effective-time]
      #if expiry-date != none [ #sym.dot.c Expires #expiry-date]
    ]
    if toc-depth != none {
      contents-heading
      contents
      v(1em)
    }
  }

  body
}

/// One provision. `depth` is the level number in the document's numbering scheme.
/// `structural-heading` marks the scheme's heading levels (cars: depth <= 3, so `auto` keeps that).
/// Those levels, and any titled provision down to `heading-depth`, are headings that stay with the
/// text after them (`keep`: `auto` means "yes for headings"; pass `true`/`false` to force). Deeper
/// titles are run-in bold. Other provisions show a hanging label. `indent` is how many `2.2em` steps
/// that label sits in from the margin (`0` is flush).
/// `level-offset`: levels above the first heading level in the document that are never declared, so
/// the outline starts at 1. `italic-label`: Paragraph labels are italic.
/// `heading-format` placeholders: {level}, {id}, {title}. `show-label`: false prints the id alone (`2` rather than `Section 2`).
/// `whole`: do not split the provision across pages.

#let provision(
  id,
  depth,
  level-label: "Section",
  label: none,
  italic-label: false,
  show-label: true,
  indent: 0,
  title: none,
  repealed: false,
  keep: auto,
  heading-format: "{level} {id} \u{2014} {title}",
  heading-depth: 3,
  level-offset: 0,
  structural-heading: auto,
  whole: false,
  page-break: false,
  body,
) = {
  let structural = if structural-heading == auto { depth <= 3 } else { structural-heading }
  let is-heading = structural or (title != none and depth <= heading-depth)
  if page-break { pagebreak(weak: true) }
  // What a tombstone prints in place of its text.
  let text-body = if repealed [_Repealed._ #body] else { body }
  if is-heading {
    let level-name = if show-label { level-label } else { "" }
    let filled = heading-format.replace("{level}", level-name).replace("{id}", id)
    let text-with-ids = if show-label { filled } else { filled.replace(regex("^\\s+"), "") }
    let heading-text = if title == none {
      // No title: drop the placeholder and the separator in front of it.
      text-with-ids.replace(regex("[\\s\u{2014}\u{2013}:.\\-]*\\{title\\}"), "")
    } else {
      let pieces = text-with-ids.split("{title}")
      pieces.at(0) + title + pieces.slice(1).join("")
    }
    let named-id = if show-label [#level-label #id] else [#id]
    let toc-label = if depth <= 2 {
      if title != none [#named-id#h(0.8em)#title] else { named-id }
    } else if title != none [#id#h(0.8em)#title] else { named-id }
    let size = if depth == 1 { 15pt } else if depth == 2 { 13pt } else { 11.5pt }
    let spacing = if depth == 1 { (1.8em, 0.9em) } else if depth == 2 { (1.4em, 0.7em) } else { (1.1em, 0.5em) }
    block(
      sticky: if keep == auto { true } else { keep },
      above: spacing.at(0),
      below: spacing.at(1),
      heading(level: depth - level-offset, outlined: not (repealed and title == none), supplement: toc-label, text(size: size)[#heading-text]),
    )
    text-body
  } else {
    let shown = if label == none { [\[#id\]] } else if italic-label { emph(label) } else { label }
    let content = grid(
      columns: (2.6em, 1fr),
      column-gutter: 0.4em,
      text(size: 0.95em, shown),
      {
        if title != none { strong(title + [.]); [ ] }
        text-body
      },
    )
    let inset = indent * 2.2em
    if whole {
      // The provision cites a footnote. Typst only moves a footnote together with its reference when the
      // reference sits in an unbreakable block that is not wrapped in `pad`, hence `inset` here.
      block(breakable: false, sticky: keep == true, inset: (left: inset), content)
    } else {
      pad(left: inset, if keep == true { block(sticky: true, content) } else { content })
    }
  }
}
