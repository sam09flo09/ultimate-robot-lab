import { describe, it, expect, beforeAll } from "vitest";
import { createPythonRunner } from "./index";
import { loadSkulpt, fakeController, recorder } from "./testkit";
import type { RunResult } from "../core/modules";

beforeAll(() => loadSkulpt());

async function runProg(src: string, over = {}) {
  const { ctl, st } = fakeController(over);
  const { opts, rec } = recorder(ctl);
  const runner = createPythonRunner(opts);
  const res = await runner.run(src);
  return { res, st, rec, runner };
}
const prog = (body: string[]) => ["def main():", ...body.map((l) => "    " + l), "", "start(main)", ""].join("\n");
function expectError(res: RunResult) {
  expect(res.status).toBe("error");
  if (res.status !== "error") throw new Error("not an error");
  return res.error;
}

describe("original curriculum programs", () => {
  it("square-path program runs and calls the controller in order", async () => {
    const src = prog([
      "drivetrain.drive_for(FORWARD, 200, MM)    # direction, distance, units",
      "drivetrain.turn_for(RIGHT, 90, DEGREES)   # direction, angle, units",
      "drivetrain.drive_for(FORWARD, 400, MM)",
      "drivetrain.turn_for(LEFT, 90, DEGREES)",
      "wait(1, SECONDS)",
      "drivetrain.drive_for(REVERSE, 2, INCHES)",
    ]);
    const { res, st, rec } = await runProg(src);
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 6 });
    expect(st.calls).toEqual([
      "driveFor(FORWARD,200)", "turnFor(RIGHT,90)", "driveFor(FORWARD,400)", "turnFor(LEFT,90)", "wait(1)", "driveFor(REVERSE,50.8)",
    ]);
    const steps = rec.logs.filter((l) => l.kind === "step");
    expect(steps.map((s) => s.text)).toEqual([
      "drive_for(FORWARD, 200, MM)", "turn_for(RIGHT, 90, DEGREES)", "drive_for(FORWARD, 400, MM)",
      "turn_for(LEFT, 90, DEGREES)", "wait(1, SECONDS)", "drive_for(REVERSE, 2, INCHES)",
    ]);
    expect(steps.map((s) => s.line)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("starter template (only pass) finishes with 0 steps", async () => {
    const src = "# My robot program\n\ndef main():\n    pass\n\nstart(main)\n";
    const { res } = await runProg(src);
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 0 });
  });

  it("loops with range and print", async () => {
    const src = prog(["for i in range(4):", "    drivetrain.drive_for(FORWARD, 200, MM)", "    drivetrain.turn_for(RIGHT, 90, DEGREES)", "print('done', 4)"]);
    const { res, st, rec } = await runProg(src);
    expect(res.status).toBe("finished");
    expect(st.calls.length).toBe(8);
    expect(rec.logs.at(-1)).toEqual({ line: 5, text: "done 4", kind: "print" });
  });
});

