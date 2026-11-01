// SPDX-License-Identifier: MPL-2.0
import type { Scheduler } from "../ports.js";

/** Collapses bursts of calls into one trailing call after `delayMs` of quiet. */
export class Debouncer {
  private pending: { cancel(): void } | undefined;

  constructor(
    private readonly scheduler: Scheduler,
    private readonly delayMs: () => number,
    private readonly action: () => void,
  ) {}

  trigger(): void {
    this.pending?.cancel();
    this.pending = this.scheduler.schedule(() => {
      this.pending = undefined;
      this.action();
    }, this.delayMs());
  }

  /** Run now (for save) and drop any scheduled run. */
  flush(): void {
    this.pending?.cancel();
    this.pending = undefined;
    this.action();
  }

  dispose(): void {
    this.pending?.cancel();
    this.pending = undefined;
  }
}
