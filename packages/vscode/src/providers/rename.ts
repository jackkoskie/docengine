// SPDX-License-Identifier: MPL-2.0
import { ProvisionId } from "@jackkoskie/docengine-core";
import { SymbolLocator, UsageFinder, type SymbolTarget } from "../index/symbols.js";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import type { Range, TextEdit } from "../types.js";

export class RenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenameError";
  }
}

export interface RenamePlan {
  edits: TextEdit[];
  /** Provision IDs (old names) or the figure key that change. */
  oldNames: string[];
  target: SymbolTarget;
}

export interface PreparedRename {
  range: Range;
  placeholder: string;
  target: SymbolTarget;
}

const FIG_KEY = /^[a-z0-9-]+$/;

/** Computes the edits for renaming a provision ID (and its nested provisions) or a figure key, across the workspace. Pure and synchronous. */
export class RenamePlanner {
  private readonly finder: UsageFinder;

  constructor(private readonly index: WorkspaceIndex) {
    this.finder = new UsageFinder(index);
  }

  plan(target: SymbolTarget, newName: string): RenamePlan {
    if (!target.resolved) throw new RenameError(`"${target.name}" does not exist, so it cannot be renamed.`);
    if (target.kind === "figure") return this.planFigure(target, newName);
    return this.planProvision(target, newName);
  }

  private planProvision(target: SymbolTarget, newName: string): RenamePlan {
    const owner = this.index.get(target.docFile)!;
    const scheme = owner.doc.scheme;
    const problems = ProvisionId.parse(newName, scheme).formProblems();
    if (problems.length) throw new RenameError(problems[0]!);
    const before = ProvisionId.parse(target.name, scheme);
    const after = ProvisionId.parse(newName, scheme);
    if (before.depth !== after.depth) {
      throw new RenameError(`${before.display} must stay a ${before.level.label}: "${newName}" is a ${after.level.label}.`);
    }
    const old = target.name;
    const rename = (name: string): string => newName + name.slice(old.length);

    const affected = this.finder.declarations(target, true);
    const oldNames = affected.map((a) => a.name);
    const clash = oldNames.map(rename).find((n) => !oldNames.includes(n) && owner.doc.hasProvision(n));
    if (clash) throw new RenameError(`[${clash}] already exists in ${owner.file}.`);

    const edits = [...affected, ...this.finder.references(target, true)].map((u) => ({
      file: u.file,
      range: u.nameRange,
      newText: rename(u.name),
    }));
    return { edits, oldNames, target };
  }

  private planFigure(target: SymbolTarget, newName: string): RenamePlan {
    if (!FIG_KEY.test(newName)) throw new RenameError("Figure keys must match [a-z0-9-]+.");
    const owner = this.index.get(target.docFile)!;
    if (newName !== target.name && owner.doc.findFigure(newName)) throw new RenameError(`Figure "${newName}" already exists in ${owner.file}.`);
    const edits = [...this.finder.declarations(target, false), ...this.finder.references(target, false)].map((u) => ({
      file: u.file,
      range: u.nameRange,
      newText: newName,
    }));
    return { edits, oldNames: [target.name], target };
  }
}

/** Source of provision IDs that exist in the last published version of a document. */
export interface PublishedIds {
  /** IDs present in the last published version, or undefined when none is known (no tag, no git). */
  idsFor(file: string, doc: { group: string; short: string }): Promise<{ ids: ReadonlySet<string>; version: string } | undefined>;
}

export interface RenameResult {
  edits: TextEdit[];
  /** Set when a renamed ID was in the last published version; the UI must ask the user to confirm. */
  warning?: string;
}

/** Rename entry point: prepares the range, plans the edits and flags published IDs. */
export class RenameService {
  private readonly locator: SymbolLocator;
  private readonly planner: RenamePlanner;

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly published: PublishedIds,
  ) {
    this.locator = new SymbolLocator(index);
    this.planner = new RenamePlanner(index);
  }

  prepare(file: string, line: number, char: number): PreparedRename | undefined {
    const target = this.locator.locate(file, line, char);
    if (!target || !target.resolved) return undefined;
    return { range: target.nameRange, placeholder: target.name, target };
  }

  async rename(file: string, line: number, char: number, newName: string): Promise<RenameResult> {
    const target = this.locator.locate(file, line, char);
    if (!target) throw new RenameError("Nothing to rename at this position.");
    const plan = this.planner.plan(target, newName);
    const owner = this.index.get(target.docFile)!;
    const published = await this.published.idsFor(owner.file, owner.doc);
    const hit = published ? plan.oldNames.filter((n) => published.ids.has(n)) : [];
    if (target.kind === "figure" || hit.length === 0) return { edits: plan.edits };

    const warning =
      `${hit.length === 1 ? `[${hit[0]}] exists` : `[${hit.join("], [")}] exist`} in the last published version (v${published!.version}) of "${owner.doc.short}". ` +
      `Published provision IDs are persistent references; renaming them can break citations elsewhere. Consider repealing the provision instead.`;
    return { warning, edits: plan.edits };
  }
}
