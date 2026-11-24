import { beforeAll, describe, expect, it } from "vitest";
import type { FlowChart, FlowEdge, FlowNode, NodeKind, Port } from "./model";
import { ACTIONS, READINGS, defaultArgs, nodeLabel, varNameProblem } from "./model";
import { generateFlowchart } from "./generate";
import { TEMPLATES, blankChart, isBlankChart, sanitizeChart, tidy } from "./chart";
import { loadSkulpt } from "../runtime/testkit";
import { runSolution } from "../activities/content/runSolution";
import { getPlayground } from "../worlds";

// ---------------------------------------------------------------- tiny chart builder
type Spec = [id: string, kind: NodeKind, op?: string, args?: Record<string, string>];
function chart(specs: Spec[], arrows: [string, Port, string][]): FlowChart {
  const nodes: FlowNode[] = specs.map(([id, kind, op, args], i) => ({
    id, kind, x: 0, y: i * 100, ...(op ? { op } : {}), args: { ...defaultArgs(kind, op), ...(args ?? {}) },
  }));
  const edges: FlowEdge[] = arrows.map(([from, port, to], i) => ({ id: `e${i}`, from, port, to }));
  return { format: "robot-lab-flowchart", version: 1, nodes, edges };
}
const S: Spec = ["s", "start"];
const E: Spec = ["end", "end"];
const drive = (id: string, dist = "100"): Spec => [id, "action", "drive_for", { dist }];
const say = (id: string, text: string): Spec => [id, "action", "print", { text, value: "" }];
const bump = (id: string): Spec => [id, "decision", undefined, { lhs: "bumper" }];
const varLt = (id: string, name: string, n: string): Spec => [id, "decision", undefined, { lhs: "var", name, cmp: "<", rhs: n }];

const gen = (c: FlowChart) => generateFlowchart(c);
/** main() body with its 4-space indent removed. */
function body(c: FlowChart): string {
  const g = gen(c);
  expect(g.error).toBeNull();
  const lines = g.code.split("\n");
  const i = lines.indexOf("def main():");
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (!l.startsWith("    ")) break; if (!l.startsWith("    global ")) out.push(l.slice(4)); }
  return out.join("\n");
}

describe("program shape", () => {
  it("a blank chart is def main / pass / start(main)", () => {
    expect(gen(blankChart()).code).toBe("def main():\n    pass\n\nstart(main)\n");
    expect(isBlankChart(blankChart())).toBe(true);
  });
  it("sequence", () => {
    const c = chart([S, drive("a", "200"), ["b", "action", "turn_for", { dir: "LEFT", angle: "90" }], E],
      [["s", "out", "a"], ["a", "out", "b"], ["b", "out", "end"]]);
    expect(gen(c).code).toBe("def main():\n    drivetrain.drive_for(FORWARD, 200, MM)\n    drivetrain.turn_for(LEFT, 90, DEGREES)\n\nstart(main)\n");
  });
  it("variables are globals initialised to 0", () => {
    const c = chart([S, ["a", "input", undefined, { reading: "distance_mm", var: "d" }],
      ["b", "action", "set_var", { var: "total", a: "d", math: "*", b: "2" }], E],
    [["s", "out", "a"], ["a", "out", "b"], ["b", "out", "end"]]);
    expect(gen(c).code).toBe("d = 0\ntotal = 0\n\ndef main():\n    global d, total\n    d = distance.get_distance(MM)\n    total = d * 2\n\nstart(main)\n");
  });
  it("a shape with no arrow out is an error pointing at it", () => {
    const c = chart([S, drive("a"), E], [["s", "out", "a"]]);
    expect(gen(c).error).toMatchObject({ nodeId: "a" });
    expect(gen(c).code).toContain("can't be turned into Python");
    expect(gen(c).code).toContain("start(main)");
  });
  it("diamonds need both arrows", () => {
    const c = chart([S, bump("d"), E], [["s", "out", "d"], ["d", "yes", "end"]]);
    expect(gen(c).error?.message).toMatch(/No arrow/);
    expect(gen(c).error?.nodeId).toBe("d");
  });
  it("unfinished settings are reported on the shape", () => {
    const c = chart([S, ["a", "action", "drive_for", { dist: "1 2" }], E], [["s", "out", "a"], ["a", "out", "end"]]);
    expect(gen(c).error).toMatchObject({ nodeId: "a" });
    const c2 = chart([S, ["a", "input", undefined, { reading: "bumper", var: "print" }], E], [["s", "out", "a"], ["a", "out", "end"]]);
    expect(gen(c2).error?.message).toMatch(/already used/);
  });
  it("disconnected shapes are ignored and not reachable", () => {
    const c = chart([S, drive("a"), drive("lonely"), E], [["s", "out", "a"], ["a", "out", "end"]]);
    const g = gen(c);
    expect(g.error).toBeNull();
    expect(g.reachable.has("lonely")).toBe(false);
    expect(g.reachable.has("end")).toBe(true);
  });
  it("two starts is an error", () => {
    const c = chart([S, ["s2", "start"], E], [["s", "out", "end"]]);
    expect(gen(c).error?.nodeId).toBe("s2");
  });
});

