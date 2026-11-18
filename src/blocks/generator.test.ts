// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as Blockly from "blockly";
import { generateProgram } from "./generator";
import { HAT_TYPE } from "./definitions";
import { loadState, saveState } from "./workspace";
import { buildToolbox } from "./toolbox";

type J = Record<string, unknown>;
const num = (v: number) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
const chain = (blocks: J[]): J | undefined =>
  blocks.reduceRight<J | undefined>((next, b) => ({ ...b, ...(next ? { next: { block: next } } : {}) }), undefined);

function wsWith(body: J[], extraTop: J[] = [], variables: J[] = []): Blockly.Workspace {
  const ws = new Blockly.Workspace();
  const first = chain(body);
  loadState(ws, {
    blocks: { languageVersion: 0, blocks: [
      { type: HAT_TYPE, x: 0, y: 0, ...(first ? { inputs: { DO: { block: first } } } : {}) },
      ...extraTop,
    ] },
    ...(variables.length ? { variables } : {}),
  });
  return ws;
}
const py = (body: J[], extraTop: J[] = [], variables: J[] = []) => generateProgram(wsWith(body, extraTop, variables)).code;
/** The indented lines of main(), with the 4-space main indent removed. */
const mainBody = (code: string) => {
  const lines = code.split("\n");
  const i = lines.indexOf("def main():");
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (!l.startsWith("    ")) break; out.push(l.slice(4)); }
  return out.join("\n");
};
const one = (b: J) => mainBody(py([b]));
/** Wrap a reporter in a log print so its expression can be checked. */
const expr = (b: J) => one({ type: "robot_print_log", inputs: { VALUE: { block: b } } }).replace(/^print\((.*)\)$/, "$1");

describe("program shape", () => {
  it("empty program is exactly def main / pass / start(main)", () => {
    expect(py([])).toBe("def main():\n    pass\n\nstart(main)\n");
  });
  it("fresh workspace has exactly one hat", () => {
    const ws = new Blockly.Workspace();
    loadState(ws, null);
    expect(ws.getBlocksByType(HAT_TYPE, false)).toHaveLength(1);
    expect(ws.getBlocksByType(HAT_TYPE, false)[0].isDeletable()).toBe(false);
  });
  it("adds imports only when used, sorted, at the top", () => {
    expect(py([{ type: "robot_stop" }])).not.toContain("import");
    const code = py([
      { type: "robot_print_log", inputs: { VALUE: { block: { type: "math_single", fields: { OP: "ROOT" }, inputs: { NUM: num(9) } } } } },
      { type: "robot_print_log", inputs: { VALUE: { block: { type: "math_random_int", inputs: { FROM: num(1), TO: num(6) } } } } },
    ]);
    expect(code.startsWith("import math\nimport random\n\ndef main():\n")).toBe(true);
    expect(mainBody(code)).toBe("print(math.sqrt(9))\nprint(random.randint(1, 6))");
  });
  it("variables are initialised to 0 and declared global in main", () => {
    const code = py([{ type: "variables_set", fields: { VAR: { id: "v" } }, inputs: { VALUE: num(5) } },
      { type: "math_change", fields: { VAR: { id: "v" } }, inputs: { DELTA: num(1) } }], [], [{ name: "score", id: "v" }]);
    expect(code).toBe("score = 0\n\ndef main():\n    global score\n    score = 5\n    score = score + 1\n\nstart(main)\n");
    expect(code).not.toContain("numbers");
  });
  it("My Blocks functions are emitted before main", () => {
    const code = py([{ type: "procedures_callnoreturn", extraState: { name: "square" } }],
      [{ type: "procedures_defnoreturn", x: 0, y: 400, fields: { NAME: "square" },
        inputs: { STACK: { block: { type: "robot_drive_for", inputs: { DIST: num(100) } } } } }]);
    expect(code).toBe("def square():\n    drivetrain.drive_for(FORWARD, 100, MM)\n\ndef main():\n    square()\n\nstart(main)\n");
  });
  it("is deterministic", () => {
    const body = [{ type: "robot_repeat", inputs: { TIMES: num(3), DO: { block: { type: "robot_repeat", inputs: { TIMES: num(2) } } } } }];
    expect(py(body)).toBe(py(body));
    const ws = wsWith(body);
    expect(generateProgram(ws).code).toBe(generateProgram(ws).code);
  });
});