describe("every API call", () => {
  it("drivetrain", async () => {
    const src = prog([
      "drivetrain.turn_to_heading(180, DEGREES)",
      "drivetrain.drive(FORWARD)", "drivetrain.turn(LEFT)", "drivetrain.stop()",
      "drivetrain.set_drive_velocity(75, PERCENT)", "drivetrain.set_turn_velocity(150, PERCENT)",
      "drivetrain.set_heading(0, DEGREES)",
      "print(drivetrain.heading(DEGREES), drivetrain.rotation(DEGREES), drivetrain.is_done())",
      "drivetrain.drive_for(FORWARD, -100, MM)", "drivetrain.turn_for(LEFT, -45, DEGREES)",
    ]);
    const { res, st, rec } = await runProg(src, { heading: 90 });
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual([
      "turnToHeading(180)", "drive(FORWARD)", "turn(LEFT)", "stop()", "setDriveVelocity(75)", "setTurnVelocity(100)",
      "setHeading(0)", "driveFor(REVERSE,100)", "turnFor(RIGHT,45)",
    ]);
    expect(rec.logs.find((l) => l.kind === "print")?.text).toBe("90.0 450.12 True");
    expect(rec.logs.some((l) => l.kind === "warn" && /150 became 100/.test(l.text))).toBe(true);
  });

  it("sensors", async () => {
    const src = prog([
      "print(distance.get_distance(MM), distance.get_distance(INCHES), distance.found_object())",
      "print(front_eye.near_object(), front_eye.detect(RED), front_eye.color() == RED, front_eye.brightness(PERCENT))",
      "print(down_eye.detect(BLACK), down_eye.color(), down_eye.brightness(PERCENT))",
      "print(bumper.pressed(), location.position(X, MM), location.position(Y, MM))",
    ]);
    const { res, rec } = await runProg(src);
    expect(res.status).toBe("finished");
    expect(rec.logs.filter((l) => l.kind === "print").map((l) => l.text)).toEqual([
      "254.0 10.0 True", "False True True 42", "True BLACK 7", "False -900.0 127.0",
    ]);
  });

  it("pen, magnet, brain, timer", async () => {
    const src = prog([
      "pen.set_pen_color(BLUE)", "pen.move(DOWN)", "pen.move(UP)", "magnet.energize(BOOST)", "magnet.energize(DROP)",
      "brain.screen.print('Hi', 3)", "brain.screen.new_line()", "brain.screen.clear_screen()",
      "print(brain.timer.time(SECONDS), brain.timer.time(MSEC))", "brain.timer.clear()", "wait(250, MSEC)",
    ]);
    const { res, st, rec } = await runProg(src);
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual(["setPenColor(BLUE)", "penDown(true)", "penDown(false)", "magnet(true)", "magnet(false)", "resetTimer()", "wait(0.25)"]);
    expect(rec.screen).toEqual([{ kind: "print", text: "Hi 3" }, { kind: "newline" }, { kind: "clear" }]);
    expect(rec.logs.find((l) => l.kind === "print")?.text).toBe("1.5 1500.0");
  });

  it("all constants are strings equal to their names", async () => {
    const src = "for c in [FORWARD, REVERSE, LEFT, RIGHT, MM, INCHES, DEGREES, SECONDS, MSEC, PERCENT, RED, GREEN, BLUE, YELLOW, ORANGE, PURPLE, WHITE, BLACK, NONE, UP, DOWN, BOOST, DROP, X, Y]:\n    print(c)\n";
    const { rec } = await runProg(src);
    expect(rec.logs.filter((l) => l.kind === "print").map((l) => l.text).join(" ")).toBe(
      "FORWARD REVERSE LEFT RIGHT MM INCHES DEGREES SECONDS MSEC PERCENT RED GREEN BLUE YELLOW ORANGE PURPLE WHITE BLACK NONE UP DOWN BOOST DROP X Y");
  });

  it("no pen -> friendly RuntimeError", async () => {
    const { res } = await runProg(prog(["pen.move(DOWN)"]), { pen: false });
    const e = expectError(res);
    expect(e.type).toBe("RuntimeError");
    expect(e.html).toContain("This playground has no pen.");
    expect(e.line).toBe(2);
  });
  it("no magnet -> friendly RuntimeError", async () => {
    const e = expectError((await runProg(prog(["magnet.energize(BOOST)"]), { magnet: false })).res);
    expect(e.html).toContain("This playground has no magnet.");
  });
});

describe("wait=False", () => {
  it("does not await the motion", async () => {
    const src = prog(["drivetrain.drive_for(FORWARD, 500, MM, wait=False)", "print(drivetrain.is_done())", "drivetrain.turn_for(RIGHT, 90, DEGREES, False)", "print('after')"]);
    const { res, st, rec } = await runProg(src, { hold: true });
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual(["driveFor(FORWARD,500)", "turnFor(RIGHT,90)"]);
    expect(st.pending.length).toBe(2);
    expect(rec.logs.filter((l) => l.kind === "step").map((l) => l.text)).toEqual([
      "drive_for(FORWARD, 500, MM, wait=False)", "turn_for(RIGHT, 90, DEGREES, wait=False)",
    ]);
  });
});

