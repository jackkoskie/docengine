// SPDX-License-Identifier: MPL-2.0
/** Minimal glob matcher for the document pattern: supports `**`, `*`, `?` and `{a,b}`. Paths use forward slashes. */
export class GlobMatcher {
  private readonly regex: RegExp;

  constructor(glob: string) {
    this.regex = new RegExp(`^${GlobMatcher.translate(glob.replaceAll("\\", "/").replace(/^\.\//, ""))}$`);
  }

  matches(path: string): boolean {
    return this.regex.test(path.replaceAll("\\", "/"));
  }

  private static translate(glob: string): string {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i]!;
      if (c === "*") {
        if (glob[i + 1] === "*") {
          const slash = glob[i + 2] === "/";
          out += slash ? "(?:.*/)?" : ".*";
          i += slash ? 2 : 1;
        } else out += "[^/]*";
      } else if (c === "?") out += "[^/]";
      else if (c === "{") out += "(?:";
      else if (c === "}") out += ")";
      else if (c === ",") out += glob.slice(0, i).lastIndexOf("{") > glob.slice(0, i).lastIndexOf("}") ? "|" : ",";
      else out += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
    return out;
  }
}
