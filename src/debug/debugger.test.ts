import { describe, it, expect, beforeAll } from "vitest";
import { createPythonRunner } from "../runtime/index";
import { loadSkulpt, fakeController, recorder } from "../runtime/testkit";
import type { VarView, PythonRunner } from "../core/modules";
import { formatFloat } from "./vars";

beforeAll(() => loadSkulpt());

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function setup(over = {}) {
  const { ctl, st } = fakeController(over);
  const { opts, rec } = recorder(ctl);
  const pauses: { line: number; vars: VarView[] }[] = [];
  opts.onPause = (info) => pauses.push(info);
  const runner = createPythonRunner(opts);
  return { runner, st, rec, pauses };
}

/** Wait until the runner is paused (or give up). */
async function untilPaused(runner: PythonRunner, ms = 1000) {
  const t0 = Date.now();
  while (!runner.paused && Date.now() - t0 < ms) await tick(2);
  expect(runner.paused).toBe(true);
}
const byName = (vars: VarView[], name: string) => vars.find((v) => v.name === name);

const PROG = [
  "count = 0",                                   // 1
  "def main():",                                 // 2
  "    global count",                            // 3
  "    x = 1.5",                                 // 4
  "    drivetrain.drive_for(FORWARD, 100, MM)",  // 5
  "    count = count + 1",                       // 6
  "    drivetrain.turn_for(RIGHT, 90, DEGREES)", // 7
  "",                                            // 8
  "start(main)",                                 // 9
  "",
].join("\n");

describe("pause / step / resume", () => {
  it("startPaused halts on the first line, step lands on successive lines", async () => {
    const { runner, st, pauses } = setup();
    const p = runner.run(PROG, { startPaused: true });
    await untilPaused(runner);
    expect(pauses.at(-1)!.line).toBe(1);
    expect(st.calls).toEqual([]);
    const seen: number[] = [pauses.at(-1)!.line];
    for (let i = 0; i < 7; i++) {
      runner.step();
      await untilPaused(runner);
      seen.push(pauses.at(-1)!.line);
    }
    expect(seen).toEqual([1, 2, 9, 3, 4, 5, 6, 7]);
    // motion on line 5 happened during the step from 5 to 6, and nothing after it
    expect(st.calls).toEqual(["driveFor(FORWARD,100)"]);
    runner.resume();
    const res = await p;
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 2 });
    expect(runner.paused).toBe(false);
  });

  it("pause() while running halts at the next statement; resume finishes", async () => {
    const { runner, st, pauses } = setup({ hold: true });
    const p = runner.run(PROG);
    await tick(10);
    expect(st.calls).toEqual(["driveFor(FORWARD,100)"]);
    // waiting for the motion: pauses at once, on the motion's line
    runner.pause();
    expect(runner.paused).toBe(true);
    expect(pauses.at(-1)!.line).toBe(5);
    // the motion finishing while paused must not let Python run on
    st.pending[0].resolve();
    await tick(20);
    expect(runner.paused).toBe(true);
    expect(st.calls).toEqual(["driveFor(FORWARD,100)"]);
    runner.resume();
    await tick(20);
    expect(st.calls).toEqual(["driveFor(FORWARD,100)", "turnFor(RIGHT,90)"]);
    st.pending[1].resolve();
    expect((await p).status).toBe("finished");
  });

  it("step while paused mid-motion stops at the next line", async () => {
    const { runner, st, pauses } = setup({ hold: true });
    const p = runner.run(PROG);
    await tick(10);
    runner.pause();
    runner.step();
    expect(runner.paused).toBe(false);
    st.pending[0].resolve();
    await untilPaused(runner);
    expect(pauses.at(-1)!.line).toBe(6);
    runner.stop();
    expect(await p).toEqual({ status: "stopped" });
  });

  it("stop() while paused resolves stopped and runs nothing more", async () => {
    const { runner, st } = setup();
    const p = runner.run(PROG, { startPaused: true });
    await untilPaused(runner);
    runner.stop();
    expect(await p).toEqual({ status: "stopped" });
    expect(runner.paused).toBe(false);
    expect(runner.running).toBe(false);
    await tick(20);
    expect(st.calls).toEqual(["stop()"]);
  });

  it("infinite loop: pause, see the counter, continue, pause again, stop", async () => {
    const { runner, pauses } = setup();
    const src = ["def main():", "    n = 0", "    while True:", "        n = n + 1", "", "start(main)", ""].join("\n");
    const p = runner.run(src);
    await tick(40);
    runner.pause();
    await untilPaused(runner);
    const a = pauses.at(-1)!;
    expect([3, 4]).toContain(a.line);
    const n1 = Number(byName(a.vars, "n")!.value);
    expect(byName(a.vars, "n")!.scope).toBe("local");
    expect(n1).toBeGreaterThan(0);
    runner.resume();
    await tick(40);
    runner.pause();
    await untilPaused(runner);
    const n2 = Number(byName(pauses.at(-1)!.vars, "n")!.value);
    expect(n2).toBeGreaterThan(n1);
    // a step inside the loop moves exactly one line
    const from = pauses.at(-1)!.line;
    runner.step();
    await untilPaused(runner);
    expect(pauses.at(-1)!.line).toBe(from === 3 ? 4 : 3);
    runner.stop();
    expect(await p).toEqual({ status: "stopped" });
  });

  it("a loop on one line still steps once per pass", async () => {
    const { runner, pauses } = setup();
    const p = runner.run("n = 0\nwhile n < 100: n += 1\n", { startPaused: true });
    await untilPaused(runner);
    runner.step(); await untilPaused(runner);   // -> line 2
    expect(pauses.at(-1)!.line).toBe(2);
    const v0 = Number(byName(pauses.at(-1)!.vars, "n")!.value);
    runner.step(); await untilPaused(runner);
    runner.step(); await untilPaused(runner);
    const v1 = Number(byName(pauses.at(-1)!.vars, "n")!.value);
    expect(v1).toBeGreaterThan(v0);
    expect(v1).toBeLessThan(10);
    runner.resume();
    expect((await p).status).toBe("finished");
  });

  it("pause/resume/step are harmless when nothing runs", () => {
    const { runner } = setup();
    runner.pause(); runner.resume(); runner.step();
    expect(runner.paused).toBe(false);
    expect(runner.variables()).toEqual([]);
  });

  it("normal runs are unaffected", async () => {
    const { runner, pauses } = setup();
    const res = await runner.run(PROG);
    expect(res.status).toBe("finished");
    expect(pauses).toEqual([]);
  });
});