describe("custom blocks match docs/API.md", () => {
  const S: [J, string][] = [
    [{ type: "robot_drive_for", inputs: { DIST: num(200) } }, "drivetrain.drive_for(FORWARD, 200, MM)"],
    [{ type: "robot_drive_for", fields: { DIR: "REVERSE", UNITS: "INCHES", WAIT: false }, inputs: { DIST: num(5) } }, "drivetrain.drive_for(REVERSE, 5, INCHES, wait=False)"],
    [{ type: "robot_turn_for", inputs: { ANGLE: num(90) } }, "drivetrain.turn_for(RIGHT, 90, DEGREES)"],
    [{ type: "robot_turn_for", fields: { DIR: "LEFT", WAIT: false }, inputs: { ANGLE: num(45) } }, "drivetrain.turn_for(LEFT, 45, DEGREES, wait=False)"],
    [{ type: "robot_turn_to_heading", inputs: { ANGLE: num(180) } }, "drivetrain.turn_to_heading(180, DEGREES)"],
    [{ type: "robot_drive", fields: { DIR: "REVERSE" } }, "drivetrain.drive(REVERSE)"],
    [{ type: "robot_turn", fields: { DIR: "LEFT" } }, "drivetrain.turn(LEFT)"],
    [{ type: "robot_stop" }, "drivetrain.stop()"],
    [{ type: "robot_set_velocity", inputs: { VALUE: num(80) } }, "drivetrain.set_drive_velocity(80, PERCENT)"],
    [{ type: "robot_set_velocity", fields: { KIND: "turn" }, inputs: { VALUE: num(30) } }, "drivetrain.set_turn_velocity(30, PERCENT)"],
    [{ type: "robot_set_heading", inputs: { ANGLE: num(0) } }, "drivetrain.set_heading(0, DEGREES)"],
    [{ type: "robot_reset_timer" }, "brain.timer.clear()"],
    [{ type: "robot_pen_move" }, "pen.move(DOWN)"],
    [{ type: "robot_pen_move", fields: { POS: "UP" } }, "pen.move(UP)"],
    [{ type: "robot_pen_color", fields: { COLOR: "BLUE" } }, "pen.set_pen_color(BLUE)"],
    [{ type: "robot_magnet" }, "magnet.energize(BOOST)"],
    [{ type: "robot_magnet", fields: { MODE: "DROP" } }, "magnet.energize(DROP)"],
    [{ type: "robot_screen_print", inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "Hi" } } } } }, "brain.screen.print('Hi')"],
    [{ type: "robot_screen_newline" }, "brain.screen.new_line()"],
    [{ type: "robot_screen_clear" }, "brain.screen.clear_screen()"],
    [{ type: "robot_print_log", inputs: { VALUE: num(7) } }, "print(7)"],
    [{ type: "robot_print_log" }, "print('')"],
    [{ type: "robot_wait", inputs: { TIME: num(1) } }, "wait(1, SECONDS)"],
    [{ type: "robot_wait", fields: { UNITS: "MSEC" }, inputs: { TIME: num(250) } }, "wait(250, MSEC)"],
    [{ type: "robot_repeat", inputs: { TIMES: num(4) } }, "for count in range(4):\n    pass"],
    [{ type: "robot_forever" }, "while True:\n    pass"],
    [{ type: "robot_if", inputs: { COND: { block: { type: "robot_bumper" } } } }, "if bumper.pressed():\n    pass"],
    [{ type: "robot_if_else", inputs: { COND: { block: { type: "robot_bumper" } } } }, "if bumper.pressed():\n    pass\nelse:\n    pass"],
    [{ type: "robot_wait_until", inputs: { COND: { block: { type: "robot_is_done" } } } }, "while not drivetrain.is_done():\n    wait(5, MSEC)"],
    [{ type: "robot_repeat_until", inputs: { COND: { block: { type: "robot_front_near" } } } }, "while not front_eye.near_object():\n    pass"],
    [{ type: "robot_forever", inputs: { DO: { block: { type: "robot_break" } } } }, "while True:\n    break"],
  ];
  for (const [b, want] of S) it(`${b.type} ${JSON.stringify(b.fields ?? {})}`, () => expect(one(b)).toBe(want));

  const R: [J, string][] = [
    [{ type: "robot_heading" }, "drivetrain.heading(DEGREES)"],
    [{ type: "robot_rotation" }, "drivetrain.rotation(DEGREES)"],
    [{ type: "robot_is_done" }, "drivetrain.is_done()"],
    [{ type: "robot_distance" }, "distance.get_distance(MM)"],
    [{ type: "robot_distance", fields: { UNITS: "INCHES" } }, "distance.get_distance(INCHES)"],
    [{ type: "robot_distance_found" }, "distance.found_object()"],
    [{ type: "robot_front_near" }, "front_eye.near_object()"],
    [{ type: "robot_eye_detect", fields: { EYE: "front_eye", COLOR: "GREEN" } }, "front_eye.detect(GREEN)"],
    [{ type: "robot_eye_detect", fields: { EYE: "down_eye", COLOR: "BLACK" } }, "down_eye.detect(BLACK)"],
    [{ type: "robot_eye_color" }, "front_eye.color()"],
    [{ type: "robot_eye_color", fields: { EYE: "down_eye" } }, "down_eye.color()"],
    [{ type: "robot_eye_brightness" }, "front_eye.brightness(PERCENT)"],
    [{ type: "robot_eye_brightness", fields: { EYE: "down_eye" } }, "down_eye.brightness(PERCENT)"],
    [{ type: "robot_color_value", fields: { COLOR: "PURPLE" } }, "PURPLE"],
    [{ type: "robot_bumper" }, "bumper.pressed()"],
    [{ type: "robot_position" }, "location.position(X, MM)"],
    [{ type: "robot_position", fields: { AXIS: "Y" } }, "location.position(Y, MM)"],
    [{ type: "robot_timer" }, "brain.timer.time(SECONDS)"],
    [{ type: "robot_timer", fields: { UNITS: "MSEC" } }, "brain.timer.time(MSEC)"],
  ];
  for (const [b, want] of R) it(`reporter ${b.type} ${JSON.stringify(b.fields ?? {})}`, () => expect(expr(b)).toBe(want));

  it("reporters can be dropped into number inputs", () => {
    expect(one({ type: "robot_drive_for", inputs: { DIST: { shadow: num(1).shadow, block: { type: "robot_distance" } } } }))
      .toBe("drivetrain.drive_for(FORWARD, distance.get_distance(MM), MM)");
    expect(one({ type: "robot_repeat", inputs: { TIMES: { block: { type: "math_arithmetic", fields: { OP: "ADD" }, inputs: { A: num(1), B: num(2) } } } } }))
      .toBe("for count in range(int(1 + 2)):\n    pass");
  });
  it("colour comparison", () => {
    expect(expr({ type: "logic_compare", fields: { OP: "EQ" }, inputs: { A: { block: { type: "robot_eye_color", fields: { EYE: "down_eye" } } }, B: { block: { type: "robot_color_value", fields: { COLOR: "RED" } } } } }))
      .toBe("down_eye.color() == RED");
  });
  it("wait until wraps compound conditions", () => {
    expect(one({ type: "robot_wait_until", inputs: { COND: { block: { type: "logic_compare", fields: { OP: "LT" }, inputs: { A: { block: { type: "robot_distance" } }, B: num(100) } } } } }))
      .toBe("while not (distance.get_distance(MM) < 100):\n    wait(5, MSEC)");
  });
});

