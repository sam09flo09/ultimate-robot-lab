/** Driver control in the runtime: controller reads, left/right motors, logging, errors, real-sim programs. */
import { describe, it, expect, beforeAll } from "vitest";
import { createPythonRunner } from "./index";
import { loadSkulpt, fakeController, fakeInput, recorder } from "./testkit";
import { TOP_LEVEL } from "./names";
import type { RunResult } from "../core/modules";
import type { SimEvent, World } from "../core/types";
import { createSim } from "../sim";

beforeAll(() => loadSkulpt());

const prog = (body: string[]) => ["def main():", ...body.map((l) => "    " + l), "", "start(main)", ""].join("\n");
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function runProg(src: string, over = {}, withInput = true) {
  const { ctl, st } = fakeController(over);
  const { opts, rec } = recorder(ctl);
  const inp = fakeInput();
  let used = 0;
  if (withInput) opts.input = inp.input;
  opts.onControllerUsed = () => { used++; };
  const runner = createPythonRunner(opts);
  const res = await runner.run(src);
  return { res, st, rec, inp, used: () => used, runner };
}
function expectError(res: RunResult) {
  expect(res.status).toBe("error");
  if (res.status !== "error") throw new Error("not an error");
  return res.error;
}
const wheels = (calls: string[]) => calls.filter((c) => c.startsWith("wheels"));
const steps = (rec: { logs: { kind: string; text: string }[] }) => rec.logs.filter((l) => l.kind === "step").map((l) => l.text);
const prints = (rec: { logs: { kind: string; text: string }[] }) => rec.logs.filter((l) => l.kind === "print").map((l) => l.text);

describe("controller", () => {
  it("reads axes and buttons from the input (ints, clamped), PERCENT allowed", async () => {
    const { ctl } = fakeController();
    const { opts, rec } = recorder(ctl);
    const inp = fakeInput();
    Object.assign(inp.state.axes, { axis1: 12, axis2: -100, axis3: 55.6, axis4: 250 });
    inp.state.buttons.buttonA = true;
    inp.state.buttons.buttonR2 = true;
    opts.input = inp.input;
    const res = await createPythonRunner(opts).run(prog([
      "print(controller.axis1.position(), controller.axis2.position(PERCENT), controller.axis3.position(), controller.axis4.position())",
      "print(controller.buttonA.pressing(), controller.buttonB.pressing(), controller.buttonR2.pressing(), controller.buttonUp.pressing())",
      "print(type(controller.axis1.position()).__name__)",
    ]));
    expect(res.status).toBe("finished");
    expect(prints(rec)).toEqual(["12 -100 56 100", "True False True False", "int"]);
    expect(steps(rec)).toEqual([]); // controller reads are never logged
  });

  it("with no input every axis is 0 and no button is pressed", async () => {
    const { res, rec } = await runProg(prog([
      "print(controller.axis3.position(), controller.buttonX.pressing(), controller.buttonL1.pressing())",
    ]), {}, false);
    expect(res.status).toBe("finished");
    expect(prints(rec)).toEqual(["0 False False"]);
  });

  it("onControllerUsed fires once per run, on the first read", async () => {
    const r = await runProg(prog(["for i in range(20):", "    x = controller.axis3.position()", "    y = controller.buttonA.pressing()"]));
    expect(r.res.status).toBe("finished");
    expect(r.used()).toBe(1);
    expect(r.inp.reads()).toBe(40);
    const r2 = await runProg(prog(["drivetrain.drive(FORWARD)"]));
    expect(r2.used()).toBe(0);
    // once per run: a second run fires again
    let n = 0;
    const { ctl } = fakeController();
    const { opts } = recorder(ctl);
    opts.onControllerUsed = () => { n++; };
    const runner = createPythonRunner(opts);
    await runner.run(prog(["controller.axis1.position()", "controller.axis2.position()"]));
    await runner.run(prog(["controller.buttonB.pressing()"]));
    expect(n).toBe(2);
  });

  it("units other than PERCENT are a friendly error", async () => {
    const e = expectError((await runProg(prog(["controller.axis3.position(MM)"]))).res);
    expect(e.html).toContain("controller.axis3.position units must be PERCENT");
  });
});

