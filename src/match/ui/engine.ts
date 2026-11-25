/**
 * match: the ONE place the Match screen touches the match engine (src/match/engine), so differences in
 * the engine's exported shapes are absorbed here.
 */
import * as engine from "../engine";
import type { IsolatedRunner, IsolatedRunnerOptions, MatchGame, MatchSim } from "../../core/match";
import type { RobotConfig } from "../../core/types";

export function games(): MatchGame[] {
  return (engine.GAMES as MatchGame[]) ?? [];
}

export function makeMatchSim(game: MatchGame, robots: { A: RobotConfig; B: RobotConfig }): MatchSim {
  return engine.createMatchSim(game, robots.A, robots.B);
}

/** Loads a fresh Skulpt in a hidden frame, so it's asynchronous. */
export function makeRunner(opts: IsolatedRunnerOptions): Promise<IsolatedRunner> {
  return engine.createIsolatedRunner(opts);
}

/** A practice bot's Python, whether the engine exports a string or { python } per level. */
export function practiceBot(level: "easy" | "medium"): string {
  const bots = (engine as unknown as { PRACTICE_BOTS?: Record<string, unknown> }).PRACTICE_BOTS ?? {};
  const b = bots[level];
  if (typeof b === "string") return b;
  if (b && typeof b === "object" && typeof (b as { python?: unknown }).python === "string") return (b as { python: string }).python;
  return "";
}
