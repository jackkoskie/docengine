// SPDX-License-Identifier: MPL-2.0
// Copies the repo-level LICENSE and NOTICE into a package directory so they ship in the npm tarball.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
for (const name of ["LICENSE", "NOTICE"]) {
  copyFileSync(join(root, name), join(process.cwd(), name));
}