describe("motors", () => {
  it("spin / stop / set_velocity / velocity map to one setWheelVelocities call with the pair", async () => {
    const { res, st, rec } = await runProg(prog([
      "left_motor.spin(FORWARD)",
      "right_motor.spin(REVERSE, 30, PERCENT)",
      "left_motor.spin(FORWARD, -40, PERCENT)",
      "right_motor.set_velocity(80, PERCENT)",
      "print(left_motor.velocity(PERCENT), right_motor.velocity())",
      "left_motor.stop()",
      "left_motor.set_velocity(25)",
      "left_motor.spin(REVERSE)",
      "right_motor.stop()",
      "left_motor.spin(FORWARD, 12.5)",
      "print(left_motor.velocity(PERCENT))",
    ]));
    expect(res.status).toBe("finished");
    expect(wheels(st.calls)).toEqual([
      "wheels(50,0)", "wheels(50,-30)", "wheels(-40,-30)", "wheels(-40,-80)", "wheels(0,-80)",
      "wheels(-25,-80)", "wheels(-25,0)", "wheels(12.5,0)",
    ]);
    expect(prints(rec)).toEqual(["-40 80", "12.5"]);
    expect(steps(rec)).toEqual([
      "left_motor.spin(FORWARD)", "right_motor.spin(REVERSE, 30, PERCENT)", "left_motor.spin(FORWARD, -40, PERCENT)",
      "right_motor.set_velocity(80, PERCENT)", "left_motor.stop()", "left_motor.set_velocity(25)", "left_motor.spin(REVERSE)",
      "right_motor.stop()", "left_motor.spin(FORWARD, 12.5)",
    ]);
  });

  it("clamps to -100..100 with one warning per motor", async () => {
    const { res, st, rec } = await runProg(prog(["for i in range(3):", "    left_motor.spin(FORWARD, 150 + i, PERCENT)", "right_motor.spin(FORWARD, -300)"]));
    expect(res.status).toBe("finished");
    expect(wheels(st.calls)).toEqual(["wheels(100,0)", "wheels(100,0)", "wheels(100,0)", "wheels(100,-100)"]);
    const warns = rec.logs.filter((l) => l.kind === "warn").map((l) => l.text);
    expect(warns).toEqual(["left_motor.spin uses -100 to 100 PERCENT, so 150 became 100.", "right_motor.spin uses -100 to 100 PERCENT, so -300 became -100."]);
  });

  it("a drivetrain command takes the wheels back (motor state resets to 0)", async () => {
    const { res, st, rec } = await runProg(prog([
      "left_motor.spin(FORWARD, 60, PERCENT)", "right_motor.spin(FORWARD, 60, PERCENT)",
      "drivetrain.drive_for(FORWARD, 100, MM)",
      "right_motor.spin(FORWARD, 20, PERCENT)",
      "drivetrain.turn(LEFT)",
      "left_motor.spin(FORWARD, 60, PERCENT)",
    ]));
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual(["wheels(60,0)", "wheels(60,60)", "driveFor(FORWARD,100)", "wheels(0,20)", "turn(LEFT)", "wheels(60,0)"]);
    // the repeated spin(FORWARD, 60) after the drivetrain command is logged again
    expect(steps(rec).filter((t) => t === "left_motor.spin(FORWARD, 60, PERCENT)").length).toBe(2);
  });

  it("tight driver loops don't flood the log: spins are logged only when the velocity changes", async () => {
    const { res, st, rec } = await runProg(prog([
      "for i in range(200):",
      "    v = 0 if i < 50 else (40 if i < 150 else 0)",
      "    left_motor.spin(FORWARD, controller.axis3.position() + v, PERCENT)",
      "    right_motor.spin(FORWARD, v, PERCENT)",
      "    if controller.buttonA.pressing():",
      "        break",
    ]));
    expect(res.status).toBe("finished");
    expect(wheels(st.calls).length).toBe(400);
    expect(steps(rec)).toEqual([
      "left_motor.spin(FORWARD, 0, PERCENT)", "right_motor.spin(FORWARD, 0, PERCENT)",
      "left_motor.spin(FORWARD, 40, PERCENT)", "right_motor.spin(FORWARD, 40, PERCENT)",
      "left_motor.spin(FORWARD, 0, PERCENT)", "right_motor.spin(FORWARD, 0, PERCENT)",
    ]);
    if (res.status === "finished") expect(res.steps).toBe(6);
  });

  it("scripted input changing between waits drives the motors", async () => {
    const { ctl, st } = fakeController({ hold: true });
    const { opts, rec } = recorder(ctl);
    const inp = fakeInput();
    opts.input = inp.input;
    const script: Array<[number, number]> = [[100, 100], [50, -50], [-30, -30], [0, 0]];
    inp.state.axes.axis3 = script[0][0]; inp.state.axes.axis2 = script[0][1];
    const runner = createPythonRunner(opts);
    const p = runner.run(prog([
      "for i in range(4):",
      "    left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)",
      "    right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)",
      "    wait(20, MSEC)",
    ]));
    for (let i = 0; i < 4; i++) {
      while (st.pending.length === 0) await tick();
      // Python is now waiting; what it read for this pass is already applied. Set the next pass's sticks.
      if (i < 3) { inp.state.axes.axis3 = script[i + 1][0]; inp.state.axes.axis2 = script[i + 1][1]; }
      st.pending.shift()!.resolve();
    }
    const res = await p;
    expect(res.status).toBe("finished");
    expect(wheels(st.calls)).toEqual([
      "wheels(100,0)", "wheels(100,100)", "wheels(50,100)", "wheels(50,-50)", "wheels(-30,-50)", "wheels(-30,-30)", "wheels(0,-30)", "wheels(0,0)",
    ]);
    expect(steps(rec).filter((t) => t.startsWith("wait")).length).toBe(4);
  });

  it("the Variables panel hides controller and the motors", async () => {
    expect(TOP_LEVEL).toEqual(expect.arrayContaining(["controller", "left_motor", "right_motor"]));
    const { ctl, st } = fakeController({ hold: true });
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts);
    const p = runner.run("speed = 5\nc = controller.axis3.position()\nleft_motor.spin(FORWARD)\nwait(1, SECONDS)\n");
    while (st.pending.length === 0) await tick();
    const names = runner.variables().map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(["speed", "c"]));
    expect(names).not.toContain("controller");
    expect(names).not.toContain("left_motor");
    expect(names).not.toContain("right_motor");
    st.pending.shift()!.resolve();
    expect((await p).status).toBe("finished");
  });
});

