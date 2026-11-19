import type { Activity } from "../../core/activity";
import { GRID_CORNERS } from "./worlds";

/** Bug 1: two syntax errors (missing colon, missing bracket). Correct program ends in square 23. */
export const A08_SYNTAX_STARTER = [
  "# Should finish in square 23. But Python won't even start it!",
  "",
  "def main()",
  "    drivetrain.drive_for(FORWARD, 400, MM)",
  "    drivetrain.turn_for(RIGHT, 90, DEGREES",
  "    drivetrain.drive_for(FORWARD, 400, MM)",
  "",
  "start(main)",
  "",
].join("\n");

/** Bug 2: names with the wrong capitals. Correct program ends in square 34. */
export const A08_NAMES_STARTER = [
  "# Should finish in square 34. Python starts it, then stops with an error.",
  "",
  "SIDE = 600",
  "",
  "def main():",
  "    drivetrain.drive_for(FORWARD, side, MM)",
  "    drivetrain.turn_for(right, 90, DEGREES)",
  "    Drivetrain.drive_for(FORWARD, SIDE, MM)",
  "",
  "start(main)",
  "",
].join("\n");

/** Bug 3: logic errors (wrong turn direction, wrong repeat count). */
export const A08_LOGIC_STARTER = [
  "# Should drive round a square: 21, 23, 3 and back to square 1.",
  "# It runs with no errors... but does it do the right thing?",
  "",
  "def main():",
  "    for i in range(3):",
  "        drivetrain.drive_for(FORWARD, 400, MM)",
  "        drivetrain.turn_for(LEFT, 90, DEGREES)",
  "",
  "start(main)",
  "",
].join("\n");

/** The big one: one bug of each kind. Correct program climbs a staircase to square 100. */
export const A08_ALL_STARTER = [
  "# The staircase: up one, right one, nine times, from square 1 to square 100.",
  "# There are THREE bugs: a syntax error, a name error and a logic error.",
  "",
  "STEP = 200",
  "",
  "def main():",
  "    for i in range(9)",
  "        drivetrain.drive_for(FORWARD, STEP, MM)",
  "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
  "        drivetrain.drive_for(FORWARD, Step, MM)",
  "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
  "",
  "start(main)",
  "",
].join("\n");

