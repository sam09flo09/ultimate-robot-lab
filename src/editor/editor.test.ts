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
});