describe("decisions", () => {
  it("if (one branch empty)", () => {
    const c = chart([S, bump("d"), say("a", "hit"), say("b", "after"), E],
      [["s", "out", "d"], ["d", "yes", "a"], ["d", "no", "b"], ["a", "out", "b"], ["b", "out", "end"]]);
    expect(body(c)).toBe('if bumper.pressed():\n    print("hit")\nprint("after")');
  });
  it("if with only a No branch is written with not", () => {
    const c = chart([S, bump("d"), say("a", "free"), E],
      [["s", "out", "d"], ["d", "no", "a"], ["d", "yes", "end"], ["a", "out", "end"]]);
    expect(body(c)).toBe('if not bumper.pressed():\n    print("free")');
  });
  it("if / else rejoining", () => {
    const c = chart([S, ["d", "decision", undefined, { lhs: "distance_mm", cmp: "<", rhs: "200" }], say("a", "near"), say("b", "far"), say("c", "done"), E],
      [["s", "out", "d"], ["d", "yes", "a"], ["d", "no", "b"], ["a", "out", "c"], ["b", "out", "c"], ["c", "out", "end"]]);
    expect(body(c)).toBe('if distance.get_distance(MM) < 200:\n    print("near")\nelse:\n    print("far")\nprint("done")');
  });
  it("if / else where each branch has its own End", () => {
    const c = chart([S, bump("d"), say("a", "y"), say("b", "n"), E, ["end2", "end"]],
      [["s", "out", "d"], ["d", "yes", "a"], ["d", "no", "b"], ["a", "out", "end"], ["b", "out", "end2"]]);
    expect(body(c)).toBe('if bumper.pressed():\n    print("y")\nelse:\n    print("n")');
  });
  it("nested if", () => {
    const c = chart([S, bump("d1"), ["d2", "decision", undefined, { lhs: "down_detect", color: "BLACK" }], say("a", "A"), say("b", "B"), say("c", "C"), say("z", "Z"), E],
      [["s", "out", "d1"], ["d1", "yes", "d2"], ["d1", "no", "c"], ["d2", "yes", "a"], ["d2", "no", "b"],
        ["a", "out", "z"], ["b", "out", "z"], ["c", "out", "z"], ["z", "out", "end"]]);
    expect(body(c)).toBe([
      "if bumper.pressed():", "    if down_eye.detect(BLACK):", '        print("A")', "    else:", '        print("B")',
      "else:", '    print("C")', 'print("Z")'].join("\n"));
  });
  it("comparisons on colours, variables, controller buttons", () => {
    const one = (args: Record<string, string>) => body(chart([S, ["d", "decision", undefined, args], say("a", "x"), E],
      [["s", "out", "d"], ["d", "yes", "a"], ["d", "no", "end"], ["a", "out", "end"]])).split("\n")[0];
    expect(one({ lhs: "front_color", cmp: "==", rhs: "RED" })).toBe("if front_eye.color() == RED:");
    expect(one({ lhs: "buttonA" })).toBe("if controller.buttonA.pressing():");
    expect(one({ lhs: "var", name: "hit", cmp: "true" })).toBe("if hit:");
    expect(one({ lhs: "axis3", cmp: ">=", rhs: "-50" })).toBe("if controller.axis3.position() >= -50:");
    expect(one({ lhs: "var", name: "n", cmp: "!=", rhs: "m" })).toBe("if n != m:");
  });
});

