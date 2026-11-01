// SPDX-License-Identifier: MPL-2.0
import type { ImageFormat } from "../config/config.js";

/** Resolves an asset path relative to the Markdown file's location (forward slashes). */
export function resolveAssetPath(docFile: string | undefined, rel: string): string {
  const base = (docFile ?? "").replaceAll("\\", "/");
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const parts = (dir ? dir.split("/") : []).concat(rel.replaceAll("\\", "/").split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") {
      if (out.length === 0 && p === "") out.push("");
      continue;
    }
    if (p === ".." && out.length && out[out.length - 1] !== ".." && out[out.length - 1] !== "") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export function imageFormat(path: string): ImageFormat | null {
  const ext = path.toLowerCase().split("?")[0]!.split(".").pop();
  if (ext === "svg") return "svg";
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  return null;
}
