import type { Activity } from "../../core/activity";

const PEN_STARTER = [
  "# Draw with the pen.",
  "",
  "def main():",
  "    pen.move(DOWN)",
  "    # Your statements here",
  "    pen.move(UP)",
  "",
  "start(main)",
  "",
].join("\n");

const WHILE_STARTER = [
  "# An octagon drawn with a while loop.",
  "",
  "def main():",
  "    count = 0",
  "    pen.move(DOWN)",
  "    # while ...",
  "    pen.move(UP)",
  "",
  "start(main)",
  "",
].join("\n");

export const a05Loops: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a05-loops",
  title: "Loops: repeat without copying",
  summary: "Draw shapes on the Sketch Pad with for loops and while loops, and write shorter programs.",
  level: "core",
  minutes: 40,
  standards: ["TEKS (d)(5)(A)", "TEKS (d)(8)(B)", "YouScience Std 5 Obj 1.3", "YouScience Std 5 Obj 3.2"],
  steps: [
    {
      id: "long-way",
      title: "A square, the long way",
      world: { playground: "sketch-pad" },
      starter: { mode: "python", python: PEN_STARTER },
      body: [
        "Draw a square with 400 mm sides. Write it **the long way**: four drive lines and four turn lines.",
        "When it works, count how many lines of code you wrote. Notice how you typed the same two lines four times? Programmers hate doing that. There's a better way.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "drivetrain.drive_for", min: 4, label: "Use `drivetrain.drive_for` 4 times" },
        { kind: "usesCall", name: "drivetrain.turn_for", min: 4, label: "Use `drivetrain.turn_for` 4 times" },
        { kind: "ranWithoutError", label: "Run without errors" },
      ],
      hints: [
        "One side = drive forward 400 mm, then turn right 90 degrees.",
        "Write those two lines, then copy them three more times (all indented inside main).",
      ],
      done: "It works, but it's long. Let's shrink it.",
    },
    {
      id: "for-square",
      title: "The same square with a for loop",
      body: [
        "A **for loop** repeats the indented lines under it a set number of times:",
        "```python\nfor i in range(4):\n    drivetrain.drive_for(FORWARD, 400, MM)\n    drivetrain.turn_for(RIGHT, 90, DEGREES)\n```",
        "- `range(4)` means \"4 times\". The variable `i` counts 0, 1, 2, 3.",
        "- The colon and the extra indent show which lines are inside the loop (just like `def main():`).",
        "Rewrite your square using a for loop. Your whole program must be **9 lines of code or fewer** (blank lines and comments don't count).",
      ].join("\n\n"),
      checks: [
        { kind: "usesLoop", loop: "for", label: "Use a `for` loop" },
        { kind: "maxLines", lines: 9, label: "9 lines of code or fewer" },
        { kind: "ranWithoutError", label: "Run without errors" },
      ],
      hints: [
        "Delete three of the four copies, then put `for i in range(4):` above the two lines that are left.",
        "The drive and turn lines need 8 spaces now: 4 for main, 4 more for the loop.",
        "```python\ndef main():\n    pen.move(DOWN)\n    for i in range(4):\n        drivetrain.drive_for(FORWARD, 400, MM)\n        drivetrain.turn_for(RIGHT, 90, DEGREES)\n    pen.move(UP)\n\nstart(main)\n```",
      ],
      done: "Same square, far fewer lines. And changing `range(4)` changes how many sides you draw.",
    },
    {
      id: "any-polygon",
      title: "Any shape you like",
      body: [
        "To draw a shape with any number of equal sides, the robot turns `360 / SIDES` degrees after each side.",
        "- Add a constant at the top: `SIDES = 6`",
        "- Loop `range(SIDES)` times: drive 300 mm, then turn right `360 / SIDES` degrees.",
        "Try 3 (triangle), 5, 6, 8. Try 36 with 50 mm sides. What happens?",
      ].join("\n\n"),
      checks: [
        { kind: "definesConstant", label: "Define a constant like `SIDES`" },
        { kind: "usesLoop", loop: "for", label: "Use a `for` loop" },
        { kind: "ranWithoutError", label: "Run without errors" },
      ],
      quiz: [
        {
          prompt: "How many times does the loop body run?",
          code: "for i in range(6):\n    drivetrain.drive_for(FORWARD, 300, MM)",
          choices: ["5", "6", "7", "It runs forever"],
          answer: 1,
          explain: "`range(6)` gives 0, 1, 2, 3, 4, 5: six numbers, so six runs.",
        },
        {
          prompt: "With `SIDES = 6`, how many degrees does `360 / SIDES` turn?",
          choices: ["6", "36", "60", "90"],
          answer: 2,
          explain: "360 ÷ 6 = 60 degrees. A hexagon's outside turns add up to one full circle.",
        },
      ],
      hints: [
        "`SIDES = 6` goes above `def main():`.",
        "The turn line: `drivetrain.turn_for(RIGHT, 360 / SIDES, DEGREES)`.",
        "```python\nSIDES = 6\n\ndef main():\n    pen.move(DOWN)\n    for i in range(SIDES):\n        drivetrain.drive_for(FORWARD, 300, MM)\n        drivetrain.turn_for(RIGHT, 360 / SIDES, DEGREES)\n    pen.move(UP)\n\nstart(main)\n```",
      ],
      done: "One program, every polygon. Loops plus constants are a powerful pair.",
    },
    {
      id: "while-octagon",
      title: "A while loop",
      starter: { mode: "python", python: WHILE_STARTER },
      body: [
        "A **while loop** repeats **as long as a condition is True**. It checks the condition before every run.",
        "```python\nwhile count < 8:\n    # ... draw one line ...\n    count = count + 1\n```",
        "Use a while loop to draw an **octagon** (8 sides): drive 200 mm, then turn right 45 degrees, while `count` is less than 8.",
        "Inside the loop, after `count = count + 1`, add `print(\"Lines drawn:\", count)`. The log must reach `Lines drawn: 8`.",
        "**Careful:** if you forget `count = count + 1`, `count` stays 0 forever, the condition is always True, and the loop never ends. That's an **infinite loop**. (Press Stop if it happens.)",
      ].join("\n\n"),
      checks: [
        { kind: "usesLoop", loop: "while", label: "Use a `while` loop" },
        { kind: "assignsVariable", name: "count", label: "Count with the variable `count`" },
        { kind: "logContains", text: "Lines drawn: 8", label: "Print `Lines drawn: 8`" },
      ],
      quiz: [
        {
          prompt: "What happens here?",
          code: "count = 0\nwhile count < 3:\n    drivetrain.drive_for(FORWARD, 100, MM)",
          choices: ["The robot drives 3 times", "The robot drives once", "It never stops: `count` never changes", "Nothing happens"],
          answer: 2,
          explain: "Nothing inside the loop changes `count`, so `count < 3` is True forever. That's an infinite loop.",
        },
      ],
      hints: [
        "The loop line is `while count < 8:` (with the colon). Everything inside is indented 8 spaces.",
        "Inside: drive, turn, `count = count + 1`, then the print.",
        "```python\n    while count < 8:\n        drivetrain.drive_for(FORWARD, 200, MM)\n        drivetrain.turn_for(RIGHT, 45, DEGREES)\n        count = count + 1\n        print(\"Lines drawn:\", count)\n```",
      ],
      done: "for loops repeat a set number of times. while loops repeat until something changes. Next you'll use while loops with sensors!",
    },
  ],
};
