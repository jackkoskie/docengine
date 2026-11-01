# CI

Two things live here: the CI that a docs repo gets from docengine (reusable workflows plus a composite Action), and the CI of the docengine repo itself.

## Release model in one paragraph

Every release is a pull request. A PR gets an always-current PDF preview and a provision and figure diff. Merging to `main` is the only way a release happens: for each changed non-draft document one GitHub Release is created with tag `<group>/<short>/v<version>`, carrying the PDF, its manifest entry and an upload sheet. Staff upload the PDF to the DMS by hand and tick the "Uploaded to DMS" checkbox in the release body. No secrets are needed.

## What is in this repo

| Path | Purpose |
| --- | --- |
| `action/action.yml` | Composite Action. Modes: `check`, `preview`, `release`. |
| `action/scripts/` | Helper scripts (plain ESM, no build step, small classes with injected ports). `main.mjs` is the composition root. |
| `action/test/` | `node --test` tests for the scripts (fakes, plus a real local git remote for the previews branch). |
| `.github/workflows/pr-preview.yml` | Reusable. Untrusted build, read-only. |
| `.github/workflows/pr-preview-publish.yml` | Reusable. Trusted publish (previews branch, comment, status). |
| `.github/workflows/pr-preview-cleanup.yml` | Reusable. Deletes `pr-<n>/` when a PR closes. |
| `.github/workflows/pr-preview-prune.yml` | Reusable. Weekly prune of closed PRs. |
| `.github/workflows/release.yml` | Reusable. One release per changed document. |
| `.github/workflows/ci.yml`, `release-engine.yml` | CI and a manual release stub for the engine itself. |
| `action/examples/.github/` | Caller workflows and `PULL_REQUEST_TEMPLATE.md`, ready to copy into a docs repo or `template-repo/`. |

## Setting up a docs repo

1. Pin docengine in `package.json` and commit `pnpm-lock.yaml`. The Action runs `pnpm install --frozen-lockfile` and then `pnpm exec docengine`, so a commit fully determines its build. Set `packageManager` in `package.json` so pnpm's version is pinned too.
2. Copy `action/examples/.github/` into the repo's `.github/` (five workflows and the PR template). `template-repo/` already contains the same files, so skip the copy when you started from it. Replace the placeholder `v1` with an actual release tag or commit SHA in both the workflow references and `engine-ref`, never a moving branch.
3. Add `docengine-preview/` and `dist/` to `.gitignore`.
4. Create the first PR. The `previews` branch is created automatically as an orphan branch on the first publish.
5. Apply the branch protection below.

The engine repository must be readable by the docs repo's workflows (public, or an internal or private repo with Actions access granted under Settings, Actions, General).

### Caller workflows

`pr-preview.yml` (untrusted build):

```yaml
name: PR preview
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  preview:
    uses: jackkoskie/docengine/.github/workflows/pr-preview.yml@v1
    with:
      engine-repository: jackkoskie/docengine
      engine-ref: v1
    permissions:
      contents: read
```

`pr-preview-publish.yml` (trusted publish; the workflow name in `workflows:` must equal the name above):

```yaml
name: PR preview publish
on:
  workflow_run:
    workflows: ["PR preview"]
    types: [completed]
permissions:
  contents: read
jobs:
  publish:
    if: github.event.workflow_run.event == 'pull_request'
    uses: jackkoskie/docengine/.github/workflows/pr-preview-publish.yml@v1
    with:
      engine-repository: jackkoskie/docengine
      engine-ref: v1
    permissions:
      contents: write
      pull-requests: write
      statuses: write
      actions: read
```

`pr-preview-cleanup.yml`, `pr-preview-prune.yml` and `release.yml` are in `action/examples/.github/workflows/`. The release caller triggers on `push` to `main`, the cleanup caller on `pull_request_target: [closed]`, and the prune caller on a weekly `schedule`.

Do not reuse the caller's concurrency group name (`preview-<pr>`) inside the reusable workflow. The reusable build job uses `docengine-build-<pr>`, because identical names in caller and callee deadlock.

## Action reference

Use it directly with `uses: jackkoskie/docengine/action@v1`, or through the reusable workflows (which check it out next to the docs repo).

### Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `mode` | required | `check`, `preview` or `release`. |
| `working-directory` | `.` | Docs repo root (`package.json`, `pnpm-lock.yaml`). |
| `base-ref` | empty | Comparison ref. Empty means the PR merge base on `pull_request`, `github.event.before` on `push`, else `HEAD~1`. |
| `node-version` | `22` | Node version. |
| `pnpm-version` | empty | Empty reads `packageManager`. |
| `typst-version` | `0.15.1` | Pinned Typst release, downloaded from the official GitHub release. The templates need Typst 0.13 or newer; 0.15.1 is the pinned default. |
| `typst-sha256` | empty | Optional archive checksum, verified when set. |
| `docengine-command` | `pnpm exec docengine` | How to run the lockfile-pinned CLI. |
| `output-dir` | `dist` | Build output directory. |
| `report-dir` | `docengine-preview` | Preview mode report folder. |
| `pr-number` | PR number | Recorded in the preview report. |
| `head-sha` | PR head SHA | Recorded in the preview report. |
| `github-token` | empty | Release mode only. Needs `contents: write` and `pull-requests: read`. |

