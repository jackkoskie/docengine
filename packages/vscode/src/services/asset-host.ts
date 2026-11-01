// SPDX-License-Identifier: MPL-2.0
import { type FileInfo, type Hasher, type Host, imageDimensions } from "@jackkoskie/docengine-core";
import type { AssetReader } from "../ports.js";

/** `Host` for validation: figure file size, hash and pixel size, cached by mtime so typing stays cheap. */
export class CachingAssetHost implements Host {
  private readonly cache = new Map<string, { key: string; info: FileInfo | undefined }>();

  constructor(
    private readonly assets: AssetReader,
    private readonly hasher: Hasher,
  ) {}

  inspectFile(path: string): FileInfo | undefined {
    const stat = this.assets.stat(path);
    if (!stat) {
      this.cache.delete(path);
      return undefined;
    }
    const key = `${stat.size}:${stat.mtimeMs}`;
    const hit = this.cache.get(path);
    if (hit?.key === key) return hit.info;
    let info: FileInfo | undefined;
    try {
      const bytes = this.assets.read(path);
      const dims = imageDimensions(bytes);
      info = { size: bytes.length, sha256: this.hasher.sha256(bytes), ...(dims ?? {}) };
    } catch {
      info = undefined;
    }
    this.cache.set(path, { key, info });
    return info;
  }
}
