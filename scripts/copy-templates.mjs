// SPDX-License-Identifier: MPL-2.0
// Copies the repo-level templates/ into packages/cli/templates so they ship with the npm package.
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "packages/cli/templates"), { recursive: true });
cpSync(join(root, "templates"), join(root, "packages/cli/templates"), { recursive: true });
console.log("templates copied");
