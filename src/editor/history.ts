/** Snapshot undo/redo stack. States are stored as JSON strings, so stored snapshots can't be mutated. */
export class History<T> {
  private stack: string[] = [];
  private index = -1;

  constructor(initial: T, private readonly limit = 200) {
    this.reset(initial);
  }

  /** Forget everything; `state` becomes the only snapshot. */
  reset(state: T): void {
    this.stack = [JSON.stringify(state)];
    this.index = 0;
  }

  /** Record a new state after a change. Identical-to-current states are ignored. Returns true if recorded. */
  record(state: T): boolean {
    const s = JSON.stringify(state);
    if (s === this.stack[this.index]) return false;
    this.stack.length = this.index + 1; // drop the redo branch
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.splice(0, this.stack.length - this.limit);
    this.index = this.stack.length - 1;
    return true;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.stack.length - 1; }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.index--;
    return JSON.parse(this.stack[this.index]) as T;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.index++;
    return JSON.parse(this.stack[this.index]) as T;
  }

  /** Copy of the current snapshot. */
  current(): T {
    return JSON.parse(this.stack[this.index]) as T;
  }
}
