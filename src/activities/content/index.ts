/** The built-in guided activities, in teaching order (Robotics I, Python unit). */
import type { Activity } from "../../core/activity";
import { a01MeetYourRobot } from "./a01-meet-your-robot";
import { a02BlocksToPython } from "./a02-blocks-to-python";
import { a03AnatomyOfAProgram } from "./a03-anatomy-of-a-program";
import { a04VariablesAndConstants } from "./a04-variables-and-constants";
import { a05Loops } from "./a05-loops";
import { a06InputAndOutput } from "./a06-input-and-output";
import { a07DecisionsLineFollow } from "./a07-decisions-line-follow";
import { a08DebuggingDetectives } from "./a08-debugging-detectives";
import { a09FunctionsColorDepot } from "./a09-functions-color-depot";
import { a10CapstoneMaze } from "./a10-capstone-maze";

export const BUILT_IN_ACTIVITIES: Activity[] = [
  a01MeetYourRobot,
  a02BlocksToPython,
  a03AnatomyOfAProgram,
  a04VariablesAndConstants,
  a05Loops,
  a06InputAndOutput,
  a07DecisionsLineFollow,
  a08DebuggingDetectives,
  a09FunctionsColorDepot,
  a10CapstoneMaze,
];

export function getBuiltInActivity(id: string): Activity | undefined {
  return BUILT_IN_ACTIVITIES.find((a) => a.id === id);
}
