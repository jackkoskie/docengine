// SPDX-License-Identifier: MPL-2.0
import type { ProvisionId } from "../model/provision-id.js";
import type { DiagnosticCollector, Position } from "../model/diagnostic.js";
import { Figure, type FigureAlign, type FigurePlacement } from "../model/figure.js";

/** The caption may contain footnote references (`[^id]`). */
export const FIGURE_LINE = /^!\[((?:\[\^[^\[\]\s]+\]|[^\]])*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/;
const FIG_KEY = /^[a-z0-9-]+$/;

const pos = (line: number, column: number, length: number): Position => ({ line, column, length });

/** Creates numbered figures from image lines. Owns the running figure list. */
export class FigureParser {
  private readonly list: Figure[] = [];

  constructor(private readonly sink: DiagnosticCollector) {}

  get figures(): Figure[] {
    return [...this.list];
  }

  parse(match: RegExpExecArray, text: string, line: number, owner: ProvisionId): Figure {
    const caption = match[1]!;
    const path = match[2]!;
    const lead = text.length - text.trimStart().length;
    let key: string | undefined;
    let keyPosition: Position | undefined;
    let width: string | undefined;
    let align: FigureAlign | undefined;
    let placement: FigurePlacement | undefined;

    const attrs = match[3];
    if (attrs !== undefined) {
      const base = text.indexOf("{", text.indexOf("](")) + 2;
      const re = /\S+/g;
      let t: RegExpExecArray | null;
      while ((t = re.exec(attrs))) {
        const tok = t[0];
        const p = pos(line, base + t.index, tok.length);
        if (tok.startsWith("#")) {
          if (!tok.startsWith("#fig:")) {
            this.sink.error("invalid-figure-key", `Figure key "${tok}" must start with "#fig:"`, p);
            continue;
          }
          key = tok.slice(5);
          keyPosition = p;
          if (!FIG_KEY.test(key)) this.sink.error("invalid-figure-key", `Figure key "${key}" must match [a-z0-9-]+`, p);
          continue;
        }
        const eq = tok.indexOf("=");
        const name = eq > 0 ? tok.slice(0, eq) : tok;
        const value = eq > 0 ? tok.slice(eq + 1) : "";
        if (name === "width") {
          if (/^\d+(\.\d+)?(%|pt|mm|cm|in|em)$/.test(value)) width = value;
          else this.sink.warning("invalid-figure-attribute", `Figure width "${value}" must be a percent or length such as 80% or 8cm`, p);
        } else if (name === "align") {
          if (["left", "center", "right"].includes(value)) align = value as FigureAlign;
          else this.sink.warning("invalid-figure-attribute", `Figure align "${value}" must be left, center or right`, p);
        } else if (name === "placement") {
          if (["inline", "float"].includes(value)) placement = value as FigurePlacement;
          else this.sink.warning("invalid-figure-attribute", `Figure placement "${value}" must be inline or float`, p);
        } else {
          this.sink.warning("unknown-figure-attribute", `Unknown figure attribute "${tok}"`, p);
        }
      }
    }

    const figure = new Figure({
      ...(key !== undefined ? { key } : {}),
      ...(keyPosition ? { keyPosition } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(align !== undefined ? { align } : {}),
      ...(placement !== undefined ? { placement } : {}),
      caption,
      path,
      number: this.list.length + 1,
      provisionId: owner,
      position: pos(line, lead + 1, text.trim().length),
      pathPosition: pos(line, text.indexOf("](") + 3, path.length),
      line,
    });
    this.list.push(figure);
    return figure;
  }
}
