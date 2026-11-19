import type { Activity } from "../../core/activity";
import { ORIGINAL_TEMPLATE } from "../../worlds";

export const a02BlocksToPython: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a02-blocks-to-python",
  title: "From blocks to Python",
  summary: "Write your first Python program and compare its structure with the Arduino C++ you wrote last week.",
  level: "starter",
  minutes: 30,
  standards: [
    "TEKS (d)(5)(A)",
    "YouScience Std 5 Obj 2.2",
    "YouScience Std 5 Obj 3.1",
    "YouScience Std 5 Obj 1.5",
    "YouScience Std 5 Obj 1.7",
  ],
  steps: [
    {
      id: "read-python",
      title: "Read a Python program",
      world: { playground: "number-grid" },
      body: [
        "Every block program is really Python underneath. Here is the program that drives to square 45:",
        "```python\ndef main():\n    drivetrain.drive_for(FORWARD, 800, MM)\n    drivetrain.turn_for(RIGHT, 90, DEGREES)\n    drivetrain.drive_for(FORWARD, 800, MM)\n\nstart(main)\n```",
        "- `def main():` **defines** a function called `main`. The colon `:` says \"the body comes next\".",
        "- The lines inside `main` are **indented** 4 spaces. In Python, indentation is not just neat: it tells Python which lines belong to `main`.",
        "- `start(main)` is the **entry point**. It is not indented, and it is the last line. It tells Robot Lab: \"start running here, at `main`\".",
        "Answer the questions to continue.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "Which line is the **entry point** that makes the program run?",
          code: "def main():\n    drivetrain.drive_for(FORWARD, 800, MM)\n\nstart(main)",
          choices: ["`def main():`", "`drivetrain.drive_for(FORWARD, 800, MM)`", "`start(main)`", "There isn't one"],
          answer: 2,
          explain: "`def main():` only **describes** what main does. `start(main)` is what actually runs it.",
        },
        {
          prompt: "How does Python know which lines are inside `main`?",
          choices: ["Curly braces `{ }`", "Semicolons `;` at the end of each line", "The lines are indented under `def main():`", "They are in capital letters"],
          answer: 2,
          explain: "Python uses **indentation** (4 spaces) to group lines into a block. C++ uses curly braces for that.",
        },
      ],
      hints: [
        "One line describes `main`, a different line runs it.",
        "Look for the line that is not indented, at the very bottom.",
      ],
      done: "You can read Python program structure. Now write some!",
    },
    {
      id: "write-python",
      title: "Write it yourself: square 23",
      starter: { mode: "python", python: ORIGINAL_TEMPLATE },
      lockMode: "python",
      body: [
        "Now you are in **Python mode**. The editor has a template. Delete the `pass` line and write statements inside `main` so the robot ends in **square 23**.",
        "Square 23 is 2 rows up and 2 squares right of square 1.",
        "- Each statement goes on its own line, indented 4 spaces.",
        "- Spell the names exactly: `drivetrain.drive_for(FORWARD, 400, MM)`.",
        "- Capital letters matter: `FORWARD` works, `forward` does not.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "drivetrain.drive_for", min: 2, label: "Use `drivetrain.drive_for` at least twice" },
        { kind: "usesCall", name: "drivetrain.turn_for", label: "Use `drivetrain.turn_for`" },
        { kind: "endsInSquare", square: 23, label: "Finish in square 23" },
      ],
      hints: [
        "Go up first (toward 11, 21), then turn right and go across (22, 23).",
        "2 squares = 400 mm. Turn right with `drivetrain.turn_for(RIGHT, 90, DEGREES)`.",
        "Inside main:\n\n```python\n    drivetrain.drive_for(FORWARD, 400, MM)\n    drivetrain.turn_for(RIGHT, 90, DEGREES)\n    drivetrain.drive_for(FORWARD, 400, MM)\n```",
      ],
      done: "Your first Python program! Same robot, same ideas, just typed instead of snapped.",
    },
    {
      id: "python-vs-arduino",
      title: "Python vs Arduino C++",
      body: [
        "Last week you wrote Arduino code in C++. It looked something like this:",
        "```cpp\nint ledPin = 13;      // a variable with a type\n\nvoid setup() {        // runs once\n  pinMode(ledPin, OUTPUT);\n}\n\nvoid loop() {         // runs again and again\n  digitalWrite(ledPin, HIGH);\n  delay(1000);\n}\n```",
        "Python does the same jobs with less punctuation:",
        "- C++ groups lines with **curly braces** `{ }`. Python uses a **colon and indentation**.",
        "- C++ ends each statement with a **semicolon** `;`. Python just ends the line.",
        "- C++ comments start with `//`. Python comments start with `#`.",
        "- C++ needs a **type** for a variable (`int ledPin = 13;`). Python just writes `led_pin = 13`.",
        "- Arduino always starts at `setup()`, then repeats `loop()` forever. In Robot Lab, `start(main)` runs `main` **once**. If you want repeating, you write a loop yourself.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "In Arduino, `setup()` runs once at the start. What does that job in a Robot Lab Python program?",
          choices: ["`loop()`", "`start(main)` running `main`", "`#include`", "`void`"],
          answer: 1,
          explain: "`start(main)` is the entry point: it runs `main` once, like Arduino runs `setup()` once.",
        },
        {
          prompt: "Which of these is a correct Python comment?",
          choices: ["`// turn right`", "`/* turn right */`", "`# turn right`", "`-- turn right`"],
          answer: 2,
          explain: "Python comments start with `#`. `//` and `/* */` are C++ comments.",
        },
        {
          prompt: "Which line is valid **Python**?",
          choices: ["`int speed = 50;`", "`speed = 50`", "`int speed = 50`", "`speed = 50;  {`"],
          answer: 1,
          explain: "Python doesn't need a type like `int` and doesn't need a semicolon.",
        },
        {
          prompt: "In C++, curly braces `{ }` show which lines are inside a function. What does Python use?",
          choices: ["Square brackets `[ ]`", "Indentation after a line ending in `:`", "The word `end`", "Nothing, every line is separate"],
          answer: 1,
          explain: "A colon starts a block, and the indented lines under it are the block.",
        },
      ],
      hints: [
        "Think about what each symbol is for: grouping, ending a line, or a note for humans.",
        "Python: `#` for comments, `:` plus indentation for blocks, no semicolons, no types.",
      ],
      done: "You can now spot the differences between C++ and Python. Most programming ideas carry over; only the spelling changes.",
    },
    {
      id: "commented-corner",
      title: "Square 100, with comments",
      starter: { mode: "python", python: ORIGINAL_TEMPLATE },
      lockMode: "python",
      body: [
        "Write a Python program that drives to **square 100** (top-right corner).",
        "This time, add **comments** that explain your plan. A comment starts with `#`. Python ignores it, but people reading your code (including future you) will thank you.",
        "```python\ndef main():\n    # Go up the left side to square 91\n    drivetrain.drive_for(FORWARD, 1800, MM)\n```",
        "Write at least **2 comments of your own**.",
      ].join("\n\n"),
      checks: [
        { kind: "hasComment", min: 2, label: "Write at least 2 comments of your own" },
        { kind: "endsInSquare", square: 100, label: "Finish in square 100" },
      ],
      hints: [
        "It's the same plan as the blocks challenge: 9 squares up, turn right, 9 squares across.",
        "Put a `#` comment on its own line above each part of the plan.",
        "```python\ndef main():\n    # Up to square 91\n    drivetrain.drive_for(FORWARD, 1800, MM)\n    # Face right, then across to 100\n    drivetrain.turn_for(RIGHT, 90, DEGREES)\n    drivetrain.drive_for(FORWARD, 1800, MM)\n\nstart(main)\n```",
      ],
      done: "Comments are **internal documentation**: notes inside the code that explain why it works.",
    },
  ],
};
