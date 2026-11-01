// SPDX-License-Identifier: MPL-2.0
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ConfigError } from "@jackkoskie/docengine-core";
import type { Command, Invocation, OptionSpec, OptionValue } from "./command.js";
import type { Io } from "./services.js";

/** Holds the available commands. Later phases register more (fmt, new, watch, bump, diff). */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): this {
    if (this.commands.has(command.name)) throw new Error(`Command "${command.name}" is already registered`);
    this.commands.set(command.name, command);
    return this;
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  get all(): Command[] {
    return [...this.commands.values()];
  }
}

const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  cwd: { type: "string", description: "Project root (default: current directory)" },
  config: { type: "string", description: "Config file (default: docengine.config.ts|js|json)" },
  help: { type: "boolean", short: "h", description: "Show help" },
};

/** Parses argv, dispatches to the matching `Command` and returns the exit code. */
export class CommandRunner {
  constructor(
    private readonly registry: CommandRegistry,
    private readonly io: Io,
    private readonly defaultCwd: () => string = () => process.cwd(),
  ) {}

  async run(argv: string[]): Promise<number> {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, allowPositionals: true, options: this.parseOptions() });
    } catch (e) {
      this.io.err((e as Error).message);
      return 2;
    }
    const [name, ...positionals] = parsed.positionals;
    const values = parsed.values as Record<string, OptionValue>;
    if (values.help || !name) {
      this.io.out(this.help());
      return name || values.help ? 0 : 2;
    }
    const command = this.registry.get(name);
    if (!command) {
      this.io.err(`Unknown command "${name}"\n\n${this.help()}`);
      return 2;
    }
    const invocation: Invocation = {
      cwd: resolve(typeof values.cwd === "string" ? values.cwd : this.defaultCwd()),
      positionals,
      values,
      ...(typeof values.config === "string" ? { config: values.config } : {}),
    };
    try {
      return await command.run(invocation);
    } catch (e) {
      this.io.err(e instanceof ConfigError ? e.message : `error: ${(e as Error).message}`);
      return 1;
    }
  }

  private allOptions(): Record<string, OptionSpec> {
    const merged: Record<string, OptionSpec> = { ...GLOBAL_OPTIONS };
    for (const c of this.registry.all) Object.assign(merged, c.options);
    return merged;
  }

  private parseOptions() {
    return Object.fromEntries(
      Object.entries(this.allOptions()).map(([k, v]) => [k, { type: v.type, ...(v.short ? { short: v.short } : {}) }]),
    );
  }

  help(): string {
    const cmds = this.registry.all.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`).join("\n");
    const opts = Object.entries(this.allOptions())
      .map(([k, v]) => `  ${(v.short ? `-${v.short}, ` : "") + `--${k}`.padEnd(16)} ${v.description}`)
      .join("\n");
    return `docengine <command> [options] [paths...]\n\nCommands:\n${cmds}\n\nOptions:\n${opts}\n`;
  }
}
