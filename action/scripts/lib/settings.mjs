// SPDX-License-Identifier: MPL-2.0
import path from "node:path";

/** Typed view over the environment the action passes to the scripts. */
export class Settings {
  constructor(env) {
    this.env = env;
  }

  #get(name, fallback = "") {
    return this.env[name] ?? fallback;
  }

  require(name) {
    const value = this.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
  }

  get cwd() {
    return path.resolve(this.#get("DOCENGINE_CWD", "."));
  }
  get commandLine() {
    return this.#get("DOCENGINE_COMMAND", "pnpm exec docengine");
  }
  get base() {
    return this.#get("DOCENGINE_BASE");
  }
  get outDir() {
    return path.resolve(this.cwd, this.#get("DOCENGINE_OUT_DIR", "dist"));
  }
  get reportDir() {
    return path.resolve(this.cwd, this.#get("DOCENGINE_REPORT_DIR", ".docengine-preview"));
  }
  get repository() {
    return this.#get("GITHUB_REPOSITORY");
  }
  get token() {
    return this.#get("GH_TOKEN") || this.#get("GITHUB_TOKEN");
  }
  get sha() {
    return this.#get("GITHUB_SHA");
  }
  get previewsBranch() {
    return this.#get("PREVIEWS_BRANCH", "previews");
  }
  get runUrl() {
    if (this.env.RUN_URL) return this.env.RUN_URL;
    const server = this.#get("GITHUB_SERVER_URL", "https://github.com");
    const id = this.#get("GITHUB_RUN_ID");
    return id ? `${server}/${this.repository}/actions/runs/${id}` : "";
  }
  get remoteUrl() {
    const server = this.#get("GITHUB_SERVER_URL", "https://github.com").replace("https://", "");
    return `https://x-access-token:${this.token}@${server}/${this.repository}.git`;
  }
}
