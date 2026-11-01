// SPDX-License-Identifier: MPL-2.0
import { imageDimensions } from "./images.js";
import type { FileInfo, FileSystem, Hasher, Host } from "./ports.js";

/** `Host` backed by a `FileSystem` rooted at the repo root. */
export class FileSystemHost implements Host {
  constructor(
    private readonly fs: FileSystem,
    private readonly hasher: Hasher,
    private readonly root: string,
  ) {}

  inspectFile(path: string): FileInfo | undefined {
    const abs = `${this.root.replace(/[\\/]+$/, "")}/${path}`;
    if (!this.fs.isFile(abs)) return undefined;
    try {
      const bytes = this.fs.readBytes(abs);
      const dims = imageDimensions(bytes);
      return { size: bytes.length, sha256: this.hasher.sha256(bytes), ...(dims ?? {}) };
    } catch {
      return undefined;
    }
  }
}
