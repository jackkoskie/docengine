// SPDX-License-Identifier: MPL-2.0
import type { Provision, Figure } from "@jackkoskie/docengine-core";
import { FootnoteLocator } from "../index/footnotes.js";
import { ProvisionText, type IndexedDocument } from "../index/indexed-document.js";
import { SymbolLocator, type SymbolTarget } from "../index/symbols.js";
import type { WorkspaceIndex } from "../index/workspace-index.js";
import type { AssetUriResolver } from "../ports.js";
import type { Range } from "../types.js";

export interface HoverDto {
  /** Markdown body. May contain an image link for figure thumbnails. */
  markdown: string;
  range: Range;
}

/** Hover for `[[100.2.a]]`, `[[fig:key]]`, cross-document references and `[^footnote]` references. */
export class HoverProvider {
  private readonly locator: SymbolLocator;
  private readonly footnotes = new FootnoteLocator();

  constructor(
    private readonly index: WorkspaceIndex,
    private readonly assets: AssetUriResolver,
    private readonly figureLabel: () => string = () => "Figure",
  ) {
    this.locator = new SymbolLocator(index);
  }

  provide(file: string, line: number, char: number): HoverDto | undefined {
    const note = this.footnote(file, line, char);
    if (note) return note;
    const target = this.locator.locate(file, line, char);
    const from = this.index.get(file);
    if (!target || !from || target.origin !== "reference") return undefined;
    const owner = this.index.get(target.docFile);
    if (!owner) return { markdown: `Document \`${target.docName ?? ""}\` not found.`, range: target.fullRange };
    const parts: string[] = [];
    const body = target.kind === "figure" ? this.figure(owner, target) : this.provision(owner, target);
    if (!body) return { markdown: `Unresolved reference \`${target.name}\`.`, range: target.fullRange };
    parts.push(body);
    if (owner.file !== from.file) parts.push(`*${owner.label}* · \`${owner.doc.group}/${owner.doc.short}\``);
    return { markdown: parts.join("\n\n---\n\n"), range: target.fullRange };
  }

  private footnote(file: string, line: number, char: number): HoverDto | undefined {
    const indexed = this.index.get(file);
    const target = indexed && this.footnotes.locate(indexed, line, char);
    if (!indexed || !target || target.origin !== "reference") return undefined;
    const def = this.footnotes.definition(indexed, target.id);
    const markdown = def ? `**Footnote [^${def.id}]**\n\n${def.text || "*(empty)*"}` : `Footnote \`[^${target.id}]\` is not defined.`;
    return { markdown, range: target.fullRange };
  }

  private provision(owner: IndexedDocument, target: SymbolTarget): string | undefined {
    const provision: Provision | undefined = owner.doc.findProvision(target.name);
    if (!provision) return undefined;
    const header = `**${provision.id.display}**${provision.repealed ? " (repealed)" : ""}`;
    return `${header}\n\n${ProvisionText.full(provision) || "*(no text)*"}`;
  }

  private figure(owner: IndexedDocument, target: SymbolTarget): string | undefined {
    const figure: Figure | undefined = owner.doc.findFigure(target.name);
    if (!figure) return undefined;
    const header = `**${this.figureLabel()} ${figure.number}**: ${figure.caption}`;
    const source = figure.sourcePath(owner.file);
    const image = figure.format ? `![${figure.caption.replaceAll("]", "")}](${this.assets.uriFor(source)})` : "";
    return image ? `${header}\n\n${image}` : header;
  }
}