describe("driver-control friendly errors", () => {
  const err = async (line: string) => expectError((await runProg(prog([line]))).res);

  it("controller attributes it doesn't have", async () => {
    let e = await err("x = controller.axis5.position()");
    expect(e.type).toBe("AttributeError");
    expect(e.html).toContain("the controller has axis1 to axis4".replace("the", "The"));
    e = await err("x = controller.buttonZ.pressing()");
    expect(e.html).toContain("Its buttons are: buttonA, buttonB");
    e = await err("x = controller.buttona.pressing()");
    expect(e.html).toContain("Capitals matter: did you mean <code>controller.buttonA</code>?");
    e = await err("x = controller.position()");
    expect(e.html).toContain("<code>controller.axis3.position()</code>");
    e = await err("x = controller.axis3.value()");
    expect(e.html).toContain("<code>controller.axis3</code> has no command <code>value</code>");
    e = await err("x = controller.axis3.pressing()");
    expect(e.html).toContain("belongs to");
  });

  it("calling an axis without .position()", async () => {
    let e = await err("x = controller.axis3()");
    expect(e.type).toBe("TypeError");
    expect(e.html).toContain("<code>controller.axis3</code> is not a command by itself");
    expect(e.html).toContain("<code>controller.axis3.position()</code>");
    e = await err("left_motor.spin(FORWARD, controller.axis3.position, PERCENT)");
    expect(e.html).toContain("left_motor.spin velocity must be a number");
    expect(e.html).toContain("add () to use its value");
    e = await err("x = controller.buttonA()");
    expect(e.html).toContain("<code>controller.buttonA.pressing()</code>");
  });

  it("motor argument mistakes", async () => {
    let e = await err("left_motor.spin(LEFT)");
    expect(e.type).toBe("ValueError");
    expect(e.html).toContain("left_motor.spin direction is FORWARD or REVERSE");
    e = await err("right_motor.spin('forward', 50)");
    expect(e.html).toContain("Write FORWARD in capitals with no quotes.");
    e = await err("left_motor.spin()");
    expect(e.html).toContain("left_motor.spin needs 1 to 3 values: direction, velocity, units. Example: left_motor.spin(FORWARD, 50, PERCENT). You gave 0.");
    e = await err("left_motor.spin(FORWARD, 'fast', PERCENT)");
    expect(e.html).toContain("left_motor.spin velocity must be a number, like 50.");
    e = await err("left_motor.spin(FORWARD, 50, MM)");
    expect(e.html).toContain("left_motor.spin units must be PERCENT");
    e = await err("right_motor.set_velocity()");
    expect(e.html).toContain("right_motor.set_velocity needs 1 to 2 values");
    e = await err("right_motor.stop(1)");
    expect(e.html).toContain("right_motor.stop() doesn&#39;t take any values");
    e = await err("left_motor.spinn(FORWARD)");
    expect(e.html).toContain("Did you mean <code>left_motor.spin</code>?");
    e = await err("drivetrain.spin(FORWARD)");
    expect(e.html).toContain("<code>spin</code> belongs to <code>left_motor</code>");
  });

  it("typos in the new names", async () => {
    let e = await err("left_moter.spin(FORWARD)");
    expect(e.html).toContain("Did you mean <code>left_motor</code>?");
    e = await err("x = Controller.axis3.position()");
    expect(e.html).toContain("Capitals matter: did you mean <code>controller</code>?");
    e = await err("x = contoller.axis3.position()");
    expect(e.html).toContain("Did you mean <code>controller</code>?");
  });
});

