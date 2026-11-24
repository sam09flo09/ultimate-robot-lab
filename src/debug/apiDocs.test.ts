import { describe, it, expect, beforeAll } from "vitest";
import { API_OBJECTS, TOP_LEVEL, CONSTANTS } from "../runtime/names";
import { ALL_DOCS, METHOD_DOCS, docFor, membersOf } from "./apiDocs";
import { createPythonRunner } from "../runtime/index";
import { loadSkulpt, fakeController, recorder } from "../runtime/testkit";
import { nameAt, callAt } from "./pythonAssist";

beforeAll(() => loadSkulpt());

describe("apiDocs", () => {
  it("covers every object, method, top-level name and constant in names.ts", () => {
    const missing: string[] = [];
    for (const o of API_OBJECTS) {
      if (!docFor(o.path)) missing.push(o.path);
      for (const meth of Object.keys(o.methods)) if (!docFor(o.path + "." + meth)) missing.push(o.path + "." + meth);
    }
    for (const n of TOP_LEVEL) if (!docFor(n)) missing.push(n);
    for (const c of CONSTANTS) if (!docFor(c)) missing.push(c);
    expect(missing).toEqual([]);
  });

  it("documents nothing the runtime lacks", () => {
    const known = new Set<string>([...TOP_LEVEL, ...CONSTANTS]);
    for (const o of API_OBJECTS) { known.add(o.path); for (const k of Object.keys(o.methods)) known.add(o.path + "." + k); }
    expect(ALL_DOCS.map((d) => d.name).filter((n) => !known.has(n))).toEqual([]);
  });

  it("every entry has a description and an example that uses it", () => {
    for (const d of ALL_DOCS) {
      expect(d.description.length, d.name).toBeGreaterThan(5);
      expect(d.example, d.name).toContain(d.name.split(".").pop()!);
    }
  });

  it("membersOf lists methods and sub-objects", () => {
    expect(membersOf("drivetrain").map((d) => d.name)).toContain("drivetrain.drive_for");
    expect(membersOf("brain").map((d) => d.name).sort()).toEqual(["brain.screen", "brain.timer"]);
    expect(membersOf("brain.screen").length).toBe(3);
  });

  it("every method example actually runs in the runtime", async () => {
    const body = METHOD_DOCS.flatMap((d) => d.example.split("\n")).map((l) => "    " + l);
    const src = ["def main():", "    d = 1", ...body, "", "start(main)", ""].join("\n");
    const { ctl } = fakeController({ bumperAfter: 0 });
    const { opts } = recorder(ctl);
    const res = await createPythonRunner(opts).run(src);
    expect(res.status === "error" ? res.error.raw : res.status).toBe("finished");
  });
});

describe("editor helpers", () => {
  it("nameAt finds the dotted name under the pointer", () => {
    const line = "    drivetrain.drive_for(FORWARD, 200, MM)";
    expect(nameAt(line, line.indexOf("drive_for") + 3)?.name).toBe("drivetrain.drive_for");
    expect(nameAt(line, 6)?.name).toBe("drivetrain");
    expect(nameAt("brain.screen.print(1)", 8)?.name).toBe("brain.screen");
    expect(nameAt("x = 200", 5)).toBeNull();
  });
  it("callAt finds the call and argument under the cursor", () => {
    const line = "drivetrain.drive_for(FORWARD, 2";
    expect(callAt(line, line.length)).toEqual({ name: "drivetrain.drive_for", arg: 1, parenAt: 20 });
    expect(callAt("wait(len(xs), ", 14)).toMatchObject({ name: "wait", arg: 1 });
    expect(callAt("print('a, (b', x", 16)).toMatchObject({ name: "print", arg: 1 });
    expect(callAt("x = 1", 5)).toBeNull();
  });
});
