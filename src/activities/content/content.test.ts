import { beforeAll, describe, expect, it } from "vitest";
import type { Activity, ActivityStep } from "../../core/activity";
import type { World } from "../../core/types";
import { getPlayground } from "../../worlds";
import { sanitizeWorld, validateWorld } from "../../editor";
import { loadSkulpt } from "../../runtime/testkit";
import { checkStep, isRunCheck } from "../checks";
import { sanitizeActivity } from "../activityFile";
import { BUILT_IN_ACTIVITIES, getBuiltInActivity } from "./index";
import { SOLUTIONS, SCRIPTS } from "./solutions";
import { CUSTOM_WORLDS } from "./worlds";
import { runSolution, scriptedInput, squareAt, type DriveScript } from "./runSolution";

beforeAll(() => loadSkulpt());

/** The world each step runs in (a step without `world` keeps the previous step's). */
function stepWorlds(a: Activity): World[] {
  const out: World[] = [];
  let cur: World | undefined;
  for (const s of a.steps) {
    if (s.world) {
      cur = "playground" in s.world ? getPlayground(s.world.playground) : s.world.custom;
    }
    if (!cur) throw new Error(`${a.id}/${s.id}: no world`);
    out.push(cur);
  }
  return out;
}

const correctAnswers = (s: ActivityStep) => (s.quiz ?? []).map((q) => q.answer);

/** Programs that read the controller or spin motors need the driver-control runtime (docs/API.md). */
const usesDriverApi = (py: string) => /\bcontroller\.|\b(left|right)_motor\./.test(py);
const DRIVER_ACTIVITIES = new Set(BUILT_IN_ACTIVITIES.filter((a) =>
  Object.values(SOLUTIONS[a.id] ?? {}).some(usesDriverApi)).map((a) => a.id));

async function checkRun(step: ActivityStep, world: World, python: string, script?: DriveScript) {
  const run = await runSolution(world, python, script ? { script } : 240);
  const goals = run.sim.evaluateGoals();
  const finalSquare = world.background === "numberGrid" ? squareAt(world, run.sim.state.robot.x, run.sim.state.robot.y) : null;
  const res = checkStep(step, {
    python,
    quizAnswers: correctAnswers(step),
    starterPython: step.starter?.python,
    lastRun: run.result
      ? { result: run.result, goalsAllPassed: goals.length > 0 && goals.every((g) => g.passed), finalSquare, output: run.log }
      : null,
  });
  return { run, goals, finalSquare, res };
}

