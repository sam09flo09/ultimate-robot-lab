/** The built-in guided activities, in teaching order (Robotics I, Python unit).
 *  Ids are permanent (progress is saved under them), so later additions keep their own numbers:
 *  the driver-control activities a11 (needs loops + input/output) and a12 (needs if) slot in after
 *  a06 and a07. */
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
import { a11FirstDriverProgram } from "./a11-first-driver-program";
import { a12ArcadeDriveButtons } from "./a12-arcade-drive-buttons";
import { a13ArmsAndClaws } from "./a13-arms-and-claws"; // arm

export const BUILT_IN_ACTIVITIES: Activity[] = [
  a01MeetYourRobot,
  a02BlocksToPython,
  a03AnatomyOfAProgram,
  a04VariablesAndConstants,
  a05Loops,
  a06InputAndOutput,
  a11FirstDriverProgram,
  a07DecisionsLineFollow,
  a12ArcadeDriveButtons,
  a08DebuggingDetectives,
  a09FunctionsColorDepot,
  a10CapstoneMaze,
  a13ArmsAndClaws, // arm: manipulators (Units 8 and 12), after the capstone
];

export function getBuiltInActivity(id: string): Activity | undefined {
  return BUILT_IN_ACTIVITIES.find((a) => a.id === id);
}
