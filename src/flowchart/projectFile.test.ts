import { describe, expect, it } from "vitest";
import { parseFileText } from "../ui/files";
import { TEMPLATES } from "./chart";
import { generateFlowchart } from "./generate";

const known = (id: string) => id === "number-grid";
const project = (extra: Record<string, unknown>) => JSON.stringify({
  format: "robot-lab-project", version: 1, name: "Wall", python: "x", blocks: null, worldId: "number-grid", customWorld: null, savedAt: "", ...extra,
});

describe(".robolab files in flowchart mode", () => {
  it("round-trip: mode, chart and generated python survive", () => {
    const chart = TEMPLATES[1].make();
    const python = generateFlowchart(chart).code;
    const o = parseFileText(project({ mode: "flowchart", flowchart: chart, python }), known);
    expect(o.kind).toBe("project");
    if (o.kind !== "project") return;
    expect(o.project.mode).toBe("flowchart");
    expect(o.project.flowchart).toEqual(chart);
    expect(o.project.python).toBe(python);
    expect(o.warnings).toEqual([]);
  });
  it("an unreadable flowchart falls back to Python with a warning", () => {
    const o = parseFileText(project({ mode: "flowchart", flowchart: "<svg onload=alert(1)>" }), known);
    if (o.kind !== "project") throw new Error("kind");
    expect(o.project.mode).toBe("python");
    expect(o.project.flowchart).toBeUndefined();
    expect(o.warnings[0]).toMatch(/flowchart/);
  });
  it("blocks/python files carry no flowchart", () => {
    const o = parseFileText(project({ mode: "python", flowchart: TEMPLATES[0].make() }), known);
    if (o.kind !== "project") throw new Error("kind");
    expect(o.project.flowchart).toBeUndefined();
  });
});
