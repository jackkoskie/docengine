// SPDX-License-Identifier: MPL-2.0
import type { GitClient } from "../ports.js";
import { DocVersion } from "./version.js";

export interface ReleaseTag {
  name: string;
  version: DocVersion;
}

/** Knows the tag convention `<group>/<short>/v<version>` and finds a document's latest release. */
export class ReleaseTags {
  constructor(private readonly git: GitClient) {}

  static tagName(group: string, short: string, version: string): string {
    return `${group}/${short}/v${version}`;
  }

  /** The highest-versioned release tag of a document, or null. */
  latest(cwd: string, group: string, short: string): ReleaseTag | null {
    const prefix = `${group}/${short}/v`;
    let best: ReleaseTag | null = null;
    for (const name of this.git.listTags(cwd, prefix)) {
      if (!name.startsWith(prefix)) continue;
      const version = DocVersion.parse(name.slice(prefix.length));
      if (version && (!best || version.compare(best.version) > 0)) best = { name, version };
    }
    return best;
  }
}