describe("imports", () => {
  it("math and random work", async () => {
    const src = "import math\nimport random\nprint(math.sqrt(16), math.floor(2.7))\nn = random.randint(1, 6)\nprint(1 <= n <= 6)\n";
    const { res, rec } = await runProg(src);
    expect(res).toMatchObject({ status: "finished", startCalled: false });
    expect(rec.logs.filter((l) => l.kind === "print").map((l) => l.text)).toEqual(["4.0 2", "True"]);
  });
  it("unknown module is a friendly ImportError", async () => {
    const e = expectError((await runProg("import vex\n")).res);
    expect(e.type).toBe("ImportError");
    expect(e.html).toContain("import math");
  });
});

describe("friendly errors", () => {
  it("syntax error", async () => {
    const e = expectError((await runProg(prog(["drivetrain.drive_for(FORWARD, 200 MM)"]))).res);
    expect(e.type).toBe("SyntaxError");
    expect(e.line).toBe(2);
    expect(e.html).toContain("Python says");
  });
  it("indentation error", async () => {
    const e = expectError((await runProg("def main():\ndrivetrain.drive_for(FORWARD, 200, MM)\n\nstart(main)\n")).res);
    expect(e.line).toBe(2);
    expect(e.html).toContain("Indenting problem");
  });
  it("NameError case hint", async () => {
    const e = expectError((await runProg(prog(["drivetrain.drive_for(forward, 200, MM)"]))).res);
    expect(e.type).toBe("NameError");
    expect(e.html).toContain("did you mean <code>FORWARD</code>");
  });
  it("typo suggestion for an object and a method", async () => {
    let e = expectError((await runProg(prog(["drivetrian.drive_for(FORWARD, 200, MM)"]))).res);
    expect(e.html).toContain("<code>drivetrain</code>");
    e = expectError((await runProg(prog(["drivetrain.drive_fro(FORWARD, 200, MM)"]))).res);
    expect(e.type).toBe("AttributeError");
    expect(e.html).toContain("drivetrain.drive_for");
    e = expectError((await runProg(prog(["bumper.is_pressed()"]))).res);
    expect(e.html).toContain("bumper.pressed");
  });
  it("method without its object", async () => {
    const e = expectError((await runProg(prog(["drive_for(FORWARD, 200, MM)"]))).res);
    expect(e.html).toContain("drivetrain.drive_for(FORWARD, 200, MM)");
  });
  it("missing start(main) finishes with a warning", async () => {
    const { res, st, rec } = await runProg("def main():\n    drivetrain.drive_for(FORWARD, 200, MM)\n");
    expect(res).toEqual({ status: "finished", startCalled: false, steps: 0 });
    expect(st.calls).toEqual([]);
    expect(rec.logs.at(-1)?.kind).toBe("warn");
  });
  it("start(main()) is caught before running", async () => {
    const { res, st } = await runProg("def main():\n    drivetrain.drive_for(FORWARD, 200, MM)\n\nstart(main())\n");
    const e = expectError(res);
    expect(e.line).toBe(4);
    expect(e.html).toContain("start(main)");
    expect(st.calls).toEqual([]);
  });
  it("sensor used as a function", async () => {
    const e = expectError((await runProg(prog(["if bumper():", "    pass"]))).res);
    expect(e.type).toBe("TypeError");
    expect(e.html).toContain("bumper.pressed()");
  });
  it("wrong argument counts on API calls", async () => {
    let e = expectError((await runProg(prog(["drivetrain.drive_for(FORWARD, 200)"]))).res);
    expect(e.html).toContain("drive_for needs 3 values: direction, distance, units");
    expect(e.html).toContain("You gave 2.");
    e = expectError((await runProg(prog(["bumper.pressed(1)"]))).res);
    expect(e.html).toContain("bumper.pressed() doesn&#39;t take any values");
    e = expectError((await runProg(prog(["wait()"]))).res);
    expect(e.html).toContain("wait needs 1 to 2 values");
    e = expectError((await runProg(prog(["drivetrain.drive_for(LEFT, 200, MM)"]))).res);
    expect(e.html).toContain("turn_for(LEFT, 90, DEGREES)");
    e = expectError((await runProg(prog(["drivetrain.drive_for(FORWARD, 200, 'mm')"]))).res);
    expect(e.html).toContain("Write MM in capitals");
    e = expectError((await runProg(prog(["drivetrain.drive_for(FORWARD, 200, MM, speed=5)"]))).res);
    expect(e.html).toContain("setting called");
  });
  it("ZeroDivisionError", async () => {
    const e = expectError((await runProg("x = 0\nprint(5 / x)\n")).res);
    expect(e.type).toBe("ZeroDivisionError");
    expect(e.line).toBe(2);
    expect(e.html).toContain("divided by zero");
  });
  it("escapes HTML", async () => {
    const e = expectError((await runProg("print(<b>)\n")).res);
    expect(e.html).not.toContain("<b>)");
    const e2 = expectError((await runProg("x = '<script>'\nx.foo()\n")).res);
    expect(e2.html).not.toContain("<script>");
  });
});

