# Policy repo template

Starter for a FIR (or any organisation) that wants to publish policy documents with docengine.

1. Copy this directory into a new repo.
2. In `package.json`, replace the `file:../packages/cli` path (valid only inside the engine repo) with the published `@jackkoskie/docengine` version, pinned exactly, set `packageManager` so the Action pins pnpm, and commit the lockfile.
3. Edit `docengine.config.json`: FIR name, footer, level labels, frontmatter extensions. For a logo, fonts, colours or a custom letterhead template see the engine README.
4. Replace `documents/operations/departure-release.md` (a sample for the fictional Exampleland FIR, including its logo as a keyed figure) with your own documents.
5. In `.github/workflows/*.yml`, replace the placeholder `v1` with an actual released tag or commit SHA, including `engine-ref` (the reusable workflows are provided by `jackkoskie/docengine`). Add `docengine-preview/` and `dist/` to `.gitignore`. The rest of the CI setup is in the engine's `docs/ci.md`.
6. Read [AUTHORING.md](AUTHORING.md).

```sh
pnpm install
pnpm validate
pnpm build   # needs the typst CLI on PATH, or `docengine build --typst <path>`
```