describe("structure", () => {
  it("nests loops and ifs with 4-space indentation", () => {
    const code = py([{ type: "robot_forever", inputs: { DO: { block: {
      type: "robot_repeat", inputs: { TIMES: num(4), DO: { block: {
        type: "robot_if_else", inputs: { COND: { block: { type: "robot_bumper" } },
          DO: { block: { type: "robot_turn_for", inputs: { ANGLE: num(90) } } },
          ELSE: { block: { type: "robot_drive_for", inputs: { DIST: num(50) }, next: { block: { type: "robot_repeat", inputs: { TIMES: num(2), DO: { block: { type: "robot_stop" } } } } } } } } } } } } } } }]);
    expect(mainBody(code)).toBe([
      "while True:",
      "    for count in range(4):",
      "        if bumper.pressed():",
      "            drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "        else:",
      "            drivetrain.drive_for(FORWARD, 50, MM)",
      "            for count2 in range(2):",
      "                drivetrain.stop()",
    ].join("\n"));
  });
  it("ignores blocks not attached to the hat (and greys them out)", () => {
    const ws = wsWith([{ type: "robot_stop" }], [
      { type: "robot_drive_for", x: 400, y: 0, inputs: { DIST: num(999) }, next: { block: { type: "robot_turn", fields: { DIR: "LEFT" } } } },
      { type: "robot_distance", x: 400, y: 200 },
    ]);
    expect(generateProgram(ws).code).toBe("def main():\n    drivetrain.stop()\n\nstart(main)\n");
    const loose = ws.getBlocksByType("robot_drive_for", false)[0];
    expect(loose.isEnabled()).toBe(false);
    expect(ws.getBlocksByType("robot_stop", false)[0].isEnabled()).toBe(true);
  });
  it("code after a forever block is never emitted into the loop", () => {
    // forever has no next connection, so nothing can follow it.
    expect(Blockly.Blocks["robot_forever"]).toBeDefined();
    const ws = wsWith([{ type: "robot_forever" }]);
    expect(ws.getBlocksByType("robot_forever", false)[0].nextConnection).toBeNull();
  });
});

