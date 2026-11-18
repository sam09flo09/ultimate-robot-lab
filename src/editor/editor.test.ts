// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountLevelEditor } from "./editor";
import { createFallbackRenderer } from "./fallbackRenderer";
import { newBlankWorld } from "./levelFile";

const buttons = (host: HTMLElement) => Array.from(host.querySelectorAll("button"));

describe("level editor (DOM smoke test)", () => {
  it("mounts, edits, undoes, emits debounced changes, tests, disposes", () => {
    vi.useFakeTimers();
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const onTest = vi.fn();
    const w = newBlankWorld();
    w.objects.push({ id: "obj1", shape: "disk", x: 0, y: 0, size: 100, color: "RED", movable: true, pickable: false });
    const ed = mountLevelEditor(host, { world: w, onChange, onTest }, createFallbackRenderer);
    expect(host.querySelector(".le-root")).not.toBeNull();
    expect(ed.getWorld().objects[0].id).toBe("obj1");

    // the input world is copied, not shared
    w.objects[0].x = 999;
    expect(ed.getWorld().objects[0].x).toBe(0);

    buttons(host).find((b) => b.textContent === "+ Add goal")!.click();
    expect(ed.getWorld().goals).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].goals).toHaveLength(1);

    // validation: reachZone with no zone is an error
    expect(host.querySelector(".le-issue.le-error")).not.toBeNull();

    const root = host.querySelector(".le-root") as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(ed.getWorld().goals).toHaveLength(0);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Z", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(ed.getWorld().goals).toHaveLength(1);

    buttons(host).find((b) => b.textContent?.includes("Test this level"))!.click();
    expect(onTest).toHaveBeenCalledTimes(1);

    ed.setWorld(newBlankWorld());
    expect(ed.getWorld().goals).toHaveLength(0);
    ed.dispose();
    expect(host.querySelector(".le-root")).toBeNull();
    vi.useRealTimers();
  });

  it("reorders goals and visitInOrder stops with undoable ▲/▼ buttons", () => {
    vi.useFakeTimers();
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const w = newBlankWorld();
    w.zones.push({ id: "zone1", kind: "rect", x: 0, y: 0, w: 200, h: 200, label: "A" }, { id: "zone2", kind: "circle", x: 500, y: 500, r: 100, label: "B" });
    w.goals = [{ type: "noWallHits" }, { type: "visitInOrder", zones: ["zone1", "zone2"] }];
    const ed = mountLevelEditor(host, { world: w, onChange, onTest: vi.fn() }, createFallbackRenderer);
    const btn = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

    Array.from(host.querySelectorAll<HTMLButtonElement>(".le-tab")).find((b) => b.textContent?.startsWith("Goals"))!.click();
    expect(btn("Move goal 1 up").disabled).toBe(true);
    expect(btn("Move goal 2 down").disabled).toBe(true);
    btn("Move goal 2 up").click();
    expect(ed.getWorld().goals.map((g) => g.type)).toEqual(["visitInOrder", "noWallHits"]);
    // keyboard users keep focus on the moved goal's button
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Move goal 1 down");
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);

    btn("Move stop 1 of goal 1 later").click();
    expect(ed.getWorld().goals[0]).toEqual({ type: "visitInOrder", zones: ["zone2", "zone1"] });

    const root = host.querySelector(".le-root") as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(ed.getWorld().goals[0]).toEqual({ type: "visitInOrder", zones: ["zone1", "zone2"] });
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(ed.getWorld().goals.map((g) => g.type)).toEqual(["noWallHits", "visitInOrder"]);
    ed.dispose();
    vi.useRealTimers();
  });

  it("zoom buttons change the renderer view and Fit restores it", () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    const host = document.createElement("div");
    document.body.append(host);
    const ed = mountLevelEditor(host, { world: newBlankWorld(), onChange: vi.fn(), onTest: vi.fn() }, createFallbackRenderer);
    const btn = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const label = () => host.querySelector(".le-zoom-label")!.textContent;
    expect(label()).toBe("100%");
    expect(btn("Zoom out").disabled).toBe(true);
    btn("Zoom in").click();
    expect(label()).toBe("150%");
    for (let i = 0; i < 10; i++) btn("Zoom in").click();
    expect(label()).toBe("600%");
    expect(btn("Zoom in").disabled).toBe(true);
    btn("Fit the whole field").click();
    expect(label()).toBe("100%");
    ed.dispose();
  });

  it("tolerates a renderer without setView", () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    const host = document.createElement("div");
    document.body.append(host);
    const ed = mountLevelEditor(host, { world: newBlankWorld(), onChange: vi.fn(), onTest: vi.fn() }, (c) => {
      const r = createFallbackRenderer(c);
      delete r.setView;
      return r;
    });
    expect((host.querySelector(".le-zoom") as HTMLElement).style.display).toBe("none");
    host.querySelector(".le-overlay")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    ed.dispose();
  });
});
