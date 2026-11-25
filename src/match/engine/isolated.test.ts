// match: isolated runners — two programs at once, each on its own Skulpt (node:vm realms stand in for iframes)
import { describe, it, expect, beforeAll } from "vitest";
import { createIsolatedRunnerWith } from "./isolated";
import { vmRealm, tick } from "./testkit";
import { createPythonRunner } from "../../runtime";
import { loadSkulpt, fakeController, recorder } from "../../runtime/testkit";
import type { RunResult } from "../../core/modules";

beforeAll(() => loadSkulpt()); // the "page's own" Skulpt, which must stay untouched

async function until(cond: () => boolean, max = 2000) { for (let i = 0; i < max && !cond(); i++) await tick(); }

describe("isolated runners", () => {
  it("each realm has its own Skulpt, separate from the page's", async () => {
    const r1 = await vmRealm()(), r2 = await vmRealm()();
    const page = (globalThis as { Sk?: unknown }).Sk;
    expect(r1.Sk).toBeTruthy();
    expect(r1.Sk).not.toBe(r2.Sk);
    expect(r1.Sk).not.toBe(page);
  });

  it("two programs run interleaved, each driving its own robot, without clobbering each other's builtins", async () => {
    const A = fakeController({ hold: true }), B = fakeController({ hold: true });
    const ra = recorder(A.ctl), rb = recorder(B.ctl);
    const runA = await createIsolatedRunnerWith(ra.opts, vmRealm());
    const runB = await createIsolatedRunnerWith(rb.opts, vmRealm());
    const prog = (name: string, mm: number) => [
      `def main():`,
      `    for i in range(3):`,
      `        drivetrain.drive_for(FORWARD, ${mm}, MM)`,
      `        print("${name}", i, distance.get_distance(MM))`,
      ``,
      `start(main)`,
    ].join("\n");
    let resA: RunResult | null = null, resB: RunResult | null = null;
    runA.run(prog("A", 111)).then((r) => { resA = r; });
    runB.run(prog("B", 222)).then((r) => { resB = r; });
    const order: string[] = [];
    // release one motion at a time, alternating robots: both programs are alive at once
    for (let k = 0; k < 6; k++) {
      const who = k % 2 === 0 ? A : B;
      await until(() => who.st.pending.length === 1);
      order.push(who === A ? "A" : "B");
      who.st.pending.shift()!.resolve();
    }
    await until(() => resA !== null && resB !== null);
    expect(order).toEqual(["A", "B", "A", "B", "A", "B"]);
    expect(resA).toEqual({ status: "finished", startCalled: true, steps: 3 });
    expect(resB).toEqual({ status: "finished", startCalled: true, steps: 3 });
    expect(A.st.calls).toEqual(["driveFor(FORWARD,111)", "driveFor(FORWARD,111)", "driveFor(FORWARD,111)"]);
    expect(B.st.calls).toEqual(["driveFor(FORWARD,222)", "driveFor(FORWARD,222)", "driveFor(FORWARD,222)"]);
    expect(ra.rec.logs.filter((l) => l.kind === "print").map((l) => l.text)).toEqual(["A 0 254.0", "A 1 254.0", "A 2 254.0"]);
    expect(rb.rec.logs.filter((l) => l.kind === "print").map((l) => l.text)).toEqual(["B 0 254.0", "B 1 254.0", "B 2 254.0"]);
    runA.dispose(); runB.dispose();
  });

  it("busy loops in both run together, and an error in one doesn't stop the other", async () => {
    const A = fakeController(), B = fakeController();
    const ra = recorder(A.ctl), rb = recorder(B.ctl);
    const runA = await createIsolatedRunnerWith(ra.opts, vmRealm());
    const runB = await createIsolatedRunnerWith(rb.opts, vmRealm());
    let resA: RunResult | null = null, resB: RunResult | null = null;
    runA.run("def main():\n    n = 0\n    while True:\n        n = n + 1\n        if n == 200000:\n            print('A busy')\n\nstart(main)\n").then((r) => { resA = r; });
    runB.run("def main():\n    wait(0, SECONDS)\n    print(undefined_name)\n\nstart(main)\n").then((r) => { resB = r; });
    await until(() => resB !== null && ra.rec.logs.some((l) => l.text === "A busy"));
    const rb2 = resB as RunResult | null;
    expect(rb2?.status).toBe("error");
    if (rb2?.status === "error") { expect(rb2.error.type).toBe("NameError"); expect(rb2.error.line).toBe(3); }
    expect(resA).toBeNull(); // still running
    expect(runA.running).toBe(true);
    runA.stop();
    await until(() => resA !== null);
    expect(resA).toEqual({ status: "stopped" });
    // the page's own runner (global Sk) still works afterwards
    const P = fakeController();
    const res = await createPythonRunner(recorder(P.ctl).opts).run("def main():\n    drivetrain.stop()\n\nstart(main)\n");
    expect(res.status).toBe("finished");
    runA.dispose(); runB.dispose();
  });

  it("a STOPPED rejection from the (other-realm) sim ends the run as stopped", async () => {
    const A = fakeController({ hold: true });
    const run = await createIsolatedRunnerWith(recorder(A.ctl).opts, vmRealm());
    const p = run.run("def main():\n    wait(5, SECONDS)\n\nstart(main)\n");
    await until(() => A.st.pending.length === 1);
    A.st.pending[0].reject(new Error("STOPPED"));
    expect(await p).toEqual({ status: "stopped" });
    run.dispose();
  });

  it("variables() and the debugger read the right realm's values", async () => {
    const A = fakeController({ hold: true });
    const run = await createIsolatedRunnerWith(recorder(A.ctl).opts, vmRealm());
    run.run("speed = 42\nname = 'zed'\ndef main():\n    wait(1, SECONDS)\n\nstart(main)\n");
    await until(() => A.st.pending.length === 1);
    run.pause();
    expect(run.paused).toBe(true);
    const vars = run.variables();
    expect(vars.find((v) => v.name === "speed")).toMatchObject({ value: "42", type: "int" });
    expect(vars.find((v) => v.name === "name")).toMatchObject({ value: "'zed'", type: "str" });
    run.stop();
    run.dispose();
  });

  it("dispose stops the program, frees the realm, and later calls are safe", async () => {
    const A = fakeController({ hold: true });
    let freed = 0;
    const load = vmRealm();
    const run = await createIsolatedRunnerWith(recorder(A.ctl).opts, async () => { const r = await load(); return { Sk: r.Sk, dispose: () => { freed++; } }; });
    const p = run.run("def main():\n    wait(5, SECONDS)\n\nstart(main)\n");
    await until(() => A.st.pending.length === 1);
    run.dispose();
    expect(await p).toEqual({ status: "stopped" });
    expect(freed).toBe(1);
    run.dispose();
    expect(freed).toBe(1);
    expect(run.running).toBe(false);
    expect((await run.run("start(main)")).status).toBe("error");
    run.nextPeriod(); run.pause(); run.resume(); run.step();
  });
});