describe("variables", () => {
  const VSRC = [
    "import math",
    "speed = 50",
    "name = 'Robo'",
    "ratio = 0.1 + 0.2",
    "flag = True",
    "nothing = None",
    "pts = [1, 2.5, 'a', [3, 4]]",
    "pair = (1, 2)",
    "info = {'a': 1, 'b': 'x'}",
    "long_text = 'x' * 500",
    "big = list(range(200))",
    "def helper(a, b=2):",
    "    total = a + b",
    "    return total",
    "def main():",
    "    dist = 12.0",
    "    pi = math.pi",
    "    y = helper(3)",
    "    pass",
    "start(main)",
    "",
  ].join("\n");

  async function pauseAt(line: number) {
    const s = setup();
    const p = s.runner.run(VSRC, { startPaused: true });
    await untilPaused(s.runner);
    while (s.pauses.at(-1)!.line !== line) { s.runner.step(); await untilPaused(s.runner); }
    return { ...s, p };
  }

  it("globals + locals inside main, with formatting and exclusions", async () => {
    const { runner, pauses, p } = await pauseAt(19);
    const vars = pauses.at(-1)!.vars;
    const v = (n: string) => byName(vars, n);
    expect(v("dist")).toEqual({ name: "dist", value: "12.0", type: "float", scope: "local" });
    expect(v("pi")!.value).toBe("3.142");
    expect(v("y")).toEqual({ name: "y", value: "5", type: "int", scope: "local" });
    expect(v("speed")).toEqual({ name: "speed", value: "50", type: "int", scope: "global" });
    expect(v("name")!.value).toBe("'Robo'");   // JS-reserved-ish name is unmangled
    expect(v("ratio")!.value).toBe("0.3");
    expect(v("flag")!.value).toBe("True");
    expect(v("nothing")!.value).toBe("None");
    expect(v("pts")!.value).toBe("[1, 2.5, 'a', [3, 4]]");
    expect(v("pair")!.value).toBe("(1, 2)");
    expect(v("info")!.value).toBe("{'a': 1, 'b': 'x'}");
    expect(v("long_text")!.value.length).toBeLessThanOrEqual(82);
    expect(v("long_text")!.value).toMatch(/^'x+…'$/);
    expect(v("big")!.value.length).toBeLessThanOrEqual(82);
    expect(v("big")!.value).toContain("…");
    // excluded: modules, functions, robot API objects, constants, dunders
    for (const n of ["math", "helper", "main", "drivetrain", "brain", "FORWARD", "MM", "RED", "__name__", "wait", "start"]) {
      expect(v(n)).toBeUndefined();
    }
    // live read gives the same snapshot
    expect(byName(runner.variables(), "dist")!.value).toBe("12.0");
    runner.resume();
    expect((await p).status).toBe("finished");
  });

  it("locals of the innermost frame (helper's parameters)", async () => {
    const { runner, pauses, p } = await pauseAt(14);
    const vars = pauses.at(-1)!.vars;
    expect(byName(vars, "a")).toEqual({ name: "a", value: "3", type: "int", scope: "local" });
    expect(byName(vars, "b")!.value).toBe("2");
    expect(byName(vars, "total")!.value).toBe("5");
    expect(byName(vars, "dist")).toBeUndefined(); // main's locals are not the current frame
    runner.stop();
    await p;
  });

  it("formatFloat", () => {
    expect(formatFloat(2)).toBe("2.0");
    expect(formatFloat(0.1 + 0.2)).toBe("0.3");
    expect(formatFloat(-1.23456)).toBe("-1.235");
    expect(formatFloat(0.00012345)).toBe("0.000123");
    expect(formatFloat(Infinity)).toBe("inf");
  });
});
