import { describe, it, expect } from "vitest";
import { friendly, closestName, editDistance, precheck, userNames, esc } from "./friendly";

describe("friendly helpers", () => {
  it("editDistance", () => {
    expect(editDistance("drive_fro", "drive_for")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
  it("closestName prefers case matches, then near spellings", () => {
    expect(closestName("forward", ["FORWARD", "REVERSE"])).toEqual({ name: "FORWARD", kind: "case" });
    expect(closestName("drivetrian", ["drivetrain", "distance"])).toEqual({ name: "drivetrain", kind: "typo" });
    expect(closestName("zzzzzz", ["drivetrain"])).toBeNull();
  });
  it("userNames finds the student's own names", () => {
    expect(userNames("def main():\n    speed = 5\n    for i in range(3):\n        pass\ndef go(dist, n=2): pass\n").sort())
      .toEqual(["dist", "go", "i", "main", "n", "speed"]);
  });
  it("esc", () => { expect(esc("<a href='x'>&</a>")).toBe("&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;"); });
});

describe("friendly()", () => {
  const src = "def main():\n    speed = 5\n    drivetrain.set_drive_velocity(sped, PERCENT)\n\nstart(main)\n";
  it("typo of a student variable", () => {
    const f = friendly({ type: "NameError", raw: "name 'sped' is not defined", line: 3 }, src);
    expect(f.html).toContain("Did you mean <code>speed</code>");
    expect(f.line).toBe(3);
  });
  it("lower-case true -> True", () => {
    expect(friendly({ type: "NameError", raw: "name 'true' is not defined", line: 1 }, "x = true").html).toContain("<code>True</code>");
  });
  it("missing main", () => {
    expect(friendly({ type: "NameError", raw: "name 'main' is not defined", line: 1 }, "start(main)").html).toContain("def main():");
  });
  it("timeouts", () => {
    expect(friendly({ type: "TimeLimitError", raw: "Program exceeded run time limit.", line: 2 }, "").html).toContain("ran too long");
  });
  it("missing colon", () => {
    const f = friendly({ type: "SyntaxError", raw: "bad input", line: 1 }, "def main()\n    pass\n");
    expect(f.html).toContain("colon");
  });
  it("unclosed bracket", () => {
    const f = friendly({ type: "SyntaxError", raw: "EOF in multi-line statement", line: 3 }, "def main():\n    drivetrain.drive_for(FORWARD, 200, MM\n");
    expect(f.html).toContain("line 2");
    expect(f.line).toBe(3);
  });
  it("wrong method on a sensor object suggests the right one", () => {
    const f = friendly({ type: "AttributeError", raw: "'FrontEye' object has no attribute 'Color'", line: 4 }, "");
    expect(f.html).toContain("Capitals matter");
    expect(f.html).toContain("front_eye.color");
  });
  it("method on the wrong object", () => {
    const f = friendly({ type: "AttributeError", raw: "'Drivetrain' object has no attribute 'pressed'", line: 4 }, "");
    expect(f.html).toContain("bumper.pressed()");
  });
  it("our own messages are escaped verbatim", () => {
    const f = friendly({ type: "TypeError", raw: "drive_for needs 3 values <x>", line: 2, ours: true }, "");
    expect(f.html).toBe("<b>Line 2: TypeError</b><br>drive_for needs 3 values &lt;x&gt;");
  });
  it("precheck start(main())", () => {
    expect(precheck("def main():\n    pass\nstart(main())\n")?.line).toBe(3);
    expect(precheck("def main():\n    pass\nstart(main)\n")).toBeNull();
    expect(precheck("# start(main())\n")).toBeNull();
  });
});
