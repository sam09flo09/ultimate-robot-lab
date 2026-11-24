/** RobotController: the student-facing API surface over the Engine. */
import type { ColorName, DriveDir, RobotController, TurnDir } from "../core/types";
import { clean, normDeg, round6 } from "./geometry";
import { type Engine, objectInFrontIdx } from "./engine";
import { BRIGHTNESS, DISTANCE_FOUND, DISTANCE_MAX, floorColorAt } from "./sensors";

function num(v: number): number { return typeof v === "number" && isFinite(v) ? v : 0; }
function clampPct(v: number): number { v = num(v); return v < 0 ? 0 : v > 100 ? 100 : v; }
function clampSigned(v: number): number { v = num(v); return v < -100 ? -100 : v > 100 ? 100 : v === 0 ? 0 : v; }

export function createController(e: Engine): RobotController {
  const fwd = () => {
    const rad = (e.state.robot.heading * Math.PI) / 180;
    return [clean(Math.sin(rad)), clean(Math.cos(rad))] as const;
  };
  const frontIdx = () => {
    const [ux, uy] = fwd();
    return objectInFrontIdx(e, ux, uy, false);
  };
  const gyro = () => normDeg(e.state.robot.heading - e.gyroOffset);

  const c: RobotController = {
    driveFor(dir: DriveDir, mm: number) {
      mm = num(mm);
      let sign = dir === "REVERSE" ? -1 : 1;
      if (mm < 0) { sign = -sign; mm = -mm; }
      return e.startDriveFor(sign, mm);
    },
    turnFor(dir: TurnDir, degrees: number) {
      degrees = num(degrees);
      let sign = dir === "LEFT" ? -1 : 1;
      if (degrees < 0) { sign = -sign; degrees = -degrees; }
      return e.startTurnFor(sign, degrees);
    },
    turnToHeading(degrees: number) {
      const target = normDeg(num(degrees));
      let delta = target - gyro();
      delta = ((delta % 360) + 540) % 360 - 180; // [-180, 180)
      delta = round6(delta);
      return e.startTurnFor(delta < 0 ? -1 : 1, Math.abs(delta));
    },
    drive(dir: DriveDir) { e.startDrive(dir === "REVERSE" ? -1 : 1); },
    turn(dir: TurnDir) { e.startTurn(dir === "LEFT" ? -1 : 1); },
    stop() { e.endMotion(); },
    setDriveVelocity(p: number) { e.driveVel = clampPct(p); },
    setTurnVelocity(p: number) { e.turnVel = clampPct(p); },
    setHeading(degrees: number) { e.gyroOffset = normDeg(e.state.robot.heading - normDeg(num(degrees))); },
    heading: gyro,
    rotation() { return round6(e.rotation); },
    isDone() { return e.motion === null; },
    wait(seconds: number) { return e.wait(num(seconds)); },

    distanceMM() {
      const t = e.rawDistance();
      return t > DISTANCE_MAX ? DISTANCE_MAX : Math.round(t * 10) / 10;
    },
    distanceFound() { return e.rawDistance() <= DISTANCE_FOUND; },
    frontColor() {
      const i = frontIdx();
      return i < 0 ? "NONE" : e.state.objects[i].color;
    },
    frontNear() { return frontIdx() >= 0; },
    frontBrightness() {
      const i = frontIdx();
      return i < 0 ? 0 : BRIGHTNESS[e.state.objects[i].color];
    },
    downColor() {
      const r = e.state.robot;
      return floorColorAt(e.world.floor, r.x, r.y);
    },
    downBrightness() {
      const r = e.state.robot;
      return BRIGHTNESS[floorColorAt(e.world.floor, r.x, r.y)];
    },
    bumperPressed() { return e.state.bumperPressed; },
    positionX() { return round6(e.state.robot.x); },
    positionY() { return round6(e.state.robot.y); },
    timer() { return round6(e.state.time - e.timerStart); },
    resetTimer() { e.timerStart = e.state.time; },

    penDown(down: boolean) {
      if (!e.hasPen) return false;
      e.setPenDown(!!down);
      return true;
    },
    setPenColor(col: ColorName) {
      if (!e.hasPen) return false;
      if (col in BRIGHTNESS && col !== "NONE") e.setPenColor(col);
      return true;
    },
    magnet(on: boolean) {
      if (!e.hasMagnet) return false;
      if (on) e.magnetOn(); else e.magnetOff();
      return true;
    },
    // arm (see sim/arm.ts); no-ops in worlds without an arm
    armAvailable() { return e.arm.fitted; },
    armSpinTo(degrees: number) {
      if (!e.arm.fitted) return Promise.resolve();
      return e.arm.spinTo(num(degrees));
    },
    armSpin(direction: 1 | -1 | 0) {
      if (!e.arm.fitted) return;
      e.arm.spin(direction > 0 ? 1 : direction < 0 ? -1 : 0);
    },
    setArmVelocity(p: number) { if (e.arm.fitted) e.arm.velocity = clampPct(p); },
    armAngle() { return e.state.arm ? round6(e.state.arm.angle) : 0; },
    claw(closed: boolean) {
      if (!e.arm.fitted) return Promise.resolve();
      return e.arm.claw(!!closed);
    },
    clawHolding() { return !!(e.state.arm && e.state.arm.holding !== null); },
    setWheelVelocities(l: number, r: number) { e.setWheels(clampSigned(l), clampSigned(r)); },
  };
  return c;
}
