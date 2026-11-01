// SPDX-License-Identifier: MPL-2.0
import { BumpCommand, FormatCommand, NewCommand, RenumberCommand, WatchCommand } from "./commands/authoring-commands.js";
import { BuildCommand } from "./commands/build-command.js";
import { ChangedCommand, DiffCommand, ReleaseNotesCommand } from "./commands/change-commands.js";
import { SchemaCommand } from "./commands/schema-command.js";
import { CheckCommand, ValidateCommand } from "./commands/validate-command.js";
import { createNodeServices } from "./node/adapters.js";
import { CommandRegistry, CommandRunner } from "./registry.js";
import type { Io, Services } from "./services.js";

/** Registers the built-in commands. Later phases add their command classes here. */
export function createDefaultRegistry(services: Services): CommandRegistry {
  return new CommandRegistry()
    .register(new ValidateCommand(services))
    .register(new BuildCommand(services))
    .register(new SchemaCommand(services))
    .register(new CheckCommand(services))
    .register(new FormatCommand(services))
    .register(new RenumberCommand(services))
    .register(new NewCommand(services))
    .register(new BumpCommand(services))
    .register(new WatchCommand(services))
    .register(new DiffCommand(services))
    .register(new ChangedCommand(services))
    .register(new ReleaseNotesCommand(services));
}

/** Entry point used by the binary and by tests; pass `services` to inject fakes. */
export async function main(argv: string[], io: Io, services: Services = createNodeServices(io)): Promise<number> {
  return new CommandRunner(createDefaultRegistry(services), io).run(argv);
}
