// match: competition(autonomous, driver_control) and PythonRunner.nextPeriod()
import { describe, it, expect, beforeAll } from "vitest";
import { createPythonRunner } from "./index";
import { loadSkulpt, fakeController, recorder } from "./testkit";
import { precheck } from "./friendly";
import type { RunResult } from "../core/modules";

beforeAll(() => loadSkulpt());

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(cond: () => boolean, max = 400) { for (let i = 0; i < max && !cond(); i++) await tick(); }

const COMP = (auto: string[], driver: string[]) => [
  "def autonomous():", ...auto.map((l) => "    " + l), "",
  "def driver_control():", ...driver.map((l) => "    " + l), "",
  "competition(autonomous, driver_control)", "",
].join("\n");

function errorOf(res: RunResult) {
  expect(res.status).toBe("error");
  if (res.status !== "error") throw new Error("not an error");
  return res.error;
}

describe("competition() in a normal run", () => {
  it("runs autonomous() then driver_control()", async () => {
    const { ctl, st } = fakeController();
    const { opts, rec } = recorder(ctl);
    const res = await createPythonRunner(opts).run(COMP(
      ["drivetrain.drive_for(FORWARD, 100, MM)", "print('auto done')"],
      ["drivetrain.turn_for(RIGHT, 90, DEGREES)", "print('driver done')"],
    ));
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 4 });
    expect(st.calls).toEqual(["driveFor(FORWARD,100)", "turnFor(RIGHT,90)"]);
    expect(rec.logs.filter((l) => l.kind !== "warn").map((l) => l.text)).toEqual([
      "autonomous()", "drive_for(FORWARD, 100, MM)", "auto done", "driver_control()", "turn_for(RIGHT, 90, DEGREES)", "driver done",
    ]);
    expect(rec.logs.some((l) => /never started/.test(l.text))).toBe(false);
    expect(rec.lines).toContain(2);
    expect(rec.lines).toContain(6);
  });

  it("reports errors inside autonomous() with the right line", async () => {
    const { ctl } = fakeController();
    const { opts } = recorder(ctl);
    const res = await createPythonRunner(opts).run(COMP(["wait(1, SECONDS)", "x = 1 / 0"], ["pass"]));
    const e = errorOf(res);
    expect(e.type).toBe("ZeroDivisionError");
    expect(e.line).toBe(3);
  });

  it("explains mistakes", async () => {
    const run = async (src: string) => {
      const { ctl } = fakeController();
      return errorOf(await createPythonRunner(recorder(ctl).opts).run(src));
    };
    const defs = "def autonomous():\n    pass\n\ndef driver_control():\n    pass\n\n";
    expect((await run(defs + "competition(autonomous(), driver_control())\n")).html).toMatch(/no <code>\(\)<\/code> after the function names/);
    expect((await run(defs + "competition()\n")).html).toMatch(/competition needs 2 values: autonomous, driver_control/);
    expect((await run(defs + "competition(autonomous)\n")).html).toMatch(/needs 2 values/);
    expect((await run(defs + "competition(1, driver_control)\n")).html).toMatch(/autonomous value you gave is 1/);
    expect((await run(defs + "competition('autonomous', driver_control)\n")).html).toMatch(/not a function/);
    expect((await run(defs + "def main():\n    pass\n\nstart(main)\ncompetition(autonomous, driver_control)\n")).html).toMatch(/not both/);
    expect((await run(defs + "competition(autonomous, driver_control)\nstart(autonomous)\n")).html).toMatch(/not both/);
    expect((await run("def driver_control():\n    pass\n\ncompetition(autonomous, driver_control)\n")).html).toMatch(/def autonomous\(\):/);
    expect((await run(defs + "competiton(autonomous, driver_control)\n")).html).toMatch(/Did you mean <code>competition<\/code>/);
  });

  it("precheck catches competition(autonomous(), ...) before anything runs", () => {
    const e = precheck("competition(autonomous(), driver_control)\n");
    expect(e?.line).toBe(1);
    expect(e?.html).toMatch(/run autonomous straight away/);
    expect(precheck("competition(autonomous, driver_control)\n")).toBeNull();
  });

  it("start(main) programs are unchanged and nextPeriod() is a harmless no-op for them", async () => {
    const { ctl, st } = fakeController();
    const runner = createPythonRunner(recorder(ctl).opts);
    const p = runner.run("def main():\n    wait(1, SECONDS)\n    drivetrain.drive_for(FORWARD, 10, MM)\n\nstart(main)\n");
    runner.nextPeriod();
    expect(await p).toEqual({ status: "finished", startCalled: true, steps: 2 });
    expect(st.calls).toEqual(["wait(1)", "driveFor(FORWARD,10)"]);
    runner.nextPeriod(); // not running: nothing happens
  });
});