describe("loops", () => {
  it("while with the test at the top (Yes stays in)", () => {
    const c = chart([S, ["i", "action", "set_var", { var: "n", a: "0", math: "" }], varLt("d", "n", "3"), drive("a"),
      ["inc", "action", "set_var", { var: "n", a: "n", math: "+", b: "1" }], E],
    [["s", "out", "i"], ["i", "out", "d"], ["d", "yes", "a"], ["a", "out", "inc"], ["inc", "out", "d"], ["d", "no", "end"]]);
    expect(body(c)).toBe("n = 0\nwhile n < 3:\n    drivetrain.drive_for(FORWARD, 100, MM)\n    n = n + 1");
  });
  it("while not (No stays in): drive until the bumper", () => {
    const c = chart([S, bump("d"), drive("a"), ["st", "action", "stop"], E],
      [["s", "out", "d"], ["d", "no", "a"], ["a", "out", "d"], ["d", "yes", "st"], ["st", "out", "end"]]);
    expect(body(c)).toBe("while not bumper.pressed():\n    drivetrain.drive_for(FORWARD, 100, MM)\ndrivetrain.stop()");
  });
  it("a diamond looping to itself waits", () => {
    const c = chart([S, bump("d"), E], [["s", "out", "d"], ["d", "no", "d"], ["d", "yes", "end"]]);
    expect(body(c)).toBe("while not bumper.pressed():\n    wait(5, MSEC)");
  });
  it("test at the bottom is rotated into a while loop without break", () => {
    const c = chart([S, ["r", "input", undefined, { reading: "distance_mm", var: "d" }], ["q", "decision", undefined, { lhs: "var", name: "d", cmp: ">", rhs: "200" }],
      ["go", "action", "drive", { dir: "FORWARD" }], ["st", "action", "stop"], E],
    [["s", "out", "r"], ["r", "out", "q"], ["q", "yes", "go"], ["go", "out", "r"], ["q", "no", "st"], ["st", "out", "end"]]);
    const b = body(c);
    expect(b).toBe("d = distance.get_distance(MM)\nwhile d > 200:\n    drivetrain.drive(FORWARD)\n    d = distance.get_distance(MM)\ndrivetrain.stop()");
    expect(gen(c).code).not.toMatch(/\bbreak\b/);
  });
  it("do-while (body then question, back to the top)", () => {
    const c = chart([S, drive("a"), bump("q"), E], [["s", "out", "a"], ["a", "out", "q"], ["q", "no", "a"], ["q", "yes", "end"]]);
    expect(body(c)).toBe("drivetrain.drive_for(FORWARD, 100, MM)\nwhile not bumper.pressed():\n    drivetrain.drive_for(FORWARD, 100, MM)");
  });
  it("forever loop", () => {
    const c = chart([S, drive("a"), ["b", "action", "turn_for", {}]], [["s", "out", "a"], ["a", "out", "b"], ["b", "out", "a"]]);
    expect(body(c)).toBe("while True:\n    drivetrain.drive_for(FORWARD, 100, MM)\n    drivetrain.turn_for(RIGHT, 90, DEGREES)");
  });
  it("forever loop with an if inside", () => {
    const c = chart([S, bump("d"), ["l", "action", "turn_for", { dir: "LEFT" }], drive("a")],
      [["s", "out", "d"], ["d", "yes", "l"], ["d", "no", "a"], ["l", "out", "d"], ["a", "out", "d"]]);
    expect(body(c)).toBe("while True:\n    if bumper.pressed():\n        drivetrain.turn_for(LEFT, 90, DEGREES)\n    else:\n        drivetrain.drive_for(FORWARD, 100, MM)");
  });
  it("nested loops", () => {
    const c = chart([S, ["i0", "action", "set_var", { var: "i", a: "0", math: "" }], varLt("di", "i", "4"),
      ["j0", "action", "set_var", { var: "j", a: "0", math: "" }], varLt("dj", "j", "2"), drive("a"),
      ["j1", "action", "set_var", { var: "j", a: "j", math: "+", b: "1" }],
      ["t", "action", "turn_for", {}], ["i1", "action", "set_var", { var: "i", a: "i", math: "+", b: "1" }], E],
    [["s", "out", "i0"], ["i0", "out", "di"], ["di", "yes", "j0"], ["j0", "out", "dj"], ["dj", "yes", "a"], ["a", "out", "j1"], ["j1", "out", "dj"],
      ["dj", "no", "t"], ["t", "out", "i1"], ["i1", "out", "di"], ["di", "no", "end"]]);
    expect(body(c)).toBe([
      "i = 0", "while i < 4:", "    j = 0", "    while j < 2:", "        drivetrain.drive_for(FORWARD, 100, MM)", "        j = j + 1",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)", "    i = i + 1"].join("\n"));
  });
  it("while loop inside a forever loop", () => {
    const c = chart([S, ["o", "action", "set_velocity", {}], bump("d"), drive("a"), ["b", "action", "turn_for", {}]],
      [["s", "out", "o"], ["o", "out", "d"], ["d", "no", "a"], ["a", "out", "d"], ["d", "yes", "b"], ["b", "out", "o"]]);
    expect(body(c)).toBe("while True:\n    drivetrain.set_drive_velocity(50, PERCENT)\n    while not bumper.pressed():\n        drivetrain.drive_for(FORWARD, 100, MM)\n    drivetrain.turn_for(RIGHT, 90, DEGREES)");
  });
});

describe("unstructured graphs are rejected with a pointer", () => {
  it("an arrow jumping into the middle of a loop", () => {
    // loop a → b → q → a, plus an arrow from x straight into b
    const c = chart([S, bump("x"), drive("a"), drive("b"), bump("q"), E],
      [["s", "out", "x"], ["x", "yes", "a"], ["x", "no", "b"], ["a", "out", "b"], ["b", "out", "q"], ["q", "no", "a"], ["q", "yes", "end"]]);
    const g = gen(c);
    expect(g.error?.message).toMatch(/jumps into the middle of a loop/);
    expect(g.error?.edgeId).toBeDefined();
    const bad = c.edges.find((e) => e.id === g.error!.edgeId)!;
    expect(["a", "b"]).toContain(bad.to);
    expect(bad.from).toBe("x");
  });
  it("two ways out of one loop (would need break)", () => {
    const c = chart([S, bump("q1"), drive("a"), ["q2", "decision", undefined, { lhs: "found_object" }], E, ["end2", "end"]],
      [["s", "out", "q1"], ["q1", "no", "a"], ["q1", "yes", "end"], ["a", "out", "q2"], ["q2", "no", "q1"], ["q2", "yes", "end2"]]);
    const g = gen(c);
    expect(g.error?.message).toMatch(/second way out/);
    expect(g.error?.edgeId).toBeDefined();
    expect(g.code).not.toMatch(/\bbreak\b/);
  });
  it("an arrow leaving two loops at once", () => {
    const c = chart([S, drive("o"), bump("q"), drive("a")],
      [["s", "out", "o"], ["o", "out", "q"], ["q", "no", "a"], ["a", "out", "q"], ["q", "yes", "o"]]);
    // inner loop q↔a, its exit goes back to o: fine (forever outer loop)
    expect(gen(c).error).toBeNull();
    const c2 = chart([S, drive("o"), bump("q"), drive("a"), ["q2", "decision", undefined, { lhs: "found_object" }], E],
      [["s", "out", "o"], ["o", "out", "q2"], ["q2", "yes", "end"], ["q2", "no", "q"], ["q", "no", "a"], ["a", "out", "q"], ["q", "yes", "o"]]);
    expect(gen(c2).error).toBeNull();
    const c3 = chart([S, drive("o"), bump("q"), drive("a"), E],
      [["s", "out", "o"], ["o", "out", "q"], ["q", "no", "a"], ["a", "out", "end"], ["q", "yes", "q"]]);
    // q waits on itself, otherwise ends: no outer loop at all
    expect(gen(c3).error).toBeNull();
  });
  it("loop that goes round without passing the exit diamond", () => {
    const c = chart([S, bump("h"), drive("a"), bump("x"), E],
      [["s", "out", "h"], ["h", "yes", "a"], ["h", "no", "x"], ["a", "out", "h"], ["x", "no", "h"], ["x", "yes", "end"]]);
    const g = gen(c);
    expect(g.error).not.toBeNull();
    expect(g.error!.edgeId).toBeDefined();
  });
  it("cross-branch arrows are written in both branches, still correct", () => {
    const c = chart([S, bump("d1"), ["d2", "decision", undefined, { lhs: "found_object" }], say("x", "X"), say("y", "Y"), say("z", "Z"), E],
      [["s", "out", "d1"], ["d1", "yes", "d2"], ["d1", "no", "x"], ["d2", "yes", "x"], ["d2", "no", "y"], ["x", "out", "z"], ["y", "out", "z"], ["z", "out", "end"]]);
    expect(body(c)).toBe('if bumper.pressed():\n    if distance.found_object():\n        print("X")\n    else:\n        print("Y")\nelse:\n    print("X")\nprint("Z")');
  });
});

describe("every action matches docs/API.md", () => {
  const code = (op: string, args: Record<string, string> = {}) =>
    body(chart([S, ["a", "action", op, args], E], [["s", "out", "a"], ["a", "out", "end"]]));
  it("commands", () => {
    expect(code("drive_for", { dir: "REVERSE", dist: "5", units: "INCHES" })).toBe("drivetrain.drive_for(REVERSE, 5, INCHES)");
    expect(code("turn_for", { dir: "LEFT", angle: "45" })).toBe("drivetrain.turn_for(LEFT, 45, DEGREES)");
    expect(code("turn_to_heading", { angle: "180" })).toBe("drivetrain.turn_to_heading(180, DEGREES)");
    expect(code("drive", { dir: "REVERSE" })).toBe("drivetrain.drive(REVERSE)");
    expect(code("turn", { dir: "LEFT" })).toBe("drivetrain.turn(LEFT)");
    expect(code("stop")).toBe("drivetrain.stop()");
    expect(code("set_velocity", { kind: "drive", value: "75" })).toBe("drivetrain.set_drive_velocity(75, PERCENT)");
    expect(code("set_velocity", { kind: "turn", value: "30" })).toBe("drivetrain.set_turn_velocity(30, PERCENT)");
    expect(code("wait", { time: "0.5", units: "SECONDS" })).toBe("wait(0.5, SECONDS)");
    expect(code("wait", { time: "20", units: "MSEC" })).toBe("wait(20, MSEC)");
    expect(code("pen", { pos: "DOWN" })).toBe("pen.move(DOWN)");
    expect(code("pen", { pos: "UP" })).toBe("pen.move(UP)");
    expect(code("pen_color", { color: "RED" })).toBe("pen.set_pen_color(RED)");
    expect(code("magnet", { mode: "BOOST" })).toBe("magnet.energize(BOOST)");
    expect(code("magnet", { mode: "DROP" })).toBe("magnet.energize(DROP)");
    expect(code("print", { text: "Hi", value: "" })).toBe('print("Hi")');
    expect(code("print", { text: 'say "x"', value: "n" })).toBe('print("say \\"x\\"", n)');
    expect(code("screen_print", { text: "d =", value: "d", newline: "yes" })).toBe('brain.screen.print("d =", d)\nbrain.screen.new_line()');
    expect(code("screen_print", { text: "", value: "d", newline: "no" })).toBe("brain.screen.print(d)");
    expect(code("screen_clear")).toBe("brain.screen.clear_screen()");
    expect(code("timer_clear")).toBe("brain.timer.clear()");
    expect(code("motor_spin", { motor: "right_motor", dir: "REVERSE", velocity: "-40" })).toBe("right_motor.spin(REVERSE, -40, PERCENT)");
    expect(code("motor_stop", { motor: "left_motor" })).toBe("left_motor.stop()");
    expect(code("set_var", { var: "x", a: "3", math: "" })).toBe("x = 3");
    expect(code("set_var", { var: "x", a: "x", math: "-", b: "1.5" })).toBe("x = x - 1.5");
    for (const op of Object.keys(ACTIONS)) expect(code(op)).toBeTruthy();
  });
  it("inputs and outputs", () => {
    const inp = (reading: string, color = "BLACK") =>
      body(chart([S, ["a", "input", undefined, { reading, var: "v", color }], E], [["s", "out", "a"], ["a", "out", "end"]]));
    const expected: Record<string, string> = {
      distance_mm: "distance.get_distance(MM)", distance_in: "distance.get_distance(INCHES)", found_object: "distance.found_object()",
      bumper: "bumper.pressed()", near_object: "front_eye.near_object()", front_detect: "front_eye.detect(BLACK)", down_detect: "down_eye.detect(BLACK)",
      front_color: "front_eye.color()", down_color: "down_eye.color()", front_brightness: "front_eye.brightness(PERCENT)",
      down_brightness: "down_eye.brightness(PERCENT)", heading: "drivetrain.heading(DEGREES)", rotation: "drivetrain.rotation(DEGREES)",
      is_done: "drivetrain.is_done()", pos_x: "location.position(X, MM)", pos_y: "location.position(Y, MM)",
      timer_s: "brain.timer.time(SECONDS)", timer_ms: "brain.timer.time(MSEC)",
      axis1: "controller.axis1.position()", axis4: "controller.axis4.position()", buttonA: "controller.buttonA.pressing()", buttonL2: "controller.buttonL2.pressing()",
    };
    for (const [r, c] of Object.entries(expected)) expect(inp(r)).toBe(`v = ${c}`);
    expect(READINGS.length).toBe(18 + 4 + 12);
    const out = body(chart([S, ["a", "output", undefined, { to: "log", text: "n:", value: "n" }], E], [["s", "out", "a"], ["a", "out", "end"]]));
    expect(out).toBe('print("n:", n)');
  });
  it("labels read like the flowchart", () => {
    const n = (kind: NodeKind, op: string | undefined, args: Record<string, string>): FlowNode =>
      ({ id: "x", kind, x: 0, y: 0, op, args: { ...defaultArgs(kind, op), ...args } });
    expect(nodeLabel(n("input", undefined, { reading: "distance_mm", var: "d" }))).toBe("distance (mm) → d");
    expect(nodeLabel(n("decision", undefined, { lhs: "distance_mm", cmp: "<", rhs: "200" }))).toBe("distance < 200?");
    expect(nodeLabel(n("decision", undefined, { lhs: "down_detect", color: "BLACK" }))).toBe("down eye sees BLACK?");
    expect(nodeLabel(n("decision", undefined, { lhs: "buttonA" }))).toBe("button A pressed?");
    expect(nodeLabel(n("action", "drive_for", {}))).toBe("drive forward 200 mm");
  });
  it("variable names are validated", () => {
    expect(varNameProblem("d")).toBe("");
    expect(varNameProblem("2x")).not.toBe("");
    expect(varNameProblem("my var")).not.toBe("");
    expect(varNameProblem("distance")).not.toBe("");
    expect(varNameProblem("while")).not.toBe("");
  });
});

describe("line map", () => {
  it("maps each line to the shape that made it", () => {
    const c = chart([S, bump("d"), drive("a"), ["st", "action", "stop"], E],
      [["s", "out", "d"], ["d", "no", "a"], ["a", "out", "d"], ["d", "yes", "st"], ["st", "out", "end"]]);
    const g = gen(c);
    const lines = g.code.split("\n");
    const at = (text: string) => g.lineMap[lines.findIndex((l) => l.trim() === text)];
    expect(at("def main():")).toBe("s");
    expect(at("while not bumper.pressed():")).toBe("d");
    expect(at("drivetrain.drive_for(FORWARD, 100, MM)")).toBe("a");
    expect(at("drivetrain.stop()")).toBe("st");
    expect(at("start(main)")).toBe("s");
    expect(g.lineMap.length).toBe(lines.length - 1);
  });
  it("else lines belong to their diamond; duplicated (rotated) lines map to the same shape", () => {
    const c = chart([S, drive("a"), bump("q"), E], [["s", "out", "a"], ["a", "out", "q"], ["q", "no", "a"], ["q", "yes", "end"]]);
    const g = gen(c);
    const ids = g.code.split("\n").map((l, i) => [l.trim(), g.lineMap[i]] as const).filter(([l]) => l.startsWith("drivetrain"));
    expect(ids.map((x) => x[1])).toEqual(["a", "a"]);
  });
});

describe("saving: sanitise and round-trip", () => {
  it("round-trips every template", () => {
    for (const t of TEMPLATES) {
      const c = t.make();
      const back = sanitizeChart(JSON.parse(JSON.stringify(c)))!;
      expect(back.chart).toEqual(c);
      expect(back.warnings).toEqual([]);
      expect(gen(back.chart).code).toBe(gen(c).code);
    }
  });
  it("rejects non-charts", () => {
    for (const bad of [null, 5, "x", [], {}, { nodes: 3 }, { format: "other", nodes: [] }]) expect(sanitizeChart(bad)).toBeNull();
  });
  it("drops hostile or broken parts", () => {
    const raw = {
      nodes: [
        { id: "s", kind: "start", x: 1e12, y: NaN },
        { id: "s2", kind: "start", x: 0, y: 0 },
        { id: "a", kind: "action", op: "__proto__", args: {} },
        { id: "b", kind: "action", op: "drive_for", args: { dir: "SIDEWAYS", dist: "1".repeat(500), units: "MM", evil: "<script>", __proto__: { x: 1 } } },
        { id: "<img>", kind: "end" },
        { id: "c", kind: "teleport" },
        { id: "d", kind: "decision", args: { lhs: "nope", cmp: "true" } },
        { id: "o", kind: "output", args: { text: "a\u0000b".repeat(100) } },
        { id: "b", kind: "end" },
      ],
      edges: [
        { id: "e1", from: "s", port: "out", to: "b" },
        { id: "e1", from: "b", port: "out", to: "s" },   // into Start
        { id: "e3", from: "b", port: "yes", to: "d" },   // bad port
        { id: "e4", from: "b", port: "out", to: "d" },   // second arrow from the same port
        { id: "e5", from: "d", port: "yes", to: "ghost" },
        { id: "e6", from: "d", port: "no", to: "o" },
      ],
    };
    const r = sanitizeChart(raw)!;
    expect(r.chart.nodes.map((n) => n.id)).toEqual(["s", "b", "d", "o"]);
    const s = r.chart.nodes[0];
    expect(Math.abs(s.x)).toBeLessThanOrEqual(20000);
    expect(s.y).toBe(0);
    const b = r.chart.nodes[1];
    expect(b.args.dir).toBe("FORWARD");
    expect(b.args.dist.length).toBeLessThanOrEqual(32);
    expect(b.args).not.toHaveProperty("evil");
    expect(r.chart.nodes[2].args.lhs).toBe("bumper");
    expect(r.chart.nodes[3].args.text).not.toContain("\u0000");
    expect(r.chart.nodes[3].args.text.length).toBeLessThanOrEqual(60);
    expect(r.chart.edges.map((e) => [e.from, e.port, e.to])).toEqual([["s", "out", "b"], ["b", "out", "d"], ["d", "no", "o"]]);
    expect(new Set(r.chart.edges.map((e) => e.id)).size).toBe(3);
  });
  it("caps the number of shapes and adds a missing Start", () => {
    const many = { nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, kind: "end", x: 0, y: 0 })), edges: [] };
    const r = sanitizeChart(many)!;
    expect(r.chart.nodes.length).toBe(201);
    expect(r.chart.nodes[0].kind).toBe("start");
    expect(r.warnings.length).toBe(1);
  });
  it("tidy up keeps the program and puts shapes on the grid without overlaps", () => {
    for (const t of TEMPLATES) {
      const c = t.make();
      const shuffled = { ...c, nodes: c.nodes.map((n, i) => ({ ...n, x: i * 7, y: 3 })) };
      const tidied = tidy(shuffled);
      expect(gen(tidied).code).toBe(gen(c).code);
      const spots = new Set(tidied.nodes.map((n) => `${n.x},${n.y}`));
      expect(spots.size).toBe(tidied.nodes.length);
      for (const n of tidied.nodes) { expect(n.x % 20).toBe(0); expect(n.y % 20).toBe(0); }
    }
  });
});

