// SPDX-License-Identifier: MPL-2.0
import { Diagnostic } from "../model/diagnostic.js";
import type { Document } from "../model/document.js";
import { ProvisionId } from "../model/provision-id.js";

/**
 * Provision IDs present in the previous released version but absent now (published IDs are
 * persistent references). The caller supplies the previous IDs, e.g. from a git tag.
 */
export function findRemovedProvisionIds(previousIds: readonly string[], doc: Document): Diagnostic[] {
  return previousIds
    .filter((id) => !doc.hasProvision(id))
    .map((id) =>
      Diagnostic.warning(
        "removed-provision-id",
        `Provision [${ProvisionId.parse(id, doc.scheme).text}] existed in the previous version; repeal it with a tombstone instead of deleting it`,
        { line: 1, column: 1, length: 1 },
        doc.file,
      ),
    );
}
