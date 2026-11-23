import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFile } from "../core/modules";
import type { World } from "../core/types";
import { loadSkulpt } from "../runtime/testkit";
import { getBuiltIn } from "../activities/builtins";
import { gradeFileText, gradeProject, htmlToText } from "./grade";
import { csvCell, guardCell, toCsv, toTsv, tsvCell } from "./export";

beforeAll(() => loadSkulpt());

const prog = (...lines: string[]) => lines.join("\n") + "\n";

/** A small custom challenge: drive from the bottom into a zone near the top. */
const WORLD: World = {
  id: "custom", name: "Reach the pad", width: 2000, height: 2000, background: "grid",
  start: { x: 0, y: -600, heading: 0 }, walls: [], floor: [], objects: [],
  zones: [{ id: "pad", kind: "circle", x: 0, y: 400, r: 150, label: "Pad" }],
  goals: [{ type: "reachZone", zone: "pad" }, { type: "noWallHits" }],
  version: 1,
};

function project(python: string, over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    format: "robot-lab-project", version: 1, name: "Ana's robot", mode: "python", python, blocks: null,
    worldId: "custom", customWorld: WORLD, savedAt: "2026-11-20T15:04:05.000Z", activity: null, ...over,
  };
}
const fileText = (p: unknown) => JSON.stringify(p);

