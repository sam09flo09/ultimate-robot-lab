import { describe, it, expect } from "vitest";
import type { ActivityStep, CodeCheck, RunCheck } from "../core/activity";
import { checkStep, defaultLabel, type CheckContext, type LastRun } from "./checks";
import { scanPython, calls } from "./pyscan";

const step = (checks: Array<CodeCheck | RunCheck>, extra: Partial<ActivityStep> = {}): ActivityStep =>
  ({ id: "s", title: "S", body: "", checks, hints: [], ...extra });
const ctx = (python: string, over: Partial<CheckContext> = {}): CheckContext => ({ python, lastRun: null, quizAnswers: [], ...over });
const pass = (c: CodeCheck | RunCheck, python: string, over: Partial<CheckContext> = {}) => checkStep(step([c]), ctx(python, over)).passed;
const run = (over: Partial<LastRun> = {}): LastRun => ({
  result: { status: "finished", startCalled: true, steps: 3 }, goalsAllPassed: false, finalSquare: null, output: [], ...over,
});

describe("tokenizer", () => {
  it("ignores comments and strings", () => {
    const s = scanPython(`x = "drivetrain.drive_for(FORWARD)"  # drivetrain.drive_for(\n'''\ndrivetrain.drive_for(1)\n'''\n`);
    expect(calls(s)).toEqual([]);
    expect(s.comments.length).toBe(1);
  });
  it("handles prefixes, escapes and unterminated strings", () => {
    const s = scanPython(`a = r"\\"go()"\nb = f'{x}' + b"y"\nc = "oops\nprint(1)\n`);
    expect(calls(s)).toEqual(["print"]);
  });
  it("joins bracketed and backslash continuation lines", () => {
    const s = scanPython("drivetrain.drive_for(\n    FORWARD,\n    200, MM)\nx = 1 + \\\n  2\n");
    expect(s.stmts.length).toBe(2);
    expect(calls(s)).toEqual(["drivetrain.drive_for"]);
  });
  it("never throws on junk", () => {
    for (const junk of ["", ")))(((", "'''", "\\", "\u0000\u2028", "def", "x = [1, 2", "#".repeat(10000), "if x: : :"]) {
      expect(() => checkStep(step([{ kind: "usesLoop", label: "" }, { kind: "maxLines", lines: 3, label: "" }]), ctx(junk))).not.toThrow();
    }
  });
});

describe("usesCall", () => {
  const c = (min?: number): CodeCheck => ({ kind: "usesCall", name: "drivetrain.drive_for", min, label: "x" });
  it("counts calls inside loops and functions", () => {
    const src = `def square():\n    for i in range(4):\n        drivetrain.drive_for(FORWARD, 200, MM)\n        drivetrain.turn_for(RIGHT, 90, DEGREES)\n\ndef main():\n    while True:\n        if bumper.pressed():\n            drivetrain.drive_for(REVERSE, 100, MM)\n    square()\n\nstart(main)\n`;
    expect(pass(c(2), src)).toBe(true);
    expect(pass(c(3), src)).toBe(false);
    expect(checkStep(step([c(3)]), ctx(src)).items[0].detail).toBe("Found 2 of 3.");
  });
  it("ignores commented-out code and text in strings", () => {
    const src = `def main():\n    # drivetrain.drive_for(FORWARD, 200, MM)\n    print("drivetrain.drive_for(FORWARD, 200, MM)")\n    s = '''\n    drivetrain.drive_for(FORWARD, 200, MM)\n    '''\nstart(main)\n`;
    expect(pass(c(), src)).toBe(false);
  });
  it("does not match other objects, definitions or bare references", () => {
    expect(pass(c(), "def drive_for(): pass\nx = drivetrain.drive_for\nmy.drivetrain.drive_for(1)\n")).toBe(false);
    expect(pass(c(), "drivetrain . drive_for (FORWARD, 1, MM)")).toBe(true);
    expect(pass({ kind: "usesCall", name: "print", label: "" }, "brain.screen.print(1)")).toBe(false);
    expect(pass({ kind: "usesCall", name: "print", label: "" }, "def print(): pass")).toBe(false);
  });
  it("counts calls in one-line bodies and after semicolons", () => {
    expect(pass(c(3), "for i in range(2): drivetrain.drive_for(FORWARD, 1, MM); drivetrain.drive_for(FORWARD, 1, MM)\nif x: drivetrain.drive_for(FORWARD, 1, MM)")).toBe(true);
  });
});

