// SPDX-License-Identifier: MPL-2.0
const LINE = /^::(error|warning|notice)(?: ([^:]*))?::(.*)$/;

function decode(value) {
  return value.replace(/%0A/gi, "\n").replace(/%0D/gi, "\r").replace(/%3A/gi, ":").replace(/%2C/gi, ",").replace(/%25/g, "%");
}

/** Parses GitHub workflow-command annotations (`--format github`) into plain objects. */
export class DiagnosticParser {
  /** @returns {{severity: string, file: string, line: number, col: number, message: string}[]} */
  parse(text) {
    const result = [];
    for (const raw of text.split(/\r?\n/)) {
      const match = LINE.exec(raw.trim());
      if (!match) continue;
      const props = {};
      for (const pair of (match[2] ?? "").split(",")) {
        const eq = pair.indexOf("=");
        if (eq > 0) props[pair.slice(0, eq).trim()] = decode(pair.slice(eq + 1));
      }
      result.push({
        severity: match[1],
        file: props.file ?? "",
        line: Number(props.line) || 0,
        col: Number(props.col ?? props.column) || 0,
        message: decode(match[3]),
      });
    }
    return result;
  }
}