describe("gradeProject", () => {
  it("passes a program that completes the challenge", async () => {
    const r = await gradeProject(project(prog("def main():", "    drivetrain.drive_for(FORWARD, 1000, MM)", "", "start(main)")), "ana.robolab");
    expect(r.status).toBe("finished");
    expect(r.goalsTotal).toBe(2);
    expect(r.goalsPassed).toBe(2);
    expect(r.verdict).toBe("passed");
    expect(r.steps).toBe(1);
    expect(r.finalPose!.y).toBeGreaterThan(300);
    expect(r.worldName).toBe("Reach the pad");
  });

  it("reports a program that runs but misses a goal", async () => {
    const r = await gradeProject(project(prog("def main():", "    drivetrain.drive_for(FORWARD, 200, MM)", "    print('done')", "", "start(main)")), "ben.robolab");
    expect(r.status).toBe("finished");
    expect(r.goalsPassed).toBe(1);
    expect(r.verdict).toBe("notpassed");
    expect(r.goals.find((g) => !g.passed)!.text).toMatch(/Pad/);
    expect(r.output).toEqual(["done"]);
  });

  it("reports a syntax error with its type and line", async () => {
    const r = await gradeProject(project(prog("def main():", "    drivetrain.drive_for(FORWARD, 200, MM", "", "start(main)")), "c.robolab");
    expect(r.status).toBe("error");
    expect(r.statusText).toMatch(/SyntaxError on line \d/);
    expect(r.errorText).not.toMatch(/<|&lt;/);
    expect(r.verdict).toBe("error");
  });

  it("times out an infinite loop on the wall-clock cap", async () => {
    const t = Date.now();
    const r = await gradeProject(project(prog("def main():", "    while True:", "        x = 1", "", "start(main)")), "d.robolab", { wallMs: 800 });
    expect(r.status).toBe("timeout");
    expect(r.statusText).toBe("Timed out");
    expect(Date.now() - t).toBeLessThan(4000);
  });

  it("times out a robot that never stops on the sim-time cap", async () => {
    const r = await gradeProject(project(prog("def main():", "    while True:", "        wait(1, SECONDS)", "", "start(main)")), "e.robolab", { simSeconds: 20, wallMs: 10000 });
    expect(r.status).toBe("timeout");
    expect(r.errorText).toMatch(/20 s of robot time/);
  });

  it("handles busy polling loops (drive + sensor check, no wait)", async () => {
    const r = await gradeProject(project(prog(
      "def main():", "    drivetrain.drive(FORWARD)", "    while location.position(Y, MM) < 400:", "        pass",
      "    drivetrain.stop()", "", "start(main)")), "poll.robolab", { wallMs: 10000 });
    expect(r.status).toBe("finished");
    expect(r.finalPose!.y).toBeGreaterThanOrEqual(400);
    expect(r.finalPose!.y).toBeLessThan(560);
    expect(r.verdict).toBe("passed");
  });

  it("notices a missing start(main)", async () => {
    const r = await gradeProject(project(prog("def main():", "    drivetrain.drive_for(FORWARD, 1000, MM)")), "f.robolab");
    expect(r.status).toBe("nostart");
    expect(r.verdict).toBe("notpassed");
    expect(r.goalsPassed).toBeLessThan(r.goalsTotal);
  });

  it("re-checks the current activity step against the submitted code, not the saved claim", async () => {
    const a = getBuiltIn("a05-loops")!;
    const text = fileText({
      ...project(prog("def main():", "    drivetrain.drive_for(FORWARD, 400, MM)", "", "start(main)")),
      worldId: "sketch-pad", customWorld: null,
      activity: { activity: a, progress: { activityId: a.id, stepIndex: 1, completed: ["long-way", "for-square"], hintsShown: {}, quizAnswers: {}, startedAt: "", updatedAt: "" } },
    });
    const r = await gradeFileText("g.robolab", text);
    expect(r.status).toBe("finished");
    expect(r.activity).not.toBeNull();
    expect(r.activity!.title).toBe(a.title);
    expect(r.activity!.stepsCompleted).toBe(2);
    expect(r.activity!.currentClaimed).toBe(true);
    expect(r.activity!.recheck.passed).toBe(false);
    expect(r.activity!.recheck.items.find((i) => /for/.test(i.label))!.passed).toBe(false);
    expect(r.verdict).toBe("notpassed");
  });

  it("an activity step whose code really passes is verified", async () => {
    const a = getBuiltIn("a05-loops")!;
    const text = fileText({
      ...project(prog("def main():", "    pen.move(DOWN)", "    for i in range(4):", "        drivetrain.drive_for(FORWARD, 400, MM)",
        "        drivetrain.turn_for(RIGHT, 90, DEGREES)", "    pen.move(UP)", "", "start(main)")),
      worldId: "sketch-pad", customWorld: null,
      activity: { activity: a, progress: { activityId: a.id, stepIndex: 1, completed: ["long-way"], hintsShown: {}, quizAnswers: {}, startedAt: "", updatedAt: "" } },
    });
    const r = await gradeFileText("h.robolab", text);
    expect(r.activity!.recheck.passed).toBe(true);
    expect(r.activity!.currentClaimed).toBe(false);
  });

  it("turns bad files into error rows, never throws", async () => {
    for (const t of ["", "not json", "[]", "{}", JSON.stringify({ format: "robot-lab-project", version: 9 }), "null"]) {
      const r = await gradeFileText("bad.robolab", t);
      expect(r.status).toBe("invalid");
      expect(r.verdict).toBe("error");
      expect(r.errorText.length).toBeGreaterThan(5);
    }
    const lvl = await gradeFileText("l.robolab-level", JSON.stringify({ format: "robot-lab-level", version: 1, world: WORLD }));
    expect(lvl.status).toBe("invalid");
    expect(lvl.errorText).toMatch(/challenge/);
  });

  it("keeps hostile names as plain data", async () => {
    const evil = `<img src=x onerror=alert(1)>`;
    const r = await gradeFileText(`${evil}.robolab`, fileText(project(prog("start(main)"), { name: evil })));
    expect(r.projectName).toBe(evil); // rendered with textContent by the table (see table.test.ts)
    expect(r.fileName).toBe(`${evil}.robolab`);
  });

  it("htmlToText strips tags and decodes entities", () => {
    expect(htmlToText("<b>Line 2: NameError</b><br>Use <code>x &lt; 3</code> &amp; y")).toBe("Line 2: NameError Use x < 3 & y");
  });
});

describe("export", () => {
  it("escapes CSV cells", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(-900)).toBe("-900"); // numbers are not guarded
  });
  it("guards against formula injection", () => {
    for (const s of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(guardCell(s).startsWith("'")).toBe(true);
    expect(csvCell('=cmd|"/c calc"!A1')).toBe(`"'=cmd|""/c calc""!A1"`);
    expect(tsvCell("=1+1")).toBe("'=1+1");
    expect(tsvCell("a\tb\nc")).toBe("a b c");
  });
  it("writes one row per file", async () => {
    const ok = await gradeProject(project(prog("def main():", "    drivetrain.drive_for(FORWARD, 1000, MM)", "", "start(main)"), { name: "=evil()" }), "a,b.robolab");
    const bad = await gradeFileText("bad.json", "nope");
    const csv = toCsv([ok, bad]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"a,b.robolab"');
    expect(lines[1]).toContain(",'=evil(),");
    expect(lines[1]).toContain("Passed");
    expect(lines[2]).toContain("Error");
    const tsv = toTsv([ok, bad]).split("\n");
    expect(tsv).toHaveLength(3);
    expect(tsv[1].split("\t")[1]).toBe("'=evil()");
  });
});
