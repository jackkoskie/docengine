// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("extension bundle", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [resolve(pkg, "scripts/build.mjs")], { cwd: pkg, stdio: "pipe" });
  }, 60_000);

  it("builds a single CommonJS file that exports activate/deactivate and keeps vscode external", () => {
    const out = resolve(pkg, "dist/extension.cjs");
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(10_000);
    const code = readFileSync(out, "utf8");
    expect(code).toContain('require("vscode")');
    expect(code).not.toMatch(/require\(["']@docengine\/core["']\)/);

    const fakeVscode = { CompletionItemKind: {}, SymbolKind: {}, DiagnosticSeverity: {} }; // only what is touched at module load
    const mod = { exports: {} as Record<string, unknown> };
    const req = (id: string) => (id === "vscode" ? fakeVscode : require(id));
    // eslint-disable-next-line no-new-func
    new Function("module", "exports", "require", code)(mod, mod.exports, req);
    expect(typeof mod.exports.activate).toBe("function");
    expect(typeof mod.exports.deactivate).toBe("function");
  });

  it("declares what vsce needs", () => {
    const json = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf8"));
    expect(json.engines.vscode).toMatch(/^\^1\./);
    expect(json.publisher).toBeTruthy();
    expect(json.main).toBe("./dist/extension.cjs");
    expect(existsSync(resolve(pkg, ".vscodeignore"))).toBe(true);
    for (const c of json.contributes.commands) expect(c.command).toMatch(/^docengine\./);
    for (const s of json.contributes.snippets) expect(existsSync(resolve(pkg, s.path))).toBe(true);
  });
});
