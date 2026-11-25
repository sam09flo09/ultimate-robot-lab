/**
 * match: two robots on one field (see core/match.ts MatchSim).
 *
 * Design: two ordinary sim Engines (src/sim/engine.ts) that SHARE one set of objects (positions,
 * collision bodies, stacks) through the engine's small `// match` hooks:
 *  - Robot ↔ robot: each engine sees the other robot as an extra solid, immovable body
 *    (`extraStatics`), refreshed before each of its substeps. Robots can't overlap or tunnel
 *    (motion is resolved in ≤ 7 mm pieces, robots are ≥ 120 mm), but they can't shove each other
 *    either: a robot that drives into the other just stops against it, like a wall
 *    (its bumper is pressed; it is not counted as a wall hit).
 *  - Shared objects: either robot pushes, picks up (magnet) or grabs (claw) the same disks. An object
 *    held by one robot is left alone by the other (`foreignHeld`): it can't be pushed, picked or grabbed,
 *    and it passes through the other robot like any held object passes through walls.
 *  - Lockstep: both engines advance one 1/120 s substep at a time; the order alternates every substep
 *    so neither team always moves first. Same dt sequence → same result.
 */
import type { RobotConfig, SimEvent, SimState } from "../../core/types";
import type { MatchGame, MatchPhase, MatchRobot, MatchScore, MatchSim, ScoreLine, Team } from "../../core/match";
import { Engine, SUBSTEP } from "../../sim/engine";
import { createController } from "../../sim/controller";
import { type Body, makeBox, pointInZone, setBoxAngle } from "../../sim/geometry";
import { onPlatform, zOf } from "../../sim/arm";

const MAX_STEP_DT = 0.5;

