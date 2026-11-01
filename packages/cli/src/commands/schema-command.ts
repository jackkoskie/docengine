// SPDX-License-Identifier: MPL-2.0
import { dirname } from "node:path";
import { toJsonSchema } from "@jackkoskie/docengine-core";
import { Command, type Invocation, type OptionSpec } from "../command.js";
import type { Services } from "../services.js";
import { ProjectLoader, absolute, toPosix } from "../workspace.js";

/** `docengine schema [--out file]` */
export class SchemaCommand extends Command {
  readonly name = "schema";
  readonly summary = "Print the frontmatter JSON Schema";
  override readonly options: Readonly<Record<string, OptionSpec>> = {
    out: { type: "string", description: "Write the schema to this file instead of stdout" },
  };

  constructor(private readonly services: Services) {
    super();
  }

  async run(inv: Invocation): Promise<number> {
    const { io, fs } = this.services;
    const project = await new ProjectLoader(this.services).load(inv.cwd, inv.config);
    const json = JSON.stringify(toJsonSchema(project.config.extensions), null, 2) + "\n";
    const out = inv.values.out;
    if (typeof out === "string") {
      const dest = absolute(inv.cwd, out);
      fs.mkdirp(dirname(dest));
      fs.writeText(dest, json);
      io.out(`wrote ${toPosix(dest)}`);
    } else {
      io.out(json.trimEnd());
    }
    return 0;
  }
}
