// SPDX-License-Identifier: MPL-2.0
/** Escapes a value for use inside a Typst string literal. */
export function typstString(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

const SPECIAL = /[\\#$*_`<>@\[\]~]/g;

/** Escapes plain text for Typst markup mode. */
export function escapeTypst(s: string): string {
  return s.replace(SPECIAL, (c) => "\\" + c).replace(/\/(?=[/])/g, "\\/");
}

/** Keeps a paragraph from being read as a heading, list or enumeration. */
export function escapeLead(s: string): string {
  return s.replace(/^(\s*)([=+\-\/])/, "$1\\$2").replace(/^(\s*\d+)\./, "$1\\.");
}
