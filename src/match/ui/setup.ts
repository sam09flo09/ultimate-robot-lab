/**
 * match: Match-screen setup logic with no DOM — opponent files, program-shape checks, setup validation.
 */
import type { MatchGame, OpponentSource, PlayerInput } from "../../core/match";
import { DEFAULT_ROBOT, type RobotConfig } from "../../core/types";
import { parseFileText, cleanName } from "../../ui/files";
import { AUTO_RANGE, DRIVER_RANGE, clampPeriod } from "./timeline";

/** The program a match needs. Inserted into a NEW project by the setup screen's button. */
export const MATCH_TEMPLATE = `# A match has two periods.
# 1) autonomous(): your robot drives by itself.
# 2) driver_control(): you drive with the controller.

def autonomous():
    drivetrain.drive_for(FORWARD, 600, MM)
    drivetrain.turn_for(RIGHT, 90, DEGREES)

def driver_control():
    # Tank drive: left stick = left wheels, right stick = right wheels
    while True:
        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)
        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)
        wait(20, MSEC)

competition(autonomous, driver_control)
`;

/** True when the program calls competition(...) on a line of its own (not in a comment or a string). */
export function usesCompetition(python: string): boolean {
  for (const raw of python.split("\n")) {
    const line = raw.replace(/#.*$/, "");
    if (/^\s*competition\s*\(/.test(line)) return true;
  }
  return false;
}

export type OpponentChoice = "practice-easy" | "practice-medium" | "file" | "mirror" | "none";

export const OPPONENT_LABEL: Record<OpponentChoice, string> = {
  "practice-easy": "Practice bot · easy",
  "practice-medium": "Practice bot · medium",
  file: "A classmate's project (.robolab)",
  mirror: "Mirror my program",
  none: "No opponent (robot B sits still)",
};

export type LoadedOpponent =
  | { ok: true; source: Extract<OpponentSource, { kind: "file" }>; warnings: string[] }
  | { ok: false; error: string };

/** Validate a classmate's .robolab file (untrusted). Never throws. */
export function loadOpponentFile(text: string, fileName: string, knownWorld: (id: string) => boolean = () => true): LoadedOpponent {
  if (text.length > 2_000_000) return { ok: false, error: `${fileName} is too big to be a Robot Lab project.` };
  let opened;
  try { opened = parseFileText(text, knownWorld); } catch (e) {
    return { ok: false, error: (e as Error)?.message || "This file couldn't be read." };
  }
  if (opened.kind !== "project") {
    return { ok: false, error: `${fileName} is ${opened.kind === "level" ? "a challenge" : "an activity"} file, not a project. Ask your classmate for their .robolab project file.` };
  }
  const p = opened.project;
  if (!p.python.trim()) return { ok: false, error: `${cleanName(p.name)} has no program in it.` };
  const warnings: string[] = [];
  if (!usesCompetition(p.python)) warnings.push(`${cleanName(p.name)} doesn't use competition(autonomous, driver_control), so its start(main) program runs for the whole match.`);
  return {
    ok: true, warnings,
    source: { kind: "file", python: p.python, name: cleanName(p.name), ...(p.robot ? { robot: p.robot } : {}) },
  };
}

export interface SetupChoice {
  game: MatchGame | null;
  autonomousSeconds: number;
  driverSeconds: number;
  inputA: PlayerInput;
  inputB: PlayerInput;
  opponent: OpponentChoice;
  /** Set when opponent === "file" and a file was loaded. */
  file: Extract<OpponentSource, { kind: "file" }> | null;
  programA: string;
}

export interface ValidSetup {
  game: MatchGame;
  autonomousSeconds: number;
  driverSeconds: number;
  inputA: PlayerInput;
  inputB: PlayerInput;
  opponent: OpponentSource;
}

export function opponentSource(c: SetupChoice): OpponentSource | null {
  switch (c.opponent) {
    case "practice-easy": return { kind: "practice", level: "easy" };
    case "practice-medium": return { kind: "practice", level: "medium" };
    case "mirror": return { kind: "mirror" };
    case "none": return { kind: "none" };
    case "file": return c.file;
  }
}

/** Errors stop the Start button; the periods are clamped into range. */
export function validateSetup(c: SetupChoice): { ok: true; setup: ValidSetup } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!c.game) errors.push("Choose a game.");
  const opp = opponentSource(c);
  if (!opp) errors.push("Choose your classmate's .robolab file for Team B, or pick another opponent.");
  if (!c.programA.trim()) errors.push("Team A's program is empty. Write a program first.");
  const humanB = opp && opp.kind !== "none";
  if (c.inputA === c.inputB && c.inputA !== "program-only" && humanB) {
    errors.push(c.inputA === "touch"
      ? "Only one team can use the on-screen controller. Give the other team a keyboard half or a gamepad."
      : "Both teams have the same controls. Give each team its own keyboard half or gamepad.");
  }
  if (errors.length || !c.game || !opp) return { ok: false, errors };
  return {
    ok: true,
    setup: {
      game: c.game,
      autonomousSeconds: clampPeriod(c.autonomousSeconds, AUTO_RANGE, c.game.autonomousSeconds),
      driverSeconds: clampPeriod(c.driverSeconds, DRIVER_RANGE, c.game.driverSeconds),
      inputA: c.inputA,
      inputB: humanB ? c.inputB : "program-only",
      opponent: opp,
    },
  };
}

/** Team B's display name. */
export function opponentName(o: OpponentSource, teamAName: string): string {
  switch (o.kind) {
    case "practice": return o.level === "easy" ? "Practice bot (easy)" : "Practice bot (medium)";
    case "file": return cleanName(o.name);
    case "mirror": return `Mirror of ${cleanName(teamAName)}`;
    case "none": return "Empty robot";
  }
}

/** Team B's robot design. */
export function opponentRobot(o: OpponentSource, robotA: RobotConfig): RobotConfig {
  if (o.kind === "file") return o.robot ? { ...o.robot } : { ...DEFAULT_ROBOT };
  if (o.kind === "mirror") return { ...robotA };
  return { ...DEFAULT_ROBOT };
}
