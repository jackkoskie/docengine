# Invalid fixtures

Each file demonstrates invalid input under the CARs-style ID grammar. Diagnostic codes in `code` form exist today; the others are descriptions of the expected problem (use the engine's code for it).

| File | Expected diagnostics |
| --- | --- |
| `no-frontmatter.md` | Missing frontmatter. |
| `bad-frontmatter.md` | `frontmatter-schema`, `invalid-date`, `unknown-frontmatter-key` (bad `short`, non-string `version`, impossible date, expiry before effective, unknown key). |
| `bad-ids.md` | `sibling-order` (`[602.60(3)]` skips (2)); `invalid-provision-id` (`[602.60(a)]` letter where a subsection number is required; `[12]` is not a part/subpart/section); `missing-parent` (`[602.60(4)(a)]` and `[602.60(1)(a)(i)]`); `duplicate-provision-id` (`[602.60(1)]`). |
| `bad-refs.md` | Two `unresolved-reference` (`[[602.60(9)]]`, `[[fig:nope]]` and the cross-document `[[other-doc#602.60(1)]]` when `other-doc` is missing) and one `invalid-reference` (`[[not an id]]`). Exactly three diagnostics in the existing test. |
| `bad-figures.md` | Empty caption, duplicate figure key, figure without key (warning), unsupported image format, missing image file, references to those figures. |
| `bad-depth.md` | `[602.60(1)(a)(i)(A)(I)(1)]` goes beyond the subclause level (max depth). |
| `bad-section-order.md` | `[602.05]` after `[602.10]` is not ascending; `[602.05]` repeated is a duplicate. |
| `bad-paragraphs.md` | Paragraphs start at (b) and skip (c); subparagraph starts at (ii); clause starts at (B): not contiguous from the first label. |
| `bad-no-parent.md` | `[602.60(1)]` has no section `602.60`. |
| `bad-subpart.md` | Section `603.01` under declared subpart `[602]`; `602.02` after `603.01` is also out of order. |
| `bad-part.md` | Section `700.01` follows declared Subpart 601 without declaring Subpart 700; Part `[7]` and Subpart `[602]` declared after content that belongs before them, and Subpart 602 belongs to Part 6 but follows Part 7. |
| `bad-footnotes.md` | Undefined footnote `[^missing]`, duplicate definition `[^ok]`, unused definition `[^unused]` (warning). |
| `bad-legacy-ids.md` | Old-scheme IDs `[100]`, `[100.1]`, `[100.2.a]` are invalid; `[602.60(1)(c)]` has missing parents. |
| `bad-tombstones.md` | Duplicate ID `[602.60(2)]` (a tombstone's number is still taken). |
