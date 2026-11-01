#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
import { main } from "./main.js";

const code = await main(process.argv.slice(2), {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
});
process.exitCode = code;