describe("nextPeriod()", () => {
  it("interrupts autonomous() mid-motion: robot stops, the rest of autonomous never runs, driver_control starts", async () => {
    const { ctl, st } = fakeController({ hold: true });
    const { opts, rec } = recorder(ctl);
    const runner = createPythonRunner(opts);
    let res: RunResult | null = null;
    runner.run(COMP(
      ["drivetrain.drive_for(FORWARD, 1000, MM)", "drivetrain.drive(FORWARD)", "print('too late')"],
      ["print('driver!')", "drivetrain.turn_for(LEFT, 10, DEGREES)"],
    )).then((r) => { res = r; });
    await until(() => st.pending.length === 1);
    expect(st.calls).toEqual(["driveFor(FORWARD,1000)"]);
    runner.nextPeriod();
    expect(st.calls).toContain("stop()");
    st.pending.shift()!.resolve();        // the stopped drive_for resolves, as the sim does on stop()
    await until(() => st.pending.length === 1);
    st.pending.shift()!.resolve();
    await until(() => res !== null);
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 4 }); // autonomous(), drive_for, driver_control(), turn_for
    expect(st.calls).toEqual(["driveFor(FORWARD,1000)", "stop()", "armSpin(0)", "turnFor(LEFT,10)"]);
    const texts = rec.logs.map((l) => l.text);
    expect(texts).not.toContain("too late");
    expect(texts).toContain("driver!");
    expect(texts.some((t) => /Autonomous time is up/.test(t))).toBe(true);
  });

  it("interrupts a busy autonomous loop at its next statement", async () => {
    const { ctl, st } = fakeController();
    const { opts, rec } = recorder(ctl);
    const runner = createPythonRunner(opts);
    let res: RunResult | null = null;
    runner.run(COMP(
      ["n = 0", "while True:", "    n = n + 1", "    if n % 100000 == 0:", "        print('auto', n)"],
      ["print('driver')"],
    )).then((r) => { res = r; });
    await until(() => rec.logs.some((l) => l.text.startsWith("auto ")), 2000);
    runner.nextPeriod();
    const autoPrints = rec.logs.filter((l) => l.text.startsWith("auto ")).length;
    await until(() => res !== null, 2000);
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 2 });
    expect(rec.logs.filter((l) => l.text.startsWith("auto ")).length).toBe(autoPrints);
    expect(rec.logs.at(-1)?.text).toBe("driver");
    expect(st.calls).toContain("stop()");
  });

  it("in a match, the robot waits idle after autonomous() returns until nextPeriod()", async () => {
    const { ctl, st } = fakeController();
    const { opts, rec } = recorder(ctl);
    const runner = createPythonRunner(opts, { waitForDriverPeriod: true });
    let res: RunResult | null = null;
    runner.run(COMP(["drivetrain.drive(FORWARD)"], ["print('driver')"])).then((r) => { res = r; });
    await until(() => rec.logs.some((l) => /waits for the driver/.test(l.text)));
    for (let i = 0; i < 20; i++) await tick();
    expect(res).toBeNull();
    expect(runner.running).toBe(true);
    expect(st.calls).toEqual(["drive(FORWARD)", "stop()", "armSpin(0)"]);
    expect(rec.logs.some((l) => l.text === "driver")).toBe(false);
    runner.nextPeriod();
    await until(() => res !== null);
    expect(res!.status).toBe("finished");
    expect(rec.logs.at(-1)?.text).toBe("driver");
  });

  it("nextPeriod() before competition() is reached skips autonomous", async () => {
    const { ctl, st } = fakeController({ hold: true });
    const { opts, rec } = recorder(ctl);
    const runner = createPythonRunner(opts, { waitForDriverPeriod: true });
    let res: RunResult | null = null;
    runner.run("wait(1, SECONDS)\n" + COMP(["print('auto')"], ["print('driver')"])).then((r) => { res = r; });
    await until(() => st.pending.length === 1);
    runner.nextPeriod();
    st.pending.shift()!.resolve();
    await until(() => res !== null);
    const texts = rec.logs.map((l) => l.text);
    expect(texts).not.toContain("auto");
    expect(texts).toContain("driver");
  });

  it("Stop works during autonomous, while waiting, and during driver control", async () => {
    for (const when of ["auto", "waiting", "driver"] as const) {
      const { ctl, st } = fakeController({ hold: when === "auto" });
      const { opts } = recorder(ctl);
      const runner = createPythonRunner(opts, { waitForDriverPeriod: true });
      let res: RunResult | null = null;
      runner.run(COMP(when === "auto" ? ["wait(5, SECONDS)"] : ["pass"], ["while True:", "    x = 1"])).then((r) => { res = r; });
      if (when === "auto") await until(() => st.pending.length === 1);
      else { for (let i = 0; i < 10; i++) await tick(); if (when === "driver") { runner.nextPeriod(); for (let i = 0; i < 10; i++) await tick(); } }
      expect(res, when).toBeNull();
      runner.stop();
      await until(() => res !== null);
      expect(res, when).toEqual({ status: "stopped" });
    }
  });

  it("an error in driver_control() is reported", async () => {
    const { ctl } = fakeController();
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts, { waitForDriverPeriod: true });
    const p = runner.run(COMP(["pass"], ["drivetrain.drive_for(SIDEWAYS, 1, MM)"]));
    for (let i = 0; i < 10; i++) await tick();
    runner.nextPeriod();
    const e = errorOf(await p);
    expect(e.type).toBe("NameError");
    expect(e.line).toBe(5);
  });
});
