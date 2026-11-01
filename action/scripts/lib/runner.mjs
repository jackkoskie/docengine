// SPDX-License-Identifier: MPL-2.0
import { spawn } from "node:child_process";

/**
 * @typedef {{code: number, stdout: string, stderr: string}} CommandResult
 * @typedef {{cwd?: string, env?: Record<string,string|undefined>, stream?: boolean}} RunOptions
 */

/** Runs child processes. Never rejects on a non-zero exit code. */
export class NodeCommandRunner {
  /** @returns {Promise<CommandResult>} */
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        // Only package-manager shims (pnpm.cmd) need a shell on Windows. CI runs on Linux.
        shell: process.platform === "win32" && !["git", "gh", "node"].includes(command),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (options.stream) process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (options.stream) process.stderr.write(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }
}

/** Runs a command and throws when it fails. */
export async function runChecked(runner, command, args, options) {
  const result = await runner.run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`.trim());
  }
  return result;
}

/** A command prefix such as `pnpm exec docengine`. */
export class CommandLine {
  constructor(command, args = []) {
    this.command = command;
    this.args = args;
  }

  static parse(text) {
    const [command, ...args] = text.trim().split(/\s+/);
    if (!command) throw new Error("docengine command must not be empty");
    return new CommandLine(command, args);
  }
}