describe("starter templates run on the real sim + runtime", () => {
  beforeAll(() => loadSkulpt());
  const world = () => getPlayground("number-grid")!;

  it("templates generate the expected Python", () => {
    const code = (id: string) => gen(TEMPLATES.find((t) => t.id === id)!.make()).code;
    expect(code("square")).toContain("while count < 4:");
    expect(code("wall")).toBe("hit = 0\n\ndef main():\n    global hit\n    drivetrain.drive(FORWARD)\n    hit = bumper.pressed()\n    while not hit:\n        hit = bumper.pressed()\n    drivetrain.stop()\n\nstart(main)\n");
    expect(code("driver")).toContain("while True:\n        left = controller.axis3.position()");
  });

  it("Drive a square comes back to the start", async () => {
    const r = await runSolution(world(), gen(TEMPLATES[0].make()).code);
    expect(r.result?.status).toBe("finished");
    const { x, y, heading } = r.sim.state.robot;
    const start = world().start;
    expect(Math.hypot(x - start.x, y - start.y)).toBeLessThan(15);
    expect(Math.round(heading) % 360).toBe(0);
  }, 30000);

  it("Stop at the wall ends touching the wall", async () => {
    const r = await runSolution(world(), gen(TEMPLATES[1].make()).code);
    expect(r.result?.status).toBe("finished");
    expect(r.sim.state.robot.y).toBeGreaterThan(800);
    expect(r.sim.state.bumperPressed).toBe(true);
  }, 30000);

  it("Driver control drives with the left stick", async () => {
    const w = world();
    const r = await runSolution(w, gen(TEMPLATES[2].make()).code, {
      script: { timeline: [{ t: 0.2, axes: { axis3: 80, axis2: 80 } }, { t: 1.2 }], stopAt: 1.6 },
    });
    expect(r.result?.status).toBe("stopped");
    expect(r.sim.state.robot.y - w.start.y).toBeGreaterThan(100);
  }, 30000);
});
