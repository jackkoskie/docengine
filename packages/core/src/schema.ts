// SPDX-License-Identifier: MPL-2.0
import { type } from "arktype";

const SLUG = "/^[a-z0-9]+(?:-[a-z0-9]+)*$/";
const DATE = "/^\\d{4}-\\d{2}-\\d{2}$/";
const TIME = "/^([01]\\d|2[0-3])[0-5]\\dZ$/";

/** Base frontmatter definition (arktype). Extensions are merged in by the FIR's config. */
export const baseDefinition = {
  title: "string > 0",
  short: SLUG,
  group: SLUG,
  version: "/^\\d+\\.\\d+$/",
  effectiveDate: DATE,
  "expiryDate?": DATE,
  "description?": "string",
  "draft?": "boolean",
  "version-note?": "'editorial'",
  "cover?": "boolean",
  "toc?": "boolean",
  "subtitle?": "string > 0",
  "effectiveTime?": TIME,
  "notice?": "string > 0",
  /** Preset name or `{ scheme: "custom", levels }`. Validated by the numbering rules, not arktype. */
  "numbering?": "unknown",
} as const;

export const BASE_KEYS: readonly string[] = Object.keys(baseDefinition).map((k) => k.replace(/\?$/, ""));

export const baseSchema = type(baseDefinition);
export type BaseFrontmatter = typeof baseSchema.infer;

export interface SchemaProblem {
  /** Top-level frontmatter key the problem belongs to, when known. */
  key?: string;
  message: string;
}

/** Base frontmatter schema plus FIR-supplied extension fields. */
export class FrontmatterSchema {
  private readonly compiled: typeof baseSchema;
  readonly knownKeys: ReadonlySet<string>;

  constructor(private readonly extensions: Record<string, unknown> = {}) {
    this.compiled =
      Object.keys(extensions).length === 0
        ? baseSchema
        : (type({ ...baseDefinition, ...(extensions as object) } as typeof baseDefinition) as typeof baseSchema);
    this.knownKeys = new Set([...BASE_KEYS, ...Object.keys(extensions).map((k) => k.replace(/\?$/, ""))]);
  }

  /** Returns an empty list when `data` is valid. */
  check(data: unknown): SchemaProblem[] {
    const result = this.compiled(data);
    if (!(result instanceof type.errors)) return [];
    return [...(result as unknown as Iterable<{ path: PropertyKey[]; message: string }>)].map((e) => ({
      ...(typeof e.path[0] === "string" ? { key: e.path[0] } : {}),
      message: e.message,
    }));
  }

  /** JSON Schema (draft 2020-12) for editors; undeclared keys are rejected. */
  toJsonSchema(): Record<string, unknown> {
    const json = this.compiled.toJsonSchema() as Record<string, unknown>;
    return { ...json, title: "docengine document frontmatter", additionalProperties: false };
  }
}

export function createSchema(extensions: Record<string, unknown> = {}) {
  return new FrontmatterSchema(extensions);
}

export function extensionKeys(extensions: Record<string, unknown> = {}): string[] {
  return Object.keys(extensions).map((k) => k.replace(/\?$/, ""));
}

export function toJsonSchema(extensions: Record<string, unknown> = {}): Record<string, unknown> {
  return new FrontmatterSchema(extensions).toJsonSchema();
}

export const schema = {
  definition: baseDefinition,
  base: baseSchema,
  create: createSchema,
  toJsonSchema,
} as const;
