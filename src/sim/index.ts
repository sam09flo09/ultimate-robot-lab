/**
 * Robot Lab simulation engine. Public entry: createSim(world).
 * See src/core/types.ts for the Sim / RobotController contract.
 */
import type { Sim, World } from "../core/types";
import { Engine } from "./engine";
import { createController } from "./controller";

export { SUBSTEP, ROBOT_SIZE } from "./engine";
export { BRIGHTNESS } from "./sensors";

export function createSim(world: World): Sim {
  const engine = new Engine(world);
  const controller = createController(engine);
  return {
    world,
    get state() { return engine.state; },
    controller,
    step: (dt) => engine.step(dt),
    reset: () => engine.reset(),
    abort: () => engine.abort(),
    evaluateGoals: () => engine.evaluateGoals(),
    onEvent: (cb) => engine.onEvent(cb),
  };
}
