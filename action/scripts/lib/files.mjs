// SPDX-License-Identifier: MPL-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Thin filesystem port. Tests use real temporary directories. */
export class NodeFiles {
  read(file) {
    return fs.readFile(file, "utf8");
  }

  readBytes(file) {
    return fs.readFile(file);
  }

  async write(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }

  async exists(file) {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  async copy(from, to) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }

  remove(target) {
    return fs.rm(target, { recursive: true, force: true });
  }

  async size(file) {
    return (await fs.stat(file)).size;
  }

  /** @returns {Promise<{name: string, isDirectory: boolean}[]>} */
  async list(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  makeTempDir(prefix) {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
  }
}