export function createMatchSim(game: MatchGame, configA?: Partial<RobotConfig> | null, configB?: Partial<RobotConfig> | null): MatchSim {
  const worldA = { ...game.world, goals: [] };
  const worldB = { ...worldA, start: { ...game.startB } };
  const eA = new Engine(worldA, configA);
  const eB = new Engine(worldB, configB);
  const bodyOfA: Body = makeBox(0, 0, eA.half, eA.half, 0); // what B bumps into
  const bodyOfB: Body = makeBox(0, 0, eB.half, eB.half, 0); // what A bumps into
  eA.extraStatics = [bodyOfB];
  eB.extraStatics = [bodyOfA];
  eA.foreignHeld = (i) => i === eB.carryIndex || i === eB.arm.heldIndex;
  eB.foreignHeld = (i) => i === eA.carryIndex || i === eA.arm.heldIndex;

  let phase: MatchPhase = "idle";
  let acc = 0;
  let n = 0;                                   // substeps taken (for alternating order)
  let autoWinner: Team | "tie" | null = null;
  const listeners: Array<(team: Team, e: SimEvent) => void> = [];
  eA.onEvent((e) => emit("A", e));
  eB.onEvent((e) => emit("B", e));

  function emit(team: Team, e: SimEvent) {
    for (const cb of listeners.slice()) { try { cb(team, e); } catch (err) { console.error(err); } }
  }

  function link() {
    eB.shareObjectsWith(eA);
    sync(eA, bodyOfA); sync(eB, bodyOfB);
  }
  function sync(e: Engine, b: Body) {
    const r = e.state.robot;
    b.x = r.x; b.y = r.y; b.hx = b.hy = e.half;
    setBoxAngle(b, r.heading);
  }
  link();

  function heldIds(): Set<string> {
    const out = new Set<string>();
    for (const e of [eA, eB]) {
      if (e.state.carrying) out.add(e.state.carrying);
      if (e.state.arm?.holding) out.add(e.state.arm.holding);
    }
    return out;
  }

  /** Objects at rest: not on a magnet, not in a claw, not riding on something in a claw. */
  function restingIndices(): number[] {
    const held = heldIds();
    const objs = eA.state.objects;
    const out: number[] = [];
    for (let i = 0; i < objs.length; i++) {
      if (held.has(objs[i].id) || eA.arm.restsOnHeld(i)) continue;
      out.push(i);
    }
    return out;
  }

  function scoreLines(withPark: boolean): ScoreLine[] {
    const objs = eA.state.objects;
    const rest = restingIndices();
    const lines: ScoreLine[] = [];
    for (const rule of game.scoring) {
      if (rule.kind === "objectsInZone") {
        const z = game.world.zones.find((q) => q.id === rule.zone);
        let c = 0;
        if (z) for (const i of rest) {
          const o = objs[i];
          if ((!rule.color || o.color === rule.color) && pointInZone(z, o.x, o.y)) c++;
        }
        lines.push({ team: rule.team, label: rule.label, points: c * rule.points, count: c });
      } else if (rule.kind === "objectsOnPlatform") {
        const p = (game.world.platforms ?? []).find((q) => q.id === rule.platform);
        let c = 0;
        if (p) for (const i of rest) {
          const o = objs[i];
          if ((!rule.color || o.color === rule.color) && zOf(o) >= p.height - 1 && onPlatform(p, o.x, o.y)) c++;
        }
        lines.push({ team: rule.team, label: rule.label, points: c * rule.points, count: c });
      } else if (rule.kind === "parkInZone" && withPark) {
        const z = game.world.zones.find((q) => q.id === rule.zone);
        const teams: Team[] = rule.team === "any" ? ["A", "B"] : [rule.team];
        for (const t of teams) {
          const r = (t === "A" ? eA : eB).state.robot;
          const inside = !!z && pointInZone(z, r.x, r.y);
          lines.push({ team: t, label: rule.label, points: inside ? rule.points : 0, count: inside ? 1 : 0 });
        }
      }
    }
    return lines;
  }

  const total = (lines: ScoreLine[], t: Team) => lines.reduce((s, l) => s + (l.team === t ? l.points : 0), 0);

  function decideAutonomous() {
    if (autoWinner !== null) return;
    const lines = scoreLines(false);
    const a = total(lines, "A"), b = total(lines, "B");
    autoWinner = a > b ? "A" : b > a ? "B" : "tie";
  }

  function robot(team: Team, e: Engine): MatchRobot {
    const controller = createController(e);
    return { team, get state(): SimState { return e.state; }, controller };
  }
  const robots = { A: robot("A", eA), B: robot("B", eB) };

  const sim: MatchSim = {
    game,
    robots,
    get phase() { return phase; },
    get time() { return eA.state.time; },
    step(dt: number) {
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_STEP_DT) dt = MAX_STEP_DT;
      acc += dt;
      while (acc >= SUBSTEP - 1e-9) {
        acc -= SUBSTEP;
        const first = n % 2 === 0 ? eA : eB, second = first === eA ? eB : eA;
        n++;
        sync(second, second === eA ? bodyOfA : bodyOfB);
        first.step(SUBSTEP);
        sync(first, first === eA ? bodyOfA : bodyOfB);
        second.step(SUBSTEP);
        sync(second, second === eA ? bodyOfA : bodyOfB);
      }
      if (acc < 0) acc = 0;
    },
    setPhase(p: MatchPhase) {
      if (p === phase) return;
      const prev = phase;
      if (prev === "autonomous" && (p === "driver" || p === "ended")) decideAutonomous();
      phase = p;
      if (p === "ended") { eA.abort(); eB.abort(); }
    },
    reset() {
      phase = "idle"; autoWinner = null; acc = 0; n = 0;
      eB.arm.shareStack(null); // B rebuilds its own copies first, then shares A's again
      eA.reset();
      eB.reset();
      link();
    },
    abort() { eA.abort(); eB.abort(); },
    score(): MatchScore {
      const lines = scoreLines(phase === "ended");
      if (autoWinner !== null && game.autonomousBonus > 0) {
        const label = "Autonomous bonus";
        if (autoWinner === "tie") {
          const half = game.autonomousBonus / 2;
          lines.push({ team: "A", label, points: half }, { team: "B", label, points: half });
        } else lines.push({ team: autoWinner, label, points: game.autonomousBonus });
      }
      return { A: total(lines, "A"), B: total(lines, "B"), lines, autonomousWinner: autoWinner };
    },
    onEvent(cb) {
      listeners.push(cb);
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
  };
  return sim;
}