describe("usesLoop / usesIf", () => {
  it("finds for and while statements, not comprehensions or words in strings", () => {
    const anyLoop: CodeCheck = { kind: "usesLoop", label: "" };
    expect(pass(anyLoop, "xs = [i for i in range(3)]\nprint('for while')\n# for i in x:\n")).toBe(false);
    expect(pass(anyLoop, "def main():\n    for i in range(4):\n        pass\n")).toBe(true);
    expect(pass({ kind: "usesLoop", loop: "while", label: "" }, "for i in range(4):\n    pass\n")).toBe(false);
    expect(pass({ kind: "usesLoop", loop: "while", label: "" }, "def main():\n    while not bumper.pressed():\n        wait(1)\n")).toBe(true);
    expect(pass({ kind: "usesLoop", loop: "for", label: "" }, "async for x in y:\n    pass")).toBe(true);
  });
  it("usesIf, withElse only for an if chain", () => {
    expect(pass({ kind: "usesIf", label: "" }, "x = 1 if y else 2\n")).toBe(false);
    expect(pass({ kind: "usesIf", label: "" }, "if x:\n    pass\n")).toBe(true);
    const withElse: CodeCheck = { kind: "usesIf", withElse: true, label: "" };
    expect(pass(withElse, "if x:\n    pass\nfor i in y:\n    pass\nelse:\n    pass\n")).toBe(false);
    expect(pass(withElse, "if x:\n    pass\nwhile y:\n    if z:\n        pass\nelse:\n    pass\n")).toBe(false);
    expect(pass(withElse, "def main():\n    if a:\n        if b:\n            pass\n    elif c:\n        pass\n    else:\n        pass\n")).toBe(true);
    expect(pass(withElse, "if a: go()\nelse: stop()\n")).toBe(true);
    expect(pass(withElse, "x = 1 if y else 2\n")).toBe(false);
  });
});

describe("definesFunction / assignsVariable / definesConstant", () => {
  it("definesFunction ignores main by default and honours besides", () => {
    expect(pass({ kind: "definesFunction", label: "" }, "def main():\n    pass\nstart(main)")).toBe(false);
    expect(pass({ kind: "definesFunction", label: "" }, "def main():\n    pass\ndef square(n):\n    pass")).toBe(true);
    expect(pass({ kind: "definesFunction", besides: ["main", "square"], label: "" }, "def square(): pass")).toBe(false);
    expect(pass({ kind: "definesFunction", label: "" }, "# def helper():\ns = 'def helper(): pass'")).toBe(false);
    expect(pass({ kind: "definesFunction", label: "" }, "async def go():\n    pass")).toBe(true);
  });
  it("assignsVariable handles tuples, augmented, annotated, and skips comparisons and keyword args", () => {
    const any: CodeCheck = { kind: "assignsVariable", label: "" };
    expect(pass(any, "if x == 1:\n    drivetrain.drive_for(FORWARD, 1, MM)\nf(a=1)\n")).toBe(false);
    expect(pass(any, "def main():\n    side = 200\n")).toBe(true);
    const named = (n: string): CodeCheck => ({ kind: "assignsVariable", name: n, label: "" });
    expect(pass(named("b"), "a, b = 1, 2")).toBe(true);
    expect(pass(named("n"), "n += 1")).toBe(true);
    expect(pass(named("n"), "n: int = 3")).toBe(true);
    expect(pass(named("y"), "x = y = 0")).toBe(true);
    expect(pass(named("n"), "obj.n = 3\nitems[n] = 4\n# n = 1\ns = 'n = 1'")).toBe(false);
    expect(pass(named("n"), "if (n := 5) > 3:\n    pass")).toBe(true);
    expect(pass(named("i"), "for i in range(3):\n    pass")).toBe(false);
  });
  it("definesConstant: UPPER_CASE at module level only", () => {
    const k: CodeCheck = { kind: "definesConstant", label: "" };
    expect(pass(k, "SIDE = 200\ndef main():\n    drivetrain.drive_for(FORWARD, SIDE, MM)\n")).toBe(true);
    expect(pass(k, "def main():\n    SIDE = 200\n")).toBe(false);          // local variable, not a constant
    expect(pass(k, "side = 200\n")).toBe(false);
    expect(pass(k, "# SIDE = 200\nx = 'SIDE = 1'\n")).toBe(false);
    expect(pass(k, "def main(): SIDE = 1\n")).toBe(false);                  // one-line function body
    expect(pass(k, "class R:\n    SPEED = 3\n")).toBe(false);
    expect(pass(k, "if True:\n    MAX_SPEED = 80\n")).toBe(true);        // still module level
    expect(pass(k, "def main():\n    pass\nTURN_2 = 90\n")).toBe(true);
    expect(pass(k, "x = SIDE == 3\n")).toBe(false);
  });
});

