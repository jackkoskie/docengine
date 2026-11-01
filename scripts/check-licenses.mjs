// SPDX-License-Identifier: MPL-2.0
// Fails when an installed dependency uses a license on the deny list (GPL, AGPL, SSPL) or has an
// unknown license that is not explicitly allowed. Run with `pnpm licenses:check`.
import { execSync } from "node:child_process";

const DENY = [/^A?GPL/i, /^LGPL/i, /^SSPL/i, /^UNKNOWN$/i];
// Dev-only tooling with no machine-readable license (Microsoft binary used by `vsce package`; never shipped).
const ALLOW_UNKNOWN = new Set(["@vscode/vsce-sign", "@vscode/vsce-sign-win32-x64", "@vscode/vsce-sign-linux-x64", "@vscode/vsce-sign-darwin-x64", "@vscode/vsce-sign-darwin-arm64", "@vscode/vsce-sign-alpine-x64", "@vscode/vsce-sign-alpine-arm64", "@vscode/vsce-sign-linux-arm", "@vscode/vsce-sign-linux-arm64", "@vscode/vsce-sign-win32-arm64"]);

const raw = execSync("pnpm licenses list --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(raw);
const bad = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  // An SPDX "OR" expression is fine when at least one alternative is allowed.
  const alternatives = license.replace(/[()]/g, "").split(/\s+OR\s+/);
  const denied = alternatives.every((alt) => DENY.some((re) => re.test(alt.trim())));
  if (!denied) continue;
  for (const p of pkgs) {
    if (/^UNKNOWN$/i.test(license) && ALLOW_UNKNOWN.has(p.name)) continue;
    bad.push(`${p.name}@${(p.versions ?? []).join(",")}: ${license}`);
  }
}
if (bad.length) {
  console.error("Disallowed dependency licenses:\n" + bad.map((b) => "  " + b).join("\n"));
  process.exit(1);
}
console.log(`License check passed (${Object.values(byLicense).reduce((n, p) => n + p.length, 0)} packages).`);