### Outputs

| Output | Modes | Meaning |
| --- | --- | --- |
| `base-ref` | all | Resolved comparison base. |
| `status` | check, preview | `success` or `failure`. |
| `has-changes` | preview | `true` if at least one document was built. |
| `changed-documents` | preview, release | JSON array of `group/short`. |
| `report-path` | preview | Absolute path of the report folder. |
| `release-tags` | release | JSON array of tags created in this run. |

### Modes

- `check`: `docengine check --base <ref> --format github`. Emits file, line and column annotations. Fails on validation errors and on the version-bump rule (body changed, `version` not).
- `preview`: runs check, then `build --only-changed`, then `diff` (markdown and json). Writes `docengine-preview/` with `report.json`, `pdfs/<group>/<short>.pdf`, `diff.md`, `diff.json`. Always writes the report, even on failure, and exits non-zero when the check or build failed. It has no write access and no secrets.
- `release`: see below.

## PR preview

1. **Build (untrusted).** Runs on `pull_request` with a read-only token and no secrets. Fork PRs are safe because nothing here can write. It uploads artifacts `docengine-preview` (report and PDFs, consumed by the publish job) and `docengine-dist` (full build output, backup for reviewers). Superseded runs for the same PR are cancelled.
2. **Publish (trusted).** A separate `workflow_run` job runs in the base repository with write access. It never checks out or executes PR code. It treats the artifact as data: document names must be safe slugs, files must start with `%PDF-`, size is capped, text is length-limited and escaped, and the head SHA comes from the trusted event. The PR number inside the artifact is only a hint and is verified: the PR must be open and its head must equal the run's head SHA. If the PR has moved on, the run is dropped and the newer run reports.
3. **Previews branch.** PDFs go to the orphan `previews` branch at `pr-<n>/<group>/<short>.pdf`, together with `pr-<n>/meta.json` (head SHA, build time, documents). The `pr-<n>/` folder is replaced on every successful build. Pushes retry on conflict.
4. **Sticky comment.** One comment, identified by the hidden marker `<!-- docengine-preview -->` and by being authored by a bot, updated in place. It shows per document a link, version and draft flag, then the commit SHA, build time, provision and figure diff, and validation warnings. Preview links use `https://github.com/<repo>/raw/previews/pr-<n>/<group>/<short>.pdf`, so private repos require a signed-in reader.
5. **Failure.** The comment is updated with the errors, and the last good PDFs from `meta.json` are shown under "Last good preview (out of date)". They are never presented as current.
6. **`preview-current` status.** The publish job sets this commit status on the PR head: `success` only when `meta.json` on the previews branch has the PR head SHA, `failure` when the build failed. A new push leaves the new head without the status, so it stays pending until its own publish finishes. Reviewers cannot approve against a stale PDF.
7. **Cleanup.** On PR close (merged or not) `pr-<n>/` is deleted and the comment is replaced with a closed notice. A weekly job deletes any `pr-*` folder whose PR is not open.

## Release on merge

