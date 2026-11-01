# Third-party licenses

Checked with `pnpm licenses list --json` and enforced in CI by `pnpm licenses:check` (fails on GPL, AGPL, LGPL, SSPL or unknown licenses; the only exemption is the dev-only `@vscode/vsce-sign` binaries, whose license metadata is missing). This is a summary, not legal advice.

## Direct runtime dependencies

| Package | Used by | License |
| --- | --- | --- |
| `arktype` | `@jackkoskie/docengine-core` | MIT |
| `yaml` | `@jackkoskie/docengine-core` | ISC |
| `jiti` | `docengine` (CLI) | MIT |
| `tinyglobby` | `docengine` (CLI) | MIT |

Their transitive runtime dependencies (`@ark/schema`, `@ark/util`, `arkregex`, `fdir`, `picomatch`) are MIT. All of these are permissive and compatible with distributing under MPL-2.0. The VS Code extension bundles `@jackkoskie/docengine-core` and these dependencies into one file; their license notices remain in the packages' own license files.

## Direct development dependencies (not distributed)

| Package | License |
| --- | --- |
| `typescript` | Apache-2.0 |
| `vitest` | MIT |
| `@types/node`, `@types/vscode` | MIT |
| `esbuild` | MIT |
| `@vscode/vsce` | MIT |

## Whole dependency tree (including dev tooling)

MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-3.0 (SPDX data only), Python-2.0 (`argparse`), Artistic-2.0 (`istextorbinary` family), WTFPL (`@azu/style-format`), MPL-2.0 (`lightningcss`, a Vite/Vitest dev dependency), and dual-licensed expressions such as `(MIT OR WTFPL)`. There is no GPL, AGPL or SSPL. Two packages report `Unknown`: `@vscode/vsce-sign` and its platform binary, used only by `vsce package` at build time and not shipped.

## Typst

[Typst](https://typst.app) (Apache-2.0) is used as an external program: the engine writes `.typ` files and runs the `typst` CLI if it is on `PATH`. It is not bundled or linked, so its license places no obligation on docengine's distribution. The GitHub Action downloads a pinned Typst release at run time.

## docengine's own templates

`templates/` and `template-repo/` are MIT (see their `LICENSE` files); the `docengine` npm package ships a copy of `templates/`.
