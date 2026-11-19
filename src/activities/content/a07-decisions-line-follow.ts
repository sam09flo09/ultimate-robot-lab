import type { Activity } from "../../core/activity";
import { COLOR_CHECK } from "./worlds";

const CHECK_STARTER = [
  "# What colour is under the robot?",
  "",
  "def main():",
  "    # if the down eye sees GREEN, print GO, else print STOP",
  "    pass",
  "",
  "start(main)",
  "",
].join("\n");

const FOLLOW_STARTER = [
  "# Tape Trail: follow the black tape all the way round.",
  "",
  "def main():",
  "    drivetrain.set_drive_velocity(50, PERCENT)",
  "    drivetrain.set_turn_velocity(50, PERCENT)",
  "    while not down_eye.detect(GREEN):",
  "        if down_eye.detect(BLACK):",
  "            drivetrain.turn_for(LEFT, 6, DEGREES)",
  "        # else: what should the robot do when it sees white floor?",
  "        drivetrain.drive_for(FORWARD, 10, MM)",
  "    drivetrain.stop()",
  "",
  "start(main)",
  "",
].join("\n");

export const a07DecisionsLineFollow: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a07-decisions-line-follow",
  title: "Decisions: follow the tape",
  summary: "Use if / else with the down eye to make a line follower that drives all the way round Tape Trail.",
  level: "core",
  minutes: 45,
  standards: [
    "TEKS (d)(5)(A)",
    "TEKS (d)(8)(B)",
    "TEKS (d)(9)(C)",
    "YouScience Std 5 Obj 1.3",
    "YouScience Std 5 Obj 3.3",
    "YouScience Std 5 Obj 1.6",
  ],
  steps: [
    {
      id: "if-else-basics",
      title: "if and else",
      world: { custom: COLOR_CHECK },
      body: [
        "An `if` statement lets the program **choose**. It asks a True/False question (a **condition**) and only runs the indented lines if the answer is True. `else` runs when the answer is False.",
        "```python\nif down_eye.detect(GREEN):\n    print(\"GO\")\nelse:\n    print(\"STOP\")\n```",
        "- The condition ends with a colon `:`.",
        "- Exactly one of the two groups runs, never both.",
        "- Compare with `==` (two equals signs): `if down_eye.color() == RED:`",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "The robot is on white floor. What does this print?",
          code: "if down_eye.detect(BLACK):\n    print(\"tape\")\nelse:\n    print(\"floor\")",
          choices: ["`tape`", "`floor`", "both", "nothing"],
          answer: 1,
          explain: "The condition is False (no black under the robot), so the `else` part runs.",
        },
        {
          prompt: "Which line has a mistake?",
          choices: ["`if down_eye.color() == RED:`", "`if down_eye.color() = RED:`", "`if bumper.pressed():`", "`else:`"],
          answer: 1,
          explain: "A single `=` stores a value. To compare you need `==`.",
        },
      ],
      hints: ["When the condition is False, Python skips to `else`.", "Comparing uses two equals signs."],
      done: "if picks a path. else is the other path.",
    },
    {
      id: "color-check",
      title: "Colour check",
      starter: { mode: "python", python: CHECK_STARTER },
      body: [
        "The robot is sitting on a green pad. Write an `if` / `else` that prints `GO` if the down eye sees `GREEN`, and `STOP` otherwise.",
        "Then test the **other** path too: change `GREEN` to `RED` and run again. It should print `STOP`. Change it back to `GREEN` when you're done. Testing **both** paths of every decision is good practice.",
      ].join("\n\n"),
      checks: [
        { kind: "usesIf", withElse: true, label: "Use `if` … `else`" },
        { kind: "readsSensor", label: "Read the down eye" },
        { kind: "logContains", text: "GO", label: "Print `GO` (with the robot on green)" },
      ],
      hints: [
        "Replace `pass` with your if / else, indented 4 spaces inside main.",
        "```python\n    if down_eye.detect(GREEN):\n        print(\"GO\")\n    else:\n        print(\"STOP\")\n```",
      ],
      done: "Both paths tested. Now let's use a decision hundreds of times a second.",
    },
    {
      id: "follow-tape",
      title: "Follow the tape",
      world: { playground: "tape-trail" },
      starter: { mode: "python", python: FOLLOW_STARTER },
      body: [
        "A **line follower** is one of the most famous robot programs. Ours follows the **edge** of the black tape:",
        "- **On black?** Turn a little to the **left** (off the tape).",
        "- **On white?** Turn a little to the **right** (back toward the tape).",
        "- Either way, then drive forward a tiny bit, and repeat.",
        "The robot wiggles along the left edge of the tape. That wiggle is normal! It's called **bang-bang control**.",
        "The starter does the \"on black\" part. Add the `else:` part so the robot turns **right** 6 degrees on white floor. Then run it and watch it go all the way round. It stops on the green finish line.",
      ].join("\n\n"),
      checks: [
        { kind: "usesIf", withElse: true, label: "Use `if` … `else`" },
        { kind: "usesLoop", loop: "while", label: "Use a `while` loop" },
        { kind: "goalsComplete", label: "Pass all checkpoints and finish" },
      ],
      hints: [
        "`else:` lines up exactly under `if`, and the turn inside it is indented 4 more spaces.",
        "When the robot is on white it needs to turn back toward the tape. The tape goes round clockwise, so the tape is to the robot's right.",
        "```python\n        if down_eye.detect(BLACK):\n            drivetrain.turn_for(LEFT, 6, DEGREES)\n        else:\n            drivetrain.turn_for(RIGHT, 6, DEGREES)\n        drivetrain.drive_for(FORWARD, 10, MM)\n```",
      ],
      done: "Your robot followed a curvy track using one sensor and one decision. Real factory robots do exactly this!",
    },
    {
      id: "tuning",
      title: "Tuning",
      body: [
        "Try changing the numbers in your line follower and re-running. Then answer the questions.",
        "- What if the turn is 2 degrees instead of 6?",
        "- What if each drive is 40 mm instead of 10?",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "You make the turn only 2 degrees. On the sharp bends the robot runs off the tape and gets lost. Why?",
          choices: [
            "2 is an odd number",
            "It can't turn fast enough to keep up with a tight curve",
            "The sensor stops working",
            "The loop ends early",
          ],
          answer: 1,
          explain: "Small turns are smooth, but on a tight bend the tape curves away faster than the robot can turn.",
        },
        {
          prompt: "Changing numbers, running, watching and changing again is…",
          choices: ["cheating", "testing and redoing: part of the design process", "only for experts", "a syntax error"],
          answer: 1,
          explain: "Test, look at the results, improve, test again. Professional engineers do this all the time.",
        },
      ],
      hints: ["Think about a car taking a sharp corner while barely turning the wheel.", "Testing and improving is a normal step, not a failure."],
      done: "You've written, tested and tuned a real control program.",
    },
  ],
};