// ---------------------------------------------------------------- end to end on the real sim

function field(): World {
  return {
    id: "drv", name: "Driver", width: 2000, height: 2000, start: { x: 0, y: -800, heading: 0 },
    walls: [], floor: [], objects: [],
    zones: [{ id: "target", kind: "circle", x: 600, y: 0, r: 160 }],
    goals: [{ type: "reachZone", zone: "target" }],
    version: 1,
  };
}

/** Run a driver program on the real sim; `script(t, state)` moves the sticks at sim time t. */
async function drive(src: string, script: (t: number, s: ReturnType<typeof fakeInput>["state"]) => void, seconds: number) {
  const sim = createSim(field());
  const inp = fakeInput();
  const events: SimEvent[] = [];
  sim.onEvent((e) => events.push(e));
  let used = 0;
  const logs: string[] = [];
  const runner = createPythonRunner({
    controller: sim.controller, onLine: () => {}, onLog: (e) => logs.push(e.text), input: inp.input, onControllerUsed: () => { used++; },
  });
  let result: RunResult | null = null;
  void runner.run(src).then((r) => { result = r; });
  while (sim.state.time < seconds && result === null) {
    script(sim.state.time, inp.state);
    sim.step(1 / 60);
    await tick();
  }
  if (result === null) runner.stop();
  return { sim, used, result: result as RunResult | null, events, logs };
}

describe("driver programs on the real sim", () => {
  it("tank drive reaches the target", async () => {
    const src = prog([
      "while True:",
      "    left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)",
      "    right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)",
      "    if controller.buttonB.pressing():",
      "        break",
      "    wait(20, MSEC)",
    ]);
    const { sim, used, result, events } = await drive(src, (t, s) => {
      const set = (l: number, r: number) => { s.axes.axis3 = l; s.axes.axis2 = r; };
      if (t < 1) set(100, 100);                 // 800 mm up the field
      else if (t < 1.235) set(50, -50);         // ~90° to the right on the spot
      else if (t < 2) set(100, 100);            // ~600 mm to the right
      else set(0, 0);
      s.buttons.buttonB = t > 2.5;
    }, 6);
    expect(used).toBe(1);
    expect(result?.status).toBe("finished");
    const r = sim.state.robot;
    expect(Math.hypot(r.x - 600, r.y)).toBeLessThan(160);
    expect(events.some((e) => e.type === "goalsComplete")).toBe(true);
    expect(sim.controller.isDone()).toBe(true);
    expect(sim.state.wallHits).toBe(0);
  });

  it("arcade drive (speed + turn) reaches the target", async () => {
    const src = prog([
      "while True:",
      "    speed = controller.axis3.position()",
      "    turn = controller.axis1.position()",
      "    left_motor.spin(FORWARD, speed + turn, PERCENT)",
      "    right_motor.spin(FORWARD, speed - turn, PERCENT)",
      "    if controller.buttonA.pressing():",
      "        break",
      "    wait(20, MSEC)",
    ]);
    const { sim, result, events, logs } = await drive(src, (t, s) => {
      s.axes.axis3 = t < 1 ? 100 : t >= 1.235 && t < 2 ? 100 : 0;
      s.axes.axis1 = t >= 1 && t < 1.235 ? 50 : 0;
      s.buttons.buttonA = t > 2.5;
    }, 6);
    expect(result?.status).toBe("finished");
    const r = sim.state.robot;
    expect(Math.hypot(r.x - 600, r.y)).toBeLessThan(160);
    expect(events.some((e) => e.type === "goalsComplete")).toBe(true);
    expect(logs.length).toBeLessThan(400); // ~150 loop passes, but only changes and waits are logged
  });

  it("a driver loop WITHOUT wait doesn't freeze: the sim keeps stepping and the robot moves", async () => {
    const sim = createSim(field());
    const inp = fakeInput();
    inp.state.axes.axis3 = 50;
    inp.state.axes.axis2 = 50;
    const runner = createPythonRunner({ controller: sim.controller, onLine: () => {}, onLog: () => {}, input: inp.input });
    const p = runner.run(prog([
      "while True:",
      "    left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)",
      "    right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)",
    ]));
    let frames = 0;
    await new Promise<void>((resolve) => {
      const id = setInterval(() => { sim.step(1 / 60); if (++frames >= 30) { clearInterval(id); resolve(); } }, 4);
    });
    expect(sim.state.robot.y).toBeGreaterThan(-800 + 150); // 0.5 s at 400 mm/s = 200 mm
    runner.stop();
    expect((await p).status).toBe("stopped");
  });
});