export const a08DebuggingDetectives: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a08-debugging-detectives",
  title: "Debugging detectives",
  summary: "Find and fix syntax errors, name errors and logic errors in broken robot programs.",
  level: "core",
  minutes: 35,
  standards: [
    "TEKS (d)(5)(A)",
    "TEKS (d)(8)(B)",
    "YouScience Std 5 Obj 1.6",
    "YouScience Std 5 Obj 1.8",
    "YouScience Std 5 Obj 3.1",
  ],
  steps: [
    {
      id: "kinds-of-bugs",
      title: "Three kinds of bugs",
      world: { playground: "number-grid" },
      body: [
        "A **bug** is a mistake in a program. **Debugging** is finding and fixing it. There are three main kinds:",
        "- **Syntax error:** the code breaks Python's grammar rules (a missing `:` or bracket, wrong indentation). Python refuses to run **any** of it.",
        "- **Runtime error:** the grammar is fine, but something goes wrong while running, like using a name that doesn't exist (`NameError`). The program stops at that line.",
        "- **Logic error:** the program runs with no error message at all... but does the wrong thing. These are the sneakiest, because only **testing** finds them.",
        "Detective tip: read the error message. Robot Lab tells you the **line number** and what it thinks is wrong.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "The program runs, no error appears, but the robot turns left when it should turn right. What kind of bug is that?",
          choices: ["Syntax error", "Runtime error", "Logic error", "Not a bug"],
          answer: 2,
          explain: "No error message, wrong behaviour: that's a logic error. Python did exactly what you wrote, which wasn't what you meant.",
        },
        {
          prompt: "`def main()` is missing its colon. What happens when you press Run?",
          choices: ["The robot runs the lines before the mistake", "Python won't run any of the program", "It runs normally", "Only `main` is skipped"],
          answer: 1,
          explain: "Syntax errors are found before anything runs. Python checks the grammar of the whole program first.",
        },
        {
          prompt: "Which is the best way to find a logic error?",
          choices: ["Wait for an error message", "Run it and compare what happens with what should happen", "Add more semicolons", "Delete the program and start over"],
          answer: 1,
          explain: "Logic errors never show a message. You find them by testing against the requirements.",
        },
      ],
      hints: ["Ask: does Python refuse to start, stop part way, or finish doing the wrong thing?", "No error message + wrong result = logic."],
      done: "Now let's go bug hunting.",
    },
    {
      id: "syntax-bugs",
      title: "Case 1: grammar trouble",
      starter: { mode: "python", python: A08_SYNTAX_STARTER },
      lockMode: "python",
      body: [
        "This program should end in **square 23**, but it has **2 syntax errors**. Run it, read the error message, fix that line, and run again until it works.",
        "Look carefully at the ends of lines.",
      ].join("\n\n"),
      checks: [
        { kind: "ranWithoutError", label: "Runs without errors" },
        { kind: "endsInSquare", square: 23, label: "Finish in square 23" },
      ],
      hints: [
        "Every `def` line needs something at the end.",
        "Count the brackets on the `turn_for` line. Is every `(` closed by a `)`?",
        "Fix: `def main():` and `drivetrain.turn_for(RIGHT, 90, DEGREES)`.",
      ],
      done: "Case closed! Syntax errors: a missing colon and a missing bracket.",
    },
    {
      id: "name-bugs",
      title: "Case 2: the capital crime",
      starter: { mode: "python", python: A08_NAMES_STARTER },
      lockMode: "python",
      body: [
        "This program should end in **square 34**. It has **3 name bugs**. Python cares about capital letters: `SIDE`, `side` and `Side` are three different names.",
        "Run it. Each time it stops, read the message, fix that line, and run again.",
      ].join("\n\n"),
      checks: [
        { kind: "ranWithoutError", label: "Runs without errors" },
        { kind: "definesConstant", label: "Keep the constant `SIDE`" },
        { kind: "endsInSquare", square: 34, label: "Finish in square 34" },
      ],
      hints: [
        "The constant is spelled `SIDE` at the top. Is it spelled the same everywhere?",
        "Robot Lab's direction names are all capitals: `FORWARD`, `RIGHT`. Object names are all lower case: `drivetrain`.",
        "Fix: `side` → `SIDE`, `right` → `RIGHT`, `Drivetrain` → `drivetrain`.",
      ],
      done: "Case closed! Three names, three wrong capitals. Python is very picky about spelling.",
    },
    {
      id: "logic-bugs",
      title: "Case 3: no error, wrong result",
      world: { custom: GRID_CORNERS },
      starter: { mode: "python", python: A08_LOGIC_STARTER },
      lockMode: "python",
      body: [
        "The robot should drive round a square: visit **square 21**, then **23**, then **3**, and end back in **square 1**. The markers show where to go.",
        "This program runs with **no errors**, but it has **2 logic bugs**. Run it and watch closely. What goes wrong? Where should it have turned?",
        "Tip: put `pen.move(DOWN)` at the start so you can see the path it really takes.",
      ].join("\n\n"),
      checks: [
        { kind: "usesLoop", loop: "for", label: "Keep the `for` loop" },
        { kind: "goalsComplete", label: "Visit squares 21, 23 and 3 in order" },
        { kind: "endsInSquare", square: 1, label: "End back in square 1" },
      ],
      hints: [
        "Square 23 is to the **right** of square 21. Which way does the robot turn?",
        "A square has 4 sides. How many times does the loop run?",
        "Fix: `turn_for(RIGHT, ...)` and `range(4)`.",
      ],
      done: "Case closed! Logic errors only show up when you test against what the program is supposed to do.",
    },
    {
      id: "all-bugs",
      title: "Case 4: the triple threat",
      world: { playground: "number-grid" },
      starter: { mode: "python", python: A08_ALL_STARTER },
      lockMode: "python",
      body: [
        "Final case. This program should climb a staircase from **square 1** to **square 100**: up one square, right one square, nine times.",
        "It has **three bugs**, one of each kind: syntax, name and logic. Fix them one at a time, running after each fix.",
      ].join("\n\n"),
      checks: [
        { kind: "usesLoop", loop: "for", label: "Keep the `for` loop" },
        { kind: "ranWithoutError", label: "Runs without errors" },
        { kind: "endsInSquare", square: 100, label: "Finish in square 100" },
      ],
      hints: [
        "Syntax: look at the end of the `for` line.",
        "Name: the constant is `STEP`. Is it spelled the same both times?",
        "Logic: after going right, the robot has to face **up** again. Which way should the second turn go? Fix: the second `turn_for` should be `LEFT`.",
      ],
      done: "All cases closed! Read the message, fix one thing, test again: that's the debugging loop.",
    },
  ],
};
