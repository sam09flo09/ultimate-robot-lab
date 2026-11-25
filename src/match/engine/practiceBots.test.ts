// match: full headless matches — both programs through real isolated runners on the real match sim.
import { describe, it, expect } from "vitest";
import { runMatch } from "./testkit";
import { SILO_SPRINT } from "./games";
import { EASY_BOT, MEDIUM_BOT, PRACTICE_BOTS, practiceBot } from "./practiceBots";
import { precheck } from "../../runtime/friendly";
import { scriptedInput } from "../../activities/content/runSolution";

/** A Team A student program: magnet one disk home in autonomous, then drive with the controller. */
const STUDENT_A = [
  "import math",
  "",
  "def go_to(x, y, stop_short):",
  "    dx = x - location.position(X, MM)",
  "    dy = y - location.position(Y, MM)",
  "    drivetrain.turn_to_heading(math.degrees(math.atan2(dx, dy)) % 360, DEGREES)",
  "    drivetrain.drive_for(FORWARD, math.sqrt(dx * dx + dy * dy) - stop_short, MM)",
  "",
  "def autonomous():",
  "    go_to(-1000, 900, 125)",
  "    magnet.energize(BOOST)",
  "    go_to(-1450, 800, 0)",
  "    magnet.energize(DROP)",
  "    drivetrain.drive_for(REVERSE, 250, MM)",
  "",
  "def driver_control():",
  "    while True:",
  "        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)",
  "        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)",
  "        wait(20, MSEC)",
  "",
  "competition(autonomous, driver_control)",
  "",
].join("\n");

describe("practice bots", () => {
  it("are readable competition programs", () => {
    expect(practiceBot("easy")).toBe(EASY_BOT);
    expect(PRACTICE_BOTS.medium.python).toBe(MEDIUM_BOT);
    for (const py of [EASY_BOT, MEDIUM_BOT]) {
      expect(py).toMatch(/competition\(autonomous, driver_control\)\s*$/);
      expect(precheck(py)).toBeNull();
    }
  });

  it("easy and medium both score as Team B, and medium scores more", async () => {
    const easy = await runMatch(SILO_SPRINT, null, EASY_BOT);
    const medium = await runMatch(SILO_SPRINT, null, MEDIUM_BOT);
    for (const m of [easy, medium]) {
      expect(m.results.B, JSON.stringify(m.logs.B.slice(-5))).toEqual({ status: "stopped" }); // ran until the match ended, no error
      expect(m.autoScore.B).toBeGreaterThan(0);                  // scores in autonomous
      expect(m.autoScore.autonomousWinner).toBe("B");
      expect(m.score.lines.find((l) => l.team === "B" && l.label === "Parked at home")?.points).toBe(2);
    }
    const disksB = (m: typeof easy) => m.score.lines.find((l) => l.team === "B" && l.label === "Disks in the bin")!.count!;
    expect(disksB(easy)).toBeGreaterThanOrEqual(2);
    expect(disksB(medium)).toBeGreaterThan(disksB(easy));
    expect(medium.score.B).toBeGreaterThan(easy.score.B);
  }, 120_000);

  it("a full match: student program (autonomous + scripted driver) vs the medium bot", async () => {
    const m = await runMatch(SILO_SPRINT, STUDENT_A, MEDIUM_BOT, {
      // the "driver" drives forward for a second, then turns back home
      inputA: (sim) => scriptedInput([{ t: 16, axes: { axis3: 50, axis2: 50 } }, { t: 17 }], () => sim.time),
    });
    expect(m.results.A).toEqual({ status: "stopped" });
    expect(m.results.B).toEqual({ status: "stopped" });
    const binA = m.autoScore.lines.find((l) => l.team === "A" && l.label === "Disks in the bin")!;
    expect(binA.count).toBe(1);                             // A's autonomous delivered a disk
    expect(m.logs.A.some((l) => /driver_control\(\)/.test(l))).toBe(true);
    expect(m.logs.A.some((l) => /left_motor\.spin\(FORWARD/.test(l))).toBe(true); // driver input reached robot A
    expect(m.score.B).toBeGreaterThan(m.score.A);
  }, 120_000);

  it("is deterministic: the same match twice ends the same way", async () => {
    const a = await runMatch(SILO_SPRINT, null, EASY_BOT, { driverSeconds: 10 });
    const b = await runMatch(SILO_SPRINT, null, EASY_BOT, { driverSeconds: 10 });
    expect(JSON.stringify(b.sim.robots.B.state.robot)).toBe(JSON.stringify(a.sim.robots.B.state.robot));
    expect(JSON.stringify(b.sim.robots.A.state.objects)).toBe(JSON.stringify(a.sim.robots.A.state.objects));
    expect(b.score).toEqual(a.score);
  }, 120_000);
});