On push to `main` the release job resolves the base (the push's previous head), asks `docengine changed` for non-draft documents whose version changed, and for each one without an existing tag:

- builds once (`build --only-changed`),
- takes the previous tag `<group>/<short>/v*` (highest by version) and runs `docengine release-notes <group>/<short> --base <tag>`,
- creates a draft release `<group>/<short>/v<version>` targeting the merge commit, uploads the PDF, `manifest-entry.json` (that document's manifest entry) and `upload-sheet.md` (group slug, short, version, effective date, expiry date, SHA-256, commit), then publishes it,
- writes the body: release notes, a link to the merged PR, and an unchecked `- [ ] Uploaded to DMS`.

It is idempotent. Existing tags are skipped. A draft left behind by an interrupted run is deleted and recreated. Re-running the workflow is safe. Releases are serialized by a concurrency group without cancellation. The unchecked releases are the DMS upload queue. `draft: true` documents are built for review and never released.

## Permissions per job

| Job | Trigger | Permissions | Secrets |
| --- | --- | --- | --- |
| Preview build | `pull_request` | `contents: read` | none |
| Preview publish | `workflow_run` | `contents: write` (previews branch), `pull-requests: write` (comment), `statuses: write` (`preview-current`), `actions: read` (artifact) | none |
| Preview cleanup | `pull_request_target: closed` | `contents: write`, `pull-requests: write` | none |
| Preview prune | `schedule` | `contents: write`, `pull-requests: read` | none |
| Release | `push` to `main` | `contents: write` (tags, releases), `pull-requests: read` | none |

Everything uses the automatic `GITHUB_TOKEN`. No repository secrets are needed for normal operation. In Settings, Actions, General, workflow permissions can stay on the read-only default because each job requests what it needs. If the repo disallows "Allow GitHub Actions to create and approve pull requests" that is fine, nothing here creates PRs. Only the engine's manual release stub uses a secret (`NPM_TOKEN`), and only when publishing to npm.

## Branch protection for `main`

Settings, Branches (or Rulesets), rule for `main`:

- Require a pull request before merging, with at least 1 approval (more for policy owners), dismiss stale approvals on new commits, require review from code owners if you use `CODEOWNERS`.
- Require status checks to pass, branch up to date before merging, with these required checks:
  - `preview / Build changed documents` (the build job: validation, version-bump rule, PDF build; the exact name is `<caller job id> / <job name>`)
  - `preview-current` (the commit status from the publish job)
- Do not allow bypassing the above, and restrict who can push to `main` (no direct pushes, so no release without a PR).
- Block force pushes and deletions.
- Add a rule or ruleset that restricts pushes to the `previews` branch to GitHub Actions only (and never require reviews there), since only CI writes to it.
- Protect release tags: a tag ruleset on `*/*/v*` that blocks deletion and updates.

Squash merging is recommended so one PR is one commit on `main`.

## PR template

`action/examples/.github/PULL_REQUEST_TEMPLATE.md` (also at `.github/PULL_REQUEST_TEMPLATE.md` here) asks for the reason for change, the effective date, the documents changed, and a checklist.

## Engine repo CI

`ci.yml` on push and PR: `pnpm install --frozen-lockfile`, install pinned Typst, `typecheck`, `test`, `node --test action/test/*.test.mjs`, `build`, golden render tests (`pnpm test:golden`: generated Typst compared with `fixtures/golden/*.typ`, plus PDF text checks when `typst` and `pdftotext` are installed; refresh with `UPDATE_GOLDEN=1 pnpm test:golden`), a check that `schema/` is up to date (`pnpm schema` then `git diff --exit-code -- schema/`), and `actionlint`.

`release-engine.yml` is manual (`workflow_dispatch`) and does nothing until triggered. It checks that package versions match the requested version, runs typecheck, tests and build, then either dry-runs or runs `pnpm -r publish --provenance` (needs `NPM_TOKEN`), builds the `.vsix` only if `packages/vscode/package.json` exists, and optionally creates a GitHub Release with the `.vsix` attached.

## Linting and testing

- `node --test "action/test/*.test.mjs"` runs the script tests. They pass locally.
- The YAML was parsed with a YAML parser and `install-typst.sh` with `bash -n`. `actionlint` is not available through npm and was **not run locally**. It runs in `ci.yml`. To run it yourself: `actionlint` (https://github.com/rhysd/actionlint), including `actionlint action/examples/.github/workflows/*.yml`.
- Not exercised against real GitHub: the reusable workflow wiring, `workflow_run` artifact download, status and comment API calls on real PRs, and `gh release create`. Do a dry run in a throwaway repo before relying on it.

## CLI contract assumed by CI

All of it is isolated in `action/scripts/lib/cli.mjs` and `report.mjs`.

- `docengine check --base <ref> --format github`: exit non-zero on errors (and when nothing matched); stdout is `::error|warning file=,line=,col=::message` (an info finding is `::notice`).
- `docengine diff --base <ref> --format markdown|json`: covers all changed documents. See the README for the JSON shape.
- `docengine changed --base <ref> --json`: a JSON array of `{ key, group, short, title, file, version, previousVersion, effectiveDate, tag, draft }`. Drafts are left out unless `--include-drafts` is set; the Action does not set it. The Action also accepts a `{ documents }` or `{ changed }` wrapper, and reads `group`, `short`, `version`, `title` and `draft`.
- `docengine release-notes <group>/<short> [--base <tag>]`: Markdown on stdout, ending with `Pull request: {{PR_URL}}`. Without `--base` it compares with the last release tag and prints `Initial release.` when there is none.
- `docengine build --only-changed --base <ref>`: writes `dist/<group>/<short>-v<version>.pdf`, `dist/manifest.json` and `dist/upload-sheet.md`.
- `dist/manifest.json`: `{ schemaVersion: 1, generator: { name: "docengine", version }, gitCommit, documents: [...] }`. Each document has `group`, `short`, `title`, `version`, `effectiveDate`, `expiryDate` (string or null), `description`, `draft`, `extensions`, `source`, `pdf` (`{ filename, path, sha256 }` or null), `gitCommit`, `changed` (boolean or null), `provisions` and `figures`. The PDF hash is `pdf.sha256` and the commit is `gitCommit`. The Action finds an entry by `group`, `short` and `version`, and also accepts a bare array or `{ entries: [] }`.