describe("hasComment / readsSensor / printsOutput / maxLines", () => {
  it("hasComment counts real comments, not # in strings, and not starter comments", () => {
    expect(pass({ kind: "hasComment", label: "" }, "x = '# not a comment'\n")).toBe(false);
    expect(pass({ kind: "hasComment", min: 2, label: "" }, "# one\nx = 1  # two\n")).toBe(true);
    expect(pass({ kind: "hasComment", min: 2, label: "" }, "# one\n#\n")).toBe(false);
    const starter = "# Drive up two squares\ndef main():\n    pass\n";
    expect(pass({ kind: "hasComment", label: "" }, starter, { starterPython: starter })).toBe(false);
    expect(pass({ kind: "hasComment", label: "" }, starter + "# mine\n", { starterPython: starter })).toBe(true);
  });
  it("readsSensor", () => {
    const r: CodeCheck = { kind: "readsSensor", label: "" };
    expect(pass(r, "x = distance.get_distance(MM)")).toBe(true);
    expect(pass(r, "while not bumper.pressed():\n    pass")).toBe(true);
    expect(pass(r, "if down_eye.detect(RED): pass")).toBe(true);
    expect(pass(r, "x = location.position(X, MM)")).toBe(true);
    expect(pass(r, "# distance.get_distance(MM)\nprint('front_eye.color()')\ndistance = 3")).toBe(false);
    expect(pass(r, "drivetrain.drive_for(FORWARD, 1, MM)")).toBe(false);
  });
  it("printsOutput", () => {
    const p: CodeCheck = { kind: "printsOutput", label: "" };
    expect(pass(p, "print('hi')")).toBe(true);
    expect(pass(p, "brain.screen.print(3)")).toBe(true);
    expect(pass(p, "# print('hi')\nx = 'print(1)'")).toBe(false);
  });
  it("maxLines counts non-blank, non-comment lines", () => {
    const src = "# comment\n\ndef main():\n    # inside\n    for i in range(4):\n        drivetrain.drive_for(FORWARD, 200, MM)\n\nstart(main)\n";
    expect(pass({ kind: "maxLines", lines: 4, label: "" }, src)).toBe(true);
    expect(pass({ kind: "maxLines", lines: 3, label: "" }, src)).toBe(false);
    expect(checkStep(step([{ kind: "maxLines", lines: 3, label: "" }]), ctx(src)).items[0].detail).toMatch(/^4 lines/);
    expect(pass({ kind: "maxLines", lines: 3, label: "" }, "# only comments\n\n")).toBe(false); // empty program doesn't pass
  });
});

describe("run checks", () => {
  it("fail with 'Press Run' when there is no run yet", () => {
    for (const c of [{ kind: "goalsComplete" }, { kind: "ranWithoutError" }, { kind: "endsInSquare", square: 3 }, { kind: "logContains", text: "x" }] as RunCheck[]) {
      const r = checkStep(step([{ ...c, label: "" }]), ctx(""));
      expect(r.passed).toBe(false);
      expect(r.items[0].detail).toBe("Press Run to check this.");
    }
  });
  it("goalsComplete / ranWithoutError", () => {
    expect(pass({ kind: "goalsComplete", label: "" }, "", { lastRun: run({ goalsAllPassed: true }) })).toBe(true);
    expect(pass({ kind: "goalsComplete", label: "" }, "", { lastRun: run() })).toBe(false);
    expect(pass({ kind: "ranWithoutError", label: "" }, "", { lastRun: run() })).toBe(true);
    expect(pass({ kind: "ranWithoutError", label: "" }, "", { lastRun: run({ result: { status: "stopped" } }) })).toBe(false);
    expect(pass({ kind: "ranWithoutError", label: "" }, "", { lastRun: run({ result: { status: "finished", startCalled: false, steps: 0 } }) })).toBe(false);
    expect(pass({ kind: "ranWithoutError", label: "" }, "", { lastRun: run({ result: { status: "error", error: { line: 1, type: "NameError", html: "", raw: "" } } }) })).toBe(false);
  });
  it("endsInSquare / logContains", () => {
    expect(pass({ kind: "endsInSquare", square: 21, label: "" }, "", { lastRun: run({ finalSquare: 21 }) })).toBe(true);
    const r = checkStep(step([{ kind: "endsInSquare", square: 21, label: "" }]), ctx("", { lastRun: run({ finalSquare: 11 }) }));
    expect(r.items[0].detail).toBe("The robot ended in square 11.");
    expect(pass({ kind: "endsInSquare", square: 21, label: "" }, "", { lastRun: run({ finalSquare: null }) })).toBe(false);
    expect(pass({ kind: "logContains", text: "Hello  World", label: "" }, "", { lastRun: run({ output: ["say:", "hello world!"] }) })).toBe(true);
    expect(pass({ kind: "logContains", text: "bye", label: "" }, "", { lastRun: run({ output: ["hello"] }) })).toBe(false);
  });
});

describe("checkStep", () => {
  it("passes an empty step, includes quiz items and default labels", () => {
    expect(checkStep(step([]), ctx("")).passed).toBe(true);
    const q = { prompt: "?", choices: ["a", "b"], answer: 1, explain: "" };
    const s = step([{ kind: "printsOutput", label: "" }], { quiz: [q, q] });
    const r = checkStep(s, ctx("print(1)", { quizAnswers: [1, 0] }));
    expect(r.passed).toBe(false);
    expect(r.items.map((i) => i.passed)).toEqual([true, true, false]);
    expect(r.items[0].label).toBe(defaultLabel({ kind: "printsOutput", label: "" }));
    expect(checkStep(s, ctx("print(1)", { quizAnswers: [1, 1] })).passed).toBe(true);
    expect(checkStep(s, ctx("print(1)", { quizAnswers: [] })).items[1].detail).toBe("Not answered yet.");
  });
});