describe("built-in activities: format", () => {
  it("has about 10 activities with unique, permanent aNN- ids (a01..aN, no gaps; later ones may slot in)", () => {
    expect(BUILT_IN_ACTIVITIES.length).toBeGreaterThanOrEqual(8);
    const ids = BUILT_IN_ACTIVITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^a\d\d-/);
    const nums = ids.map((id) => parseInt(id.slice(1, 3), 10));
    expect([...nums].sort((x, y) => x - y)).toEqual(nums.map((_, i) => i + 1));
    // the original ten keep their teaching order
    expect(nums.filter((n) => n <= 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const a of BUILT_IN_ACTIVITIES) expect(getBuiltInActivity(a.id)).toBe(a);
  });
  it("puts the driver-control activities after the lessons they build on", () => {
    const ids = BUILT_IN_ACTIVITIES.map((a) => a.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at("a11-first-driver-program")).toBe(at("a06-input-and-output") + 1);
    expect(at("a12-arcade-drive-buttons")).toBe(at("a07-decisions-line-follow") + 1);
  });

  for (const a of BUILT_IN_ACTIVITIES) {
    describe(a.id, () => {
      it("has valid top-level fields", () => {
        expect(a.format).toBe("robot-lab-activity");
        expect(a.version).toBe(1);
        expect(a.id).toMatch(/^[a-z0-9-]+$/);
        expect(a.title.length).toBeGreaterThan(3);
        expect(a.summary.length).toBeGreaterThan(10);
        expect(["starter", "core", "stretch"]).toContain(a.level);
        expect(a.minutes).toBeGreaterThanOrEqual(15);
        expect(a.minutes).toBeLessThanOrEqual(45);
        expect(a.standards.length).toBeGreaterThan(0);
        for (const s of a.standards) expect(s).toMatch(/^(TEKS \(d\)\(\d+\)\([A-Z]\)|YouScience Std 5 Obj \d\.\d)$/);
        expect(a.steps.length).toBeGreaterThanOrEqual(3);
        expect(a.steps.length).toBeLessThanOrEqual(7);
      });

      it("has unique step ids, hints, and something to complete in every step", () => {
        const ids = a.steps.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of a.steps) {
          expect(s.id, s.id).toMatch(/^[a-z0-9-]+$/);
          expect(s.title.length, s.id).toBeGreaterThan(2);
          expect(s.body.length, s.id).toBeGreaterThan(20);
          expect(s.hints.length, s.id).toBeGreaterThanOrEqual(1);
          expect(s.checks.length + (s.quiz?.length ?? 0), s.id).toBeGreaterThan(0);
          for (const c of s.checks) expect(c.label.length, s.id).toBeGreaterThan(2);
          if (s.starter?.mode === "python") expect(s.starter.python ?? "", s.id).toMatch(/start\(main\)\s*$/);
        }
      });

      it("has well-formed quizzes", () => {
        for (const s of a.steps) for (const q of s.quiz ?? []) {
          expect(q.choices.length, q.prompt).toBeGreaterThanOrEqual(2);
          expect(new Set(q.choices).size, q.prompt).toBe(q.choices.length);
          expect(Number.isInteger(q.answer), q.prompt).toBe(true);
          expect(q.answer, q.prompt).toBeGreaterThanOrEqual(0);
          expect(q.answer, q.prompt).toBeLessThan(q.choices.length);
          expect(q.explain.length, q.prompt).toBeGreaterThan(5);
        }
      });

      it("uses worlds that exist (first step sets one)", () => {
        expect(a.steps[0].world, "first step must set a world").toBeDefined();
        for (const s of a.steps) {
          if (s.world && "playground" in s.world) expect(getPlayground(s.world.playground), s.world.playground).toBeDefined();
        }
        expect(() => stepWorlds(a)).not.toThrow();
      });

      it("uses endsInSquare only on number-grid worlds", () => {
        const worlds = stepWorlds(a);
        a.steps.forEach((s, i) => {
          if (s.checks.some((c) => c.kind === "endsInSquare")) expect(worlds[i].background, s.id).toBe("numberGrid");
          if (s.checks.some((c) => c.kind === "goalsComplete")) expect(worlds[i].goals.length, s.id).toBeGreaterThan(0);
        });
      });

      it("survives the activity-file sanitiser unchanged", () => {
        const { activity, warnings } = sanitizeActivity(JSON.parse(JSON.stringify(a)), {
          teacher: false,
          knownPlayground: (id) => !!getPlayground(id),
        });
        expect(warnings).toEqual([]);
        expect(activity.id).toBe(a.id);
        expect(activity.steps.map((s) => s.id)).toEqual(a.steps.map((s) => s.id));
        activity.steps.forEach((s, i) => {
          expect(s.checks.length).toBe(a.steps[i].checks.length);
          expect((s.quiz ?? []).length).toBe((a.steps[i].quiz ?? []).length);
        });
      });
    });
  }
});

describe("custom worlds", () => {
  for (const w of CUSTOM_WORLDS) {
    it(`${w.id} is a valid world`, () => {
      const { world, warnings } = sanitizeWorld(JSON.parse(JSON.stringify(w)));
      expect(warnings).toEqual([]);
      expect(world.zones.map((z) => z.id)).toEqual(w.zones.map((z) => z.id));
      expect(world.objects.map((o) => o.id)).toEqual(w.objects.map((o) => o.id));
      expect(world.goals.length).toBe(w.goals.length);
      const errors = validateWorld(w).filter((i) => i.level === "error");
      expect(errors).toEqual([]);
    });
  }
});

