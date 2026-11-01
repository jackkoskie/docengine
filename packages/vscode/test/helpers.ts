// SPDX-License-Identifier: MPL-2.0
import { WorkspaceIndex } from "../src/index/workspace-index.js";

export const POLICY = `---
title: Departure Release (DR) Authority
short: departure-release
group: operations
version: "1.0"
effectiveDate: 2023-06-06
description: When departure release is granted.
---

[1] # Example Part

[100] # General

[100.01] # ZXAA Airport

[100.01(1)] Departure release (DR) is automatically granted once confirmation of the active runway is communicated.

[100.01(2)] Should ZXAA_TWR utilize a non-active runway for departure, they must obtain a DR from the position covering ZXAA_APP. See [[fig:rvsm]].

![RVSM profile](images/rvsm.svg){#fig:rvsm width=80%}

[100.01(2)(a)] A nested provision.

[200.01] # All other ZXEX Airports

[200.01(1)] DR requests are processed as described in [[100.01(1)]] and in see Section 100.01(1) below.
`;

export const OTHER = `---
title: Relief Procedures
short: relief
group: operations
version: "2.1"
effectiveDate: 2024-01-01
---

[100.01] # Relief

[100.01(1)] Cross reference to [[departure-release#100.01(2)]] and [[departure-release#fig:rvsm]].
`;

export function indexOf(files: Record<string, string>): WorkspaceIndex {
  const index = new WorkspaceIndex();
  for (const [file, text] of Object.entries(files)) index.update(file, text);
  return index;
}

export const POLICY_FILE = "documents/operations/departure-release.md";
export const OTHER_FILE = "documents/operations/relief.md";

export function twoDocs(): WorkspaceIndex {
  return indexOf({ [POLICY_FILE]: POLICY, [OTHER_FILE]: OTHER });
}

/** 0-based line of the first line containing `needle`. */
export function lineOf(text: string, needle: string): number {
  return text.split("\n").findIndex((l) => l.includes(needle));
}

/** 0-based character offset of `needle` on its first line, plus `plus`. */
export function colOf(text: string, needle: string, plus = 0): number {
  const line = text.split("\n").find((l) => l.includes(needle))!;
  return line.indexOf(needle) + plus;
}