describe("stopping", () => {
  it("stop() during `while True: pass` resolves stopped promptly", async () => {
    const { ctl } = fakeController();
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts);
    const p = runner.run("while True:\n    pass\n");
    expect(runner.running).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    const t0 = Date.now();
    runner.stop();
    const res = await p;
    expect(res).toEqual({ status: "stopped" });
    expect(Date.now() - t0).toBeLessThan(100);
    expect(runner.running).toBe(false);
  });

  it("busy sensor loop lets timers (the sim loop) run", async () => {
    const { ctl, st } = fakeController({ bumperAfter: 1e9 });
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts);
    const p = runner.run(prog(["drivetrain.drive(FORWARD)", "while not bumper.pressed():", "    pass", "drivetrain.stop()"]));
    // simulate the app loop: after some "frames", the bumper gets pressed
    let frames = 0;
    await new Promise<void>((resolve) => {
      const tick = () => { frames++; if (frames === 5) { st.bumperAfter = st.bumperReads; resolve(); } else setTimeout(tick, 5); };
      setTimeout(tick, 5);
    });
    const res = await p;
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual(["drive(FORWARD)", "stop()"]);
  });

  it("STOPPED rejection -> stopped", async () => {
    const { ctl, st } = fakeController({ hold: true });
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts);
    const p = runner.run(prog(["try:", "    drivetrain.drive_for(FORWARD, 200, MM)", "except:", "    print('caught')", "drivetrain.drive_for(FORWARD, 1, MM)"]));
    await new Promise((r) => setTimeout(r, 10));
    st.pending[0].reject(new Error("STOPPED"));
    expect(await p).toEqual({ status: "stopped" });
    await new Promise((r) => setTimeout(r, 10));
    expect(st.calls).toEqual(["driveFor(FORWARD,200)", "stop()"]);
  });

  it("stop() while waiting on a motion that never finishes", async () => {
    const { ctl, st } = fakeController({ hold: true });
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts);
    const p = runner.run(prog(["wait(100, SECONDS)", "drivetrain.drive_for(FORWARD, 1, MM)"]));
    await new Promise((r) => setTimeout(r, 10));
    runner.stop();
    expect(await p).toEqual({ status: "stopped" });
    st.pending[0].resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(st.calls).toEqual(["wait(100)", "stop()"]);
  });

  it("can run again after a stop", async () => {
    const { ctl, st } = fakeController();
    const { opts } = recorder(ctl);
    const runner = createPythonRunner(opts);
    const p = runner.run("while True:\n    x = 1\n");
    await new Promise((r) => setTimeout(r, 30));
    runner.stop();
    await p;
    const res = await runner.run(prog(["drivetrain.drive_for(FORWARD, 10, MM)"]));
    expect(res).toEqual({ status: "finished", startCalled: true, steps: 1 });
    expect(st.calls).toEqual(["stop()", "driveFor(FORWARD,10)"]);
  });
});

describe("line tracking", () => {
  it("onLine fires with the executed lines", async () => {
    const src = "x = 1\ndef main():\n    y = 2\n    drivetrain.drive_for(FORWARD, 10, MM)\n    if y > 5:\n        print('no')\n    print('yes')\n\nstart(main)\n";
    const { rec } = await runProg(src);
    expect(rec.lines).toEqual([1, 2, 9, 3, 4, 5, 7]);
  });
});
