/**
 * match: test-only helpers (not imported by the app).
 *  - vmRealm(): a separate Skulpt instance in a node:vm context — the Node stand-in for the hidden
 *    iframe (its own globals, its own Error/Promise classes, like a real second realm).
 *  - runMatch(): a full headless match: both programs through real isolated runners, the host's phase
 *    changes (autonomous → nextPeriod → driver → ended), stepping in sim time at 60 Hz.
 */
import bundle from "../../../public/vendor/skulpt.bundle.js?raw";
import stdlib from "../../../public/vendor/skulpt-stdlib.js?raw";
import type { MatchGame, MatchScore, MatchSim, Team, IsolatedRunner } from "../../core/match";
import type { ControllerInput, RunResult } from "../../core/modules";
import type { RobotConfig } from "../../core/types";
import { createMatchSim } from "./matchSim";
import { createIsolatedRunnerWith, type RealmLoader } from "./isolated";

export function vmRealm(): RealmLoader {
  return async () => {
    // node:vm, imported by name so the browser typecheck (no Node types) stays clean
    const vm = (await import(/* @vite-ignore */ "node:" + "vm")) as {
      createContext(o: object): object; runInContext(code: string, ctx: object): unknown;
    };
    const g = globalThis as unknown as Record<string, unknown>;
    const sandbox: Record<string, unknown> = { setTimeout, clearTimeout, setImmediate: g.setImmediate, console };
    const ctx = vm.createContext(sandbox);
    vm.runInContext("var window = this; var global = this;", ctx);
    vm.runInContext(bundle, ctx);
    vm.runInContext(stdlib, ctx);
    const Sk = (ctx as { Sk?: unknown }).Sk;
    if (!Sk) throw new Error("Skulpt did not load in the vm context");
    return { Sk, dispose() { /* garbage collected */ } };
  };
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export interface MatchRun {
  sim: MatchSim;
  score: MatchScore;
  autoScore: MatchScore;          // just after autonomous ended
  results: Record<Team, RunResult | null>;
  logs: Record<Team, string[]>;
}

export interface MatchOptions {
  configA?: Partial<RobotConfig>;
  configB?: Partial<RobotConfig>;
  inputA?: (sim: MatchSim) => ControllerInput;
  inputB?: (sim: MatchSim) => ControllerInput;
  /** default game.autonomousSeconds / driverSeconds */
  autoSeconds?: number;
  driverSeconds?: number;
}

export async function runMatch(game: MatchGame, pyA: string | null, pyB: string | null, o: MatchOptions = {}): Promise<MatchRun> {
  const sim = createMatchSim(game, o.configA, o.configB);
  const logs: Record<Team, string[]> = { A: [], B: [] };
  const results: Record<Team, RunResult | null> = { A: null, B: null };
  const runners: Partial<Record<Team, IsolatedRunner>> = {};
  for (const team of ["A", "B"] as const) {
    const py = team === "A" ? pyA : pyB;
    if (py === null) continue;
    const input = (team === "A" ? o.inputA : o.inputB)?.(sim);
    const r = await createIsolatedRunnerWith({
      controller: sim.robots[team].controller,
      input,
      onLine: () => {},
      onLog: (e) => logs[team].push(`${e.kind}: ${e.text}`),
      onScreen: () => {},
    }, vmRealm());
    runners[team] = r;
  }
  sim.setPhase("autonomous");
  for (const team of ["A", "B"] as const) {
    const py = team === "A" ? pyA : pyB;
    runners[team]?.run(py!).then((res) => { results[team] = res; });
  }
  const dt = 1 / 60;
  const autoT = o.autoSeconds ?? game.autonomousSeconds;
  const endT = autoT + (o.driverSeconds ?? game.driverSeconds);
  let autoScore: MatchScore | null = null;
  while (sim.time < endT - 1e-9) {
    await tick();
    if (sim.phase === "autonomous" && sim.time >= autoT - 1e-9) {
      sim.setPhase("driver");
      autoScore = sim.score();
      runners.A?.nextPeriod(); runners.B?.nextPeriod();
    }
    sim.step(dt);
  }
  sim.setPhase("ended");
  for (const r of Object.values(runners)) r!.stop();
  for (let i = 0; i < 10; i++) await tick();
  for (const r of Object.values(runners)) r!.dispose();
  return { sim, score: sim.score(), autoScore: autoScore ?? sim.score(), results, logs };
}
