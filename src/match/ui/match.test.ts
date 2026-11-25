// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createTimeline, clampPeriod, formatClock, type TimelineHost } from "./timeline";
import { loadOpponentFile, usesCompetition, validateSetup, opponentName, opponentRobot, MATCH_TEMPLATE, type SetupChoice } from "./setup";
import { endSummaryHtml, scoreboardHtml, winnerOf } from "./scoreboard";
import type { MatchGame } from "../../core/match";
import { DEFAULT_ROBOT } from "../../core/types";

// ---------------------------------------------------------------- timeline

function fakeHost() {
  const calls: string[] = [];
  let sim = 0;
  const host: TimelineHost = {
    stepSim: (d) => { sim += d; },
    setPhase: (p) => calls.push(`setPhase(${p})@${sim.toFixed(3)}`),
    startRunners: () => calls.push(`start@${sim.toFixed(3)}`),
    nextPeriod: () => calls.push(`nextPeriod@${sim.toFixed(3)}`),
    stopRunners: () => calls.push(`stop@${sim.toFixed(3)}`),
    pauseRunners: () => calls.push("pause"),
    resumeRunners: () => calls.push("resume"),
    onCountdown: (n) => calls.push(`cd${n}`),
    onWarning: (s) => calls.push(`warn${s}`),
  };
  return { host, calls, sim: () => sim };
}

describe("match timeline", () => {
  it("countdown → autonomous → driver → ended at the right sim times", () => {
    const f = fakeHost();
    const tl = createTimeline({ autonomousSeconds: 15, driverSeconds: 60 }, f.host);
    expect(tl.phase).toBe("setup");
    tl.start();
    expect(tl.phase).toBe("countdown");
    expect(tl.count).toBe(3);
    tl.tick(1); tl.tick(1);
    expect(tl.count).toBe(1);
    expect(f.sim()).toBe(0);                     // no sim time during the countdown
    tl.tick(1.5);                                // GO; spare countdown time is not sim time
    expect(tl.phase).toBe("autonomous");
    expect(f.sim()).toBe(0);
    expect(f.calls.slice(0, 6)).toEqual(["cd3", "cd2", "cd1", "cd0", "setPhase(autonomous)@0.000", "start@0.000"]);
    // big uneven frames: the switch must still happen at exactly 15 s
    for (let i = 0; i < 160; i++) tl.tick(0.097);
    expect(f.calls).toContain("setPhase(driver)@15.000");
    expect(f.calls).toContain("nextPeriod@15.000");
    expect(f.calls.indexOf("setPhase(driver)@15.000")).toBeLessThan(f.calls.indexOf("nextPeriod@15.000"));
    expect(tl.phase).toBe("driver");
    for (let i = 0; i < 1000 && tl.phase !== "ended"; i++) tl.tick(0.1);
    expect(tl.phase).toBe("ended");
    expect(f.sim()).toBeCloseTo(75, 9);          // never steps past the end
    expect(f.calls).toContain("stop@75.000");
    expect(f.calls).toContain("setPhase(ended)@75.000");
    expect(f.calls.filter((c) => c.startsWith("warn"))).toEqual(["warn10", "warn9", "warn8", "warn7", "warn6", "warn5", "warn4", "warn3", "warn2", "warn1"]);
    tl.tick(1);
    expect(f.sim()).toBeCloseTo(75, 9);
  });

  it("remaining counts down per period", () => {
    const f = fakeHost();
    const tl = createTimeline({ autonomousSeconds: 10, driverSeconds: 30, countdownSeconds: 0 }, f.host);
    tl.start();
    expect(tl.phase).toBe("autonomous");
    tl.tick(4);
    expect(tl.remaining).toBeCloseTo(6);
    tl.tick(7);                                  // crosses the boundary inside one tick
    expect(tl.phase).toBe("driver");
    expect(tl.remaining).toBeCloseTo(29);
    expect(f.sim()).toBeCloseTo(11);
  });

  it("pause freezes the sim and the clock; resume carries on", () => {
    const f = fakeHost();
    const tl = createTimeline({ autonomousSeconds: 15, driverSeconds: 60, countdownSeconds: 0 }, f.host);
    tl.start();
    tl.tick(5);
    tl.pause();
    expect(tl.paused).toBe(true);
    expect(f.calls).toContain("pause");
    tl.tick(10); tl.tick(10);
    expect(f.sim()).toBe(5);
    expect(tl.remaining).toBe(10);
    tl.resume();
    expect(f.calls).toContain("resume");
    tl.tick(10);
    expect(tl.phase).toBe("driver");
    expect(f.calls).toContain("nextPeriod@15.000");
  });

  it("autonomous 0 s goes straight to driver control", () => {
    const f = fakeHost();
    const tl = createTimeline({ autonomousSeconds: 0, driverSeconds: 30, countdownSeconds: 0 }, f.host);
    tl.start();
    expect(tl.phase).toBe("driver");
    expect(f.calls).toEqual(["cd0", "setPhase(autonomous)@0.000", "start@0.000", "setPhase(driver)@0.000", "nextPeriod@0.000"]);
  });

  it("Stop ends the match early (also while paused)", () => {
    const f = fakeHost();
    const tl = createTimeline({ autonomousSeconds: 15, driverSeconds: 60, countdownSeconds: 0 }, f.host);
    tl.start(); tl.tick(3); tl.pause();
    tl.stop();
    expect(tl.phase).toBe("ended");
    expect(tl.paused).toBe(false);
    expect(f.calls.slice(-3)).toEqual(["resume", "stop@3.000", "setPhase(ended)@3.000"]);
  });

  it("periods are clamped (autonomous 0–30, driver 30–180)", () => {
    expect(clampPeriod(99, [0, 30], 15)).toBe(30);
    expect(clampPeriod(-4, [0, 30], 15)).toBe(0);
    expect(clampPeriod("abc", [30, 180], 60)).toBe(60);
    expect(clampPeriod(10, [30, 180], 60)).toBe(30);
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(9.2)).toBe("0:10");
    expect(formatClock(0)).toBe("0:00");
  });
});

