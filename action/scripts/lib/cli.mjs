// SPDX-License-Identifier: MPL-2.0
import { DocumentRef } from "./documents.mjs";

/**
 * The only place that knows the docengine CLI contract used by CI:
 *   check --base <ref> --format github
 *   diff --base <ref> --format markdown|json
 *   changed --base <ref> --json        (array of {group, short, version, title?, draft?})
 *   release-notes <group>/<short> [--base <tag>]
 *   build --only-changed --base <ref>
 */
export class DocengineCli {
  constructor({ runner, commandLine, cwd }) {
    this.runner = runner;
    this.commandLine = commandLine;
    this.cwd = cwd;
  }

  #run(args, options = {}) {
    return this.runner.run(this.commandLine.command, [...this.commandLine.args, ...args], { cwd: this.cwd, ...options });
  }

  /** @returns {Promise<{code: number, output: string}>} */
  async check(base) {
    const r = await this.#run(["check", "--base", base, "--format", "github"], { stream: true });
    return { code: r.code, output: `${r.stdout}\n${r.stderr}` };
  }

  /** @returns {Promise<{code: number, output: string}>} */
  async build(base) {
    const r = await this.#run(["build", "--only-changed", "--base", base], { stream: true });
    return { code: r.code, output: `${r.stdout}\n${r.stderr}` };
  }

  /** @returns {Promise<{code: number, stdout: string}>} */
  async diff(base, format) {
    const r = await this.#run(["diff", "--base", base, "--format", format]);
    return { code: r.code, stdout: r.stdout };
  }

  /** Non-draft documents whose version changed. @returns {Promise<{ref: DocumentRef, title?: string}[]>} */
  async changed(base) {
    const r = await this.#run(["changed", "--base", base, "--json"]);
    if (r.code !== 0) throw new Error(`docengine changed failed: ${r.stderr || r.stdout}`);
    const raw = JSON.parse(r.stdout || "[]");
    const list = Array.isArray(raw) ? raw : (raw.documents ?? raw.changed ?? []);
    return list.filter((d) => d.draft !== true).map((d) => ({ ref: DocumentRef.fromObject(d), title: d.title }));
  }

  /** @returns {Promise<string>} */
  async releaseNotes(ref, baseTag) {
    const args = ["release-notes", ref.id, ...(baseTag ? ["--base", baseTag] : [])];
    const r = await this.#run(args);
    if (r.code !== 0) throw new Error(`docengine release-notes failed: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  }
}