describe("every checked step is completable with its reference solution", () => {
  for (const a of BUILT_IN_ACTIVITIES) {
    if (DRIVER_ACTIVITIES.has(a.id)) continue; // see "driver-control activities" below
    const worlds = stepWorlds(a);
    a.steps.forEach((step, i) => {
      if (step.checks.length === 0) return;
      it(`${a.id} / ${step.id}`, async () => {
        const python = SOLUTIONS[a.id]?.[step.id];
        expect(python, "missing solution").toBeTypeOf("string");
        const { run, goals, finalSquare, res } = await checkRun(step, worlds[i], python!);
        expect(run.result, "did not finish in time").not.toBeNull();
        expect(run.result!.status, JSON.stringify(run.result)).toBe("finished");
        if (run.result!.status === "finished") expect(run.result!.startCalled).toBe(true);
        if (step.checks.some((c) => c.kind === "goalsComplete")) {
          expect(goals.filter((g) => !g.passed).map((g) => g.detail)).toEqual([]);
        }
        for (const c of step.checks) {
          if (c.kind === "endsInSquare") expect(finalSquare).toBe(c.square);
          if (c.kind === "logContains") expect(run.log.join("\n").toLowerCase()).toContain(c.text.toLowerCase());
        }
        expect(res.items.filter((x) => !x.passed)).toEqual([]);
        expect(res.passed).toBe(true);
      }, 120_000);
    });
  }

  it("has no solutions for steps that don't exist", () => {
    for (const [aid, steps] of Object.entries(SOLUTIONS)) {
      const a = getBuiltInActivity(aid);
      expect(a, aid).toBeDefined();
      for (const sid of Object.keys(steps)) {
        const s = a!.steps.find((x) => x.id === sid);
        expect(s, `${aid}/${sid}`).toBeDefined();
        expect(s!.checks.length, `${aid}/${sid}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("starter code does not already complete its step", () => {
  for (const a of BUILT_IN_ACTIVITIES) {
    const worlds = stepWorlds(a);
    a.steps.forEach((step, i) => {
      const py = step.starter?.python;
      if (!py || !step.checks.some(isRunCheck)) return;
      it(`${a.id} / ${step.id}`, async () => {
        // driver starters loop forever: drive them with the step's script (Stop is pressed at its end)
        const { res } = await checkRun(step, worlds[i], py, SCRIPTS[a.id]?.[step.id]);
        expect(res.passed).toBe(false);
      }, 120_000);
    });
  }

  it("the debugging starters fail in the planned way", async () => {
    const a = getBuiltInActivity("a08-debugging-detectives")!;
    const worlds = stepWorlds(a);
    const byId = (id: string) => a.steps.findIndex((s) => s.id === id);
    const syntax = await runSolution(worlds[byId("syntax-bugs")], a.steps[byId("syntax-bugs")].starter!.python!);
    expect(syntax.result?.status).toBe("error");
    if (syntax.result?.status === "error") expect(syntax.result.error.type).toMatch(/Syntax/);
    const names = await runSolution(worlds[byId("name-bugs")], a.steps[byId("name-bugs")].starter!.python!);
    expect(names.result?.status).toBe("error");
    if (names.result?.status === "error") expect(names.result.error.type).toMatch(/Name/);
    const logic = await runSolution(worlds[byId("logic-bugs")], a.steps[byId("logic-bugs")].starter!.python!);
    expect(logic.result?.status).toBe("finished");
    const all = await runSolution(worlds[byId("all-bugs")], a.steps[byId("all-bugs")].starter!.python!);
    expect(all.result?.status).toBe("error");
  }, 120_000);
});

describe("driver-control activities", () => {
  it("are the two new ones", () => {
    expect([...DRIVER_ACTIVITIES].sort()).toEqual(["a11-first-driver-program", "a12-arcade-drive-buttons", "a14-match-day"]); // match: a14
  });

  it("scriptedInput replays the timeline by sim time", () => {
    let now = 0;
    const input = scriptedInput([
      { t: 1, axes: { axis3: 60, axis1: -150 }, buttons: { buttonA: true } },
      { t: 2 },
    ], () => now);
    expect(input.read().axes).toEqual({ axis1: 0, axis2: 0, axis3: 0, axis4: 0 });
    now = 1.5;
    const s = input.read();
    expect(s.axes).toEqual({ axis1: -100, axis2: 0, axis3: 60, axis4: 0 });
    expect(s.buttons.buttonA).toBe(true);
    expect(s.buttons.buttonB).toBe(false);
    expect(Object.keys(s.buttons).length).toBe(12);
    now = 2;
    expect(input.read().axes.axis3).toBe(0);
    expect(input.read().buttons.buttonA).toBe(false);
  });

  it("every step with a run check has a driving script, and scripts only exist for those steps", () => {
    for (const id of DRIVER_ACTIVITIES) {
      const a = getBuiltInActivity(id)!;
      for (const s of a.steps) {
        expect(!!SCRIPTS[id]?.[s.id], `${id}/${s.id}`).toBe(s.checks.some(isRunCheck));
      }
    }
    for (const [aid, steps] of Object.entries(SCRIPTS)) {
      for (const [sid, sc] of Object.entries(steps)) {
        expect(DRIVER_ACTIVITIES.has(aid), aid).toBe(true);
        expect(sc.timeline.every((f, i, arr) => i === 0 || arr[i - 1].t <= f.t), `${aid}/${sid} in time order`).toBe(true);
        expect(sc.stopAt).toBeGreaterThan(sc.timeline[sc.timeline.length - 1].t);
      }
    }
  });

  // Runs now: code checks only (no run needed).
  for (const id of ["a11-first-driver-program", "a12-arcade-drive-buttons", "a14-match-day" /* match */]) {
    const a = getBuiltInActivity(id)!;
    for (const step of a.steps) {
      if (step.checks.length === 0) continue;
      it(`${id} / ${step.id}: solution passes the code checks`, () => {
        const python = SOLUTIONS[id]?.[step.id];
        expect(python, "missing solution").toBeTypeOf("string");
        const res = checkStep(step, { python: python!, quizAnswers: correctAnswers(step), starterPython: step.starter?.python, lastRun: null });
        const codeItems = res.items.filter((_, k) => k >= step.checks.length || !isRunCheck(step.checks[k]));
        expect(codeItems.filter((x) => !x.passed)).toEqual([]);
      });
    }
  }

  it("a12 starters don't already pass the code checks they teach", () => {
    const a = getBuiltInActivity("a12-arcade-drive-buttons")!;
    const clamp = a.steps.find((s) => s.id === "clamp-deadband")!;
    const res = checkStep(clamp, { python: SOLUTIONS[a.id]["arcade-mix"], quizAnswers: correctAnswers(clamp), lastRun: null });
    expect(res.items[0].passed).toBe(false); // no abs() yet
    const speed = a.steps.find((s) => s.id === "speed-mode")!;
    const res2 = checkStep(speed, { python: SOLUTIONS[a.id]["magnet-button"], quizAnswers: [], lastRun: null });
    expect(res2.items.slice(0, 3).some((x) => !x.passed)).toBe(true);
  });

  // NEEDS THE DRIVER-CONTROL RUNTIME MERGE (controller / left_motor / right_motor in Python, and
  // RobotController.setWheelVelocities in the sim). Until then these fail with a NameError on `controller`.
  describe("[needs driver runtime] scripted drivers complete the goals on the real sim", () => {
    for (const id of ["a11-first-driver-program", "a12-arcade-drive-buttons"]) {
      const a = getBuiltInActivity(id)!;
      const worlds = stepWorlds(a);
      a.steps.forEach((step, i) => {
        const script = SCRIPTS[id]?.[step.id];
        if (!script) return;
        it(`${id} / ${step.id}`, async () => {
          const python = SOLUTIONS[id][step.id];
          const { run, goals, res } = await checkRun(step, worlds[i], python, script);
          expect(run.result, "did not stop").not.toBeNull();
          expect(run.result!.status, JSON.stringify(run.result)).toBe("stopped");
          expect(goals.filter((g) => !g.passed).map((g) => g.detail)).toEqual([]);
          expect(res.items.filter((x) => !x.passed)).toEqual([]);
          expect(res.passed).toBe(true);
        }, 120_000);
      });
    }

    it("an untouched controller leaves the robot where it started", async () => {
      const a = getBuiltInActivity("a11-first-driver-program")!;
      const w = stepWorlds(a)[0];
      const run = await runSolution(w, SOLUTIONS[a.id]["drive-to-target"], { script: { timeline: [], stopAt: 2 } });
      expect(run.result?.status, JSON.stringify(run.result)).toBe("stopped");
      expect(run.sim.state.robot.x).toBeCloseTo(w.start.x, 3);
      expect(run.sim.state.robot.y).toBeCloseTo(w.start.y, 3);
    }, 120_000);

    it("the arcade starter (no mixing) can't turn, so it misses the target", async () => {
      const a = getBuiltInActivity("a12-arcade-drive-buttons")!;
      const step = a.steps[0];
      const run = await runSolution(stepWorlds(a)[0], step.starter!.python!, { script: SCRIPTS[a.id][step.id] });
      expect(run.result?.status, JSON.stringify(run.result)).toBe("stopped");
      expect(run.sim.evaluateGoals().every((g) => g.passed)).toBe(false);
    }, 120_000);
  });
});
