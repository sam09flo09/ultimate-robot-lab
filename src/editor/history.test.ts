import { describe, expect, it } from "vitest";
import { History } from "./history";

describe("History (undo/redo)", () => {
  it("undoes and redoes snapshots", () => {
    const h = new History({ n: 0 });
    expect(h.canUndo).toBe(false);
    h.record({ n: 1 });
    h.record({ n: 2 });
    expect(h.undo()).toEqual({ n: 1 });
    expect(h.undo()).toEqual({ n: 0 });
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual({ n: 1 });
    expect(h.redo()).toEqual({ n: 2 });
    expect(h.redo()).toBeNull();
  });
  it("ignores no-op records and drops the redo branch on a new change", () => {
    const h = new History({ n: 0 });
    expect(h.record({ n: 0 })).toBe(false);
    h.record({ n: 1 });
    h.undo();
    h.record({ n: 5 });
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual({ n: 0 });
  });
  it("snapshots are immune to later mutation", () => {
    const s = { list: [1] };
    const h = new History(s);
    s.list.push(2);
    h.record(s);
    const back = h.undo()!;
    expect(back.list).toEqual([1]);
    back.list.push(9);
    expect(h.redo()!.list).toEqual([1, 2]);
    expect(h.undo()!.list).toEqual([1]);
  });
  it("is bounded", () => {
    const h = new History(0, 5);
    for (let i = 1; i <= 20; i++) h.record(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(4);
    expect(h.current()).toBe(16);
  });
});