describe("state", () => {
  it("round-trips through JSON serialisation", () => {
    const ws = wsWith([{ type: "robot_repeat", inputs: { TIMES: num(4), DO: { block: { type: "robot_drive_for", inputs: { DIST: num(200) }, next: { block: { type: "robot_turn_for", inputs: { ANGLE: num(90) } } } } } } },
      { type: "variables_set", fields: { VAR: { id: "v" } }, inputs: { VALUE: { block: { type: "robot_heading" } } } }],
      [{ type: "robot_stop", x: 500, y: 500 }], [{ name: "h", id: "v" }]);
    const state = JSON.parse(JSON.stringify(saveState(ws)));
    const ws2 = new Blockly.Workspace();
    loadState(ws2, state);
    expect(generateProgram(ws2).code).toBe(generateProgram(ws).code);
    expect(JSON.stringify(saveState(ws2))).toBe(JSON.stringify(state));
  });
  it.each([null, undefined, 42, "garbage", [], [1, 2], {}, { blocks: "nope" },
    { blocks: { blocks: [{ type: "no_such_block" }] } }, { blocks: { blocks: [{ type: "robot_stop", inputs: { X: 1 } }] } }])(
    "tolerates bad state %j", (bad) => {
      const ws = new Blockly.Workspace();
      loadState(ws, bad);
      expect(ws.getBlocksByType(HAT_TYPE, false)).toHaveLength(1);
      expect(generateProgram(ws).code).toMatch(/def main\(\):\n[\s\S]*\nstart\(main\)\n$/);
    });
  it("keeps only one hat when a state has several", () => {
    const ws = new Blockly.Workspace();
    loadState(ws, { blocks: { blocks: [{ type: HAT_TYPE, x: 0, y: 0 }, { type: HAT_TYPE, x: 0, y: 300, inputs: { DO: { block: { type: "robot_stop" } } } }] } });
    expect(ws.getBlocksByType(HAT_TYPE, false)).toHaveLength(1);
  });
});

