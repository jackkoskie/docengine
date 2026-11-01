// SPDX-License-Identifier: MIT
// docengine default cover page: neutral, no branding. Requires Typst >= 0.13 (CI uses 0.15.1).
// Called from the generated document as `cover: cover(...)` when a document has a cover page.
// Copy this file and point `cover.template` at it to restyle the cover; keep the parameter names.

#let cover(
  fir-name: "Flight Information Region",
  logo: none,
  primary: rgb("#1f3a5f"),
  accent: rgb("#6b7c93"),
  font: "Libertinus Serif",
  title: "",
  subtitle: none,
  version: "",
  effective-date: "",
  effective-time: none,
  notice: none,
  draft: false,
) = {
  set text(font: font, size: 12pt)
  set par(justify: false)
  block(width: 100%, height: 100%, {
    align(center, {
      v(1.5cm)
      if logo != none {
        logo
        v(0.8cm)
      }
      text(size: 14pt, fill: accent, tracking: 0.06em, upper(fir-name))
      v(2cm)
      line(length: 60%, stroke: 0.8pt + primary)
      v(0.9cm)
      text(size: 30pt, weight: "bold", fill: primary, title)
      if subtitle != none {
        v(0.5cm)
        text(size: 16pt, fill: accent, subtitle)
      }
      v(0.9cm)
      line(length: 60%, stroke: 0.8pt + primary)
      v(1cm)
      [Version #version]
      linebreak()
      [Effective #effective-date#if effective-time != none [ #effective-time]]
      if draft {
        v(0.6cm)
        text(weight: "bold", fill: accent, tracking: 0.1em)[DRAFT]
      }
    })
    if notice != none {
      place(bottom + center, text(size: 11pt, weight: "bold", fill: primary, notice))
    }
  })
}