// ---------------------------------------------------------------- setup

const game = { id: "g", name: "G", description: "", world: {} as MatchGame["world"], startB: { x: 0, y: 0, heading: 0 }, autonomousSeconds: 15, driverSeconds: 60, scoring: [], autonomousBonus: 4 } as MatchGame;
const base: SetupChoice = { game, autonomousSeconds: 15, driverSeconds: 60, inputA: "keyboard-left", inputB: "keyboard-right", opponent: "practice-easy", file: null, programA: MATCH_TEMPLATE };
const project = (o: Record<string, unknown>) => JSON.stringify({ format: "robot-lab-project", version: 1, name: "Sam's bot", mode: "python", python: MATCH_TEMPLATE, blocks: null, worldId: "custom", customWorld: { width: 2000, height: 2000, start: { x: 0, y: 0, heading: 0 }, walls: [], floor: [], objects: [], zones: [], goals: [] }, savedAt: "", ...o });

describe("match setup", () => {
  it("detects competition(...) but not in comments", () => {
    expect(usesCompetition(MATCH_TEMPLATE)).toBe(true);
    expect(usesCompetition("def main():\n    pass\n# competition(a, b)\nstart(main)\n")).toBe(false);
  });

  it("rejects bad opponent files with a readable message", () => {
    const bad = [
      ["not json {", /isn't readable JSON/],
      [JSON.stringify({ hello: 1 }), /not a Robot Lab/],
      [JSON.stringify({ format: "robot-lab-level", version: 1, world: { width: 2000, height: 2000 } }), /challenge file, not a project/],
      [project({ version: 9 }), /newer Robot Lab/],
      [project({ python: "   " }), /has no program/],
    ] as const;
    for (const [text, msg] of bad) {
      const r = loadOpponentFile(text, "x.robolab");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
    expect(loadOpponentFile("x".repeat(2_000_001), "big.robolab").ok).toBe(false);
  });

  it("accepts a classmate's project, keeps its robot, warns without competition()", () => {
    const r = loadOpponentFile(project({ robot: { ...DEFAULT_ROBOT, size: 180 } }), "sam.robolab");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source.name).toBe("Sam's bot");
    expect(r.source.robot?.size).toBe(180);
    expect(r.warnings).toEqual([]);
    const r2 = loadOpponentFile(project({ python: "def main():\n    pass\nstart(main)\n" }), "s.robolab");
    expect(r2.ok && r2.warnings[0]).toMatch(/doesn't use competition/);
    if (r.ok) expect(opponentRobot(r.source, DEFAULT_ROBOT).size).toBe(180);
  });

  it("validates the setup", () => {
    expect(validateSetup(base).ok).toBe(true);
    const same = validateSetup({ ...base, inputB: "keyboard-left" });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors[0]).toMatch(/same controls/);
    expect(validateSetup({ ...base, inputA: "touch", inputB: "touch" }).ok).toBe(false);
    expect(validateSetup({ ...base, inputA: "program-only", inputB: "program-only" }).ok).toBe(true);
    // a "none" opponent doesn't need controls
    const none = validateSetup({ ...base, opponent: "none", inputB: "keyboard-left" });
    expect(none.ok && none.setup.inputB).toBe("program-only");
    // file chosen but not loaded
    const nofile = validateSetup({ ...base, opponent: "file" });
    expect(nofile.ok).toBe(false);
    expect(validateSetup({ ...base, programA: " " }).ok).toBe(false);
    expect(validateSetup({ ...base, game: null }).ok).toBe(false);
    const clamped = validateSetup({ ...base, autonomousSeconds: 45, driverSeconds: 5 });
    expect(clamped.ok && [clamped.setup.autonomousSeconds, clamped.setup.driverSeconds]).toEqual([30, 30]);
  });

  it("names the opponent", () => {
    expect(opponentName({ kind: "practice", level: "medium" }, "A")).toBe("Practice bot (medium)");
    expect(opponentName({ kind: "mirror" }, "Zoom")).toBe("Mirror of Zoom");
  });
});

// ---------------------------------------------------------------- scoreboard

describe("scoreboard", () => {
  const evil = `<img src=x onerror="alert(1)">`;
  it("escapes team and project names", () => {
    const html = scoreboardHtml({ A: evil, B: "Bob & <b>Co</b>" }, { A: 3, B: 7 });
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("img")).toBeNull();
    expect(div.querySelector("b")).toBeNull();
    expect(div.textContent).toContain(evil);
    expect(div.textContent).toContain("Bob & <b>Co</b>");
    expect(div.querySelectorAll(".mt-score")[1].textContent).toBe("7");
  });
  it("end screen: winner, breakdown, escaped labels", () => {
    const html = endSummaryHtml({ A: evil, B: "Blue" }, {
      A: 9, B: 5, autonomousWinner: "A",
      lines: [{ team: "A", label: "Disks <scored>", points: 5, count: 1 }, { team: "A", label: "Autonomous bonus", points: 4 }, { team: "B", label: "Parked", points: 5 }],
    });
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("img, scored")).toBeNull();
    expect(div.querySelector(".me-win")?.textContent).toContain("wins!");
    expect(div.querySelector(".me-win")?.textContent).toContain(evil);
    expect(div.textContent).toContain("Disks <scored>");
    expect(div.querySelectorAll(".me-col")[0].querySelector("tfoot")?.textContent).toContain("9");
    expect(winnerOf({ A: 2, B: 2 })).toBe("tie");
    expect(endSummaryHtml({ A: "a", B: "b" }, { A: 1, B: 1, lines: [], autonomousWinner: null })).toContain("tie");
  });
});
