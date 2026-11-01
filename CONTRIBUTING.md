# Contributing

Thanks for helping. By contributing you agree your work is licensed under the project's licenses: MPL-2.0 for the engine (see [LICENSE](LICENSE)) and MIT for `templates/` and `template-repo/`.

## Sign off your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. Every commit needs a `Signed-off-by` line matching the commit author:

```sh
git commit -s -m "Fix reference resolution"
```

This appends `Signed-off-by: Your Name <you@example.com>`. Forgot? Fix the last commit with `git commit --amend -s --no-edit`, or several with `git rebase --signoff <base>` and force-push your branch. The `DCO` workflow checks every non-merge commit in a pull request.

Optional alias: `git config --global alias.cs "commit -s"`, then `git cs -m "message"`. To avoid publishing an address, use your GitHub noreply email (Settings > Emails), e.g. `git config user.email "12345+username@users.noreply.github.com"`; it must match the commit author.

### Developer Certificate of Origin, Version 1.1

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## File headers

New source files start with `// SPDX-License-Identifier: MPL-2.0` (`MIT` under `templates/` and `template-repo/`). `node scripts/add-spdx-headers.mjs` adds missing headers and is safe to re-run.

## Development

See the Development section of the [README](README.md). Run `pnpm typecheck`, `pnpm test` and `pnpm licenses:check` before opening a pull request. That license check fails on GPL, AGPL, LGPL, SSPL, or an unknown license.
