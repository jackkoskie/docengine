// SPDX-License-Identifier: MPL-2.0
import { NodeFiles } from "../scripts/lib/files.mjs";

export const files = new NodeFiles();

/** Records calls and answers from a script of [predicate, result] rules. */
export class FakeRunner {
  constructor(rules = []) {
    this.rules = rules;
    this.calls = [];
  }

  async run(command, args, options = {}) {
    this.calls.push({ command, args, cwd: options.cwd });
    const line = [command, ...args].join(" ");
    for (const [match, result] of this.rules) {
      if (typeof match === "string" ? line.includes(match) : match.test(line)) {
        return { code: 0, stdout: "", stderr: "", ...(typeof result === "function" ? result(line) : result) };
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  }

  lines() {
    return this.calls.map((c) => [c.command, ...c.args].join(" "));
  }
}

export class MemoryOutputs {
  values = {};
  async set(name, value) {
    this.values[name] = value;
  }
}

export const PDF = Buffer.from("%PDF-1.7\nfake");