describe("line map", () => {
  const typeAt = (ws: Blockly.Workspace, line: number) => {
    const { lineMap } = generateProgram(ws);
    const id = lineMap[line - 1];
    return id ? ws.getBlockById(id)!.type : null;
  };
  it("has one entry per line", () => {
    const ws = wsWith([{ type: "robot_stop" }]);
    const { code, lineMap } = generateProgram(ws);
    expect(lineMap.length).toBe(code.split("\n").length - 1);
  });
  it("maps simple statements", () => {
    const ws = wsWith([{ type: "robot_drive_for", inputs: { DIST: num(200) } }, { type: "robot_turn_for", inputs: { ANGLE: num(90) } }]);
    // 1 def main():  2 drive_for  3 turn_for  4 blank  5 start(main)
    expect([1, 2, 3, 4, 5].map((l) => typeAt(ws, l))).toEqual([null, "robot_drive_for", "robot_turn_for", null, null]);
  });
  it("maps if/else and loop bodies to the right blocks", () => {
    const ws = wsWith([{ type: "robot_repeat", inputs: { TIMES: num(2), DO: { block: {
      type: "robot_if_else", inputs: { COND: { block: { type: "robot_bumper" } },
        DO: { block: { type: "robot_stop" } }, ELSE: { block: { type: "robot_drive", next: { block: { type: "robot_wait", inputs: { TIME: num(1) } } } } } } } } } },
      { type: "robot_wait_until", inputs: { COND: { block: { type: "robot_is_done" } } } },
      { type: "robot_screen_clear" }]);
    const { code } = generateProgram(ws);
    const lines = code.split("\n");
    const at = (text: string) => typeAt(ws, lines.findIndex((l) => l.trim() === text) + 1);
    expect(at("for count in range(2):")).toBe("robot_repeat");
    expect(at("if bumper.pressed():")).toBe("robot_if_else");
    expect(at("drivetrain.stop()")).toBe("robot_stop");
    expect(at("else:")).toBe("robot_if_else");
    expect(at("drivetrain.drive(FORWARD)")).toBe("robot_drive");
    expect(at("wait(1, SECONDS)")).toBe("robot_wait");
    expect(at("while not drivetrain.is_done():")).toBe("robot_wait_until");
    expect(at("wait(5, MSEC)")).toBe("robot_wait_until");
    expect(at("brain.screen.clear_screen()")).toBe("robot_screen_clear");
    expect(at("start(main)")).toBeNull();
  });
  it("maps lines inside My Blocks functions, and def main stays unmapped", () => {
    const ws = wsWith([{ type: "procedures_callnoreturn", extraState: { name: "go" } }],
      [{ type: "procedures_defnoreturn", x: 0, y: 400, fields: { NAME: "go" }, inputs: { STACK: { block: { type: "robot_stop" } } } }]);
    const { code } = generateProgram(ws);
    const lines = code.split("\n");
    expect(typeAt(ws, lines.indexOf("def go():") + 1)).toBe("procedures_defnoreturn");
    expect(typeAt(ws, lines.indexOf("    drivetrain.stop()") + 1)).toBe("robot_stop");
    expect(typeAt(ws, lines.indexOf("def main():") + 1)).toBeNull();
    expect(typeAt(ws, lines.indexOf("    go()") + 1)).toBe("procedures_callnoreturn");
  });
  it("generated code contains no marker characters", () => {
    const ws = wsWith([{ type: "robot_forever", inputs: { DO: { block: { type: "robot_stop" } } } }]);
    expect(generateProgram(ws).code).not.toMatch(/\u0001/);
  });
});

describe("toolbox", () => {
  const names = (hw: { pen: boolean; magnet: boolean }) =>
    ((buildToolbox(hw) as unknown as { contents: { name: string }[] }).contents).map((c) => c.name);
  it("hides Pen and Magnet when the world has no such hardware", () => {
    expect(names({ pen: false, magnet: false })).toEqual(["Drivetrain", "Sensing", "Looks", "Control", "Operators", "Variables", "My Blocks"]);
    expect(names({ pen: true, magnet: true })).toEqual(["Drivetrain", "Sensing", "Pen", "Magnet", "Looks", "Control", "Operators", "Variables", "My Blocks"]);
  });
  it("every toolbox block (and starter) can be created headless", () => {
    const tb = buildToolbox({ pen: true, magnet: true }) as unknown as { contents: { contents?: J[] }[] };
    const ws = new Blockly.Workspace();
    for (const cat of tb.contents) for (const it of cat.contents ?? []) {
      if (it.kind !== "block") continue;
      const { kind: _k, ...state } = it;
      expect(() => Blockly.serialization.blocks.append(state as unknown as Blockly.serialization.blocks.State, ws)).not.toThrow();
    }
  });
});
