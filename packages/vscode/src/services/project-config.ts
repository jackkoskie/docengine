// SPDX-License-Identifier: MPL-2.0
import { type ResolvedConfig, resolveConfig, ConfigError, extensionKeys } from "@jackkoskie/docengine-core";
import type { ConfigFiles } from "../ports.js";

export interface ProjectConfig {
  config: ResolvedConfig;
  /**
   * False when a `.ts`/`.js` config exists that the extension cannot execute. Extension frontmatter
   * fields are then unknown, so "unknown key" findings are suppressed.
   */
  extensionsKnown: boolean;
  /** File the config came from, or null for defaults. */
  source: string | null;
  /** Human-readable problem, if the config could not be used. */
  problem?: string;
}

/** Loads `docengine.config.*` for a project root. JSON configs are fully supported; executable configs fall back to defaults. */
export class ProjectConfigLoader {
  constructor(private readonly files: ConfigFiles) {}

  load(): ProjectConfig {
    const names = this.files.existing();
    const json = names.find((n) => n.endsWith(".json"));
    const executable = names.find((n) => !n.endsWith(".json"));
    if (executable && !json) {
      return { config: resolveConfig({}), extensionsKnown: false, source: executable, problem: `${executable} is not executed by the editor extension; using default settings. Add a docengine.config.json to share settings with the extension.` };
    }
    if (!json) return { config: resolveConfig({}), extensionsKnown: true, source: null };
    try {
      const raw: unknown = JSON.parse(this.files.read(json) ?? "{}");
      return { config: resolveConfig(raw), extensionsKnown: true, source: json };
    } catch (e) {
      const problem = e instanceof ConfigError ? e.message : `${json}: ${(e as Error).message}`;
      return { config: resolveConfig({}), extensionsKnown: false, source: json, problem };
    }
  }

  static extensionFieldNames(config: ResolvedConfig): string[] {
    return extensionKeys(config.extensions);
  }
}
