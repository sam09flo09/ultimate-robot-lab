/** match: "Match day" — autonomous vs driver control, planning a routine, scoring math (Silo Sprint). */
import type { Activity } from "../../core/activity";
import type { World } from "../../core/types";
import { SILO_SPRINT_WORLD } from "../../match/engine/games";

/** The Silo Sprint field for practising alone (Team A's side; no opponent in an activity). */
export const MATCH_PRACTICE_WORLD: World = {
  ...SILO_SPRINT_WORLD,
  id: "custom",
  name: "Silo Sprint practice",
  description: "Practise for a Silo Sprint match on your own. You are red: your bin is top left, your silo bottom left, home is where you start.",
};

export const a14MatchDay: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a14-match-day",
  title: "Match day",
  summary: "Get ready for a two-robot match: write an autonomous routine and a driver-control loop, plan around the clock, and do the scoring math.",
  level: "stretch",
  minutes: 45,
  standards: ["YouScience Std 5 Obj 1.1", "YouScience Std 5 Obj 1.2", "YouScience Std 5 Obj 1.8", "TEKS (d)(8)(B)"],
  steps: [
    {
      id: "two-periods",
      title: "Two periods",
      world: { custom: MATCH_PRACTICE_WORLD },
      starter: {
        mode: "python",
        python: [
          "def autonomous():",
          "    # the robot drives itself here (15 seconds)",
          "    drivetrain.drive_for(FORWARD, 400, MM)",
          "",
          "def main():",
          "    autonomous()",
          "",
          "start(main)",
          "",
        ].join("\n"),
      },
      body: [
        "A robot match has **two periods**:",
        "- **Autonomous** (15 s): nobody touches a controller. The robot runs a program you wrote before the match. Robots that **sense** and **decide** on their own are *autonomous*.",
        "- **Driver control** (60 s): a person drives with the controller. The program still runs: it turns stick and button presses into motor commands.",
        "A match program has one function for each period, and ends with `competition(...)` instead of `start(main)`:",
        "```python\ndef autonomous():\n    drivetrain.drive_for(FORWARD, 400, MM)\n\ndef driver_control():\n    while True:\n        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)\n        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)\n        wait(20, MSEC)\n\ncompetition(autonomous, driver_control)\n```",
        "When you press Run, `competition` runs `autonomous()` and then `driver_control()`, so you can test both. In a match, the referee's clock ends autonomous: the robot stops wherever it is and `driver_control()` starts.",
        "Change the starter into a match program: keep `autonomous()`, add a `driver_control()` function, and make the last line `competition(autonomous, driver_control)` (no `()` after the names).",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "competition", label: "End with `competition(autonomous, driver_control)`" },
        { kind: "definesFunction", besides: ["main", "driver_control"], label: "Define `autonomous()`" },
        { kind: "definesFunction", besides: ["main", "autonomous"], label: "Define `driver_control()`" },
      ],
      quiz: [
        {
          prompt: "During the **autonomous** period, who decides what the robot does?",
          choices: ["The driver, with the controller", "The program, using its sensors", "The referee", "The other team"],
          answer: 1,
          explain: "Autonomous means the robot acts on its own: only the program (and what its sensors tell it) is in charge.",
        },
        {
          prompt: "Why is it `competition(autonomous, driver_control)` and not `competition(autonomous(), driver_control())`?",
          choices: [
            "Both are fine",
            "With (), Python would run the functions straight away and hand competition their results instead of the functions",
            "Brackets are not allowed in Python",
            "So the program runs faster",
          ],
          answer: 1,
          explain: "Just like `start(main)`, you hand over the function itself; `competition` decides when to run it.",
        },
      ],
      hints: [
        "Delete `def main()` and `start(main)`. Add:\n\n```python\ndef driver_control():\n    pass\n\ncompetition(autonomous, driver_control)\n```",
      ],
      done: "That's the shape of every match program: one function per period, then competition(...).",
    },
    {
      id: "plan-autonomous",
      title: "Plan an autonomous routine",
      body: [
        "Good teams **plan** their autonomous routine on paper before they code it. In Silo Sprint you are red: you start at (-1550, 0) facing right. Your **bin** is the red square top left (x -1800 to -1300, y 400 to 1200).",
        "The nearest disk is at **(-1000, 900)**. A plan for 15 seconds:",
        "- drive up to the disk and pick it up with the magnet",
        "- carry it into the bin and drop it",
        "- back away so you don't knock it out",
        "This helper turns and drives toward any point, stopping a little before it:",
        "```python\nimport math\n\ndef go_to(x, y, stop_short):\n    dx = x - location.position(X, MM)\n    dy = y - location.position(Y, MM)\n    drivetrain.turn_to_heading(math.degrees(math.atan2(dx, dy)) % 360, DEGREES)\n    drivetrain.drive_for(FORWARD, math.sqrt(dx * dx + dy * dy) - stop_short, MM)\n```",
        "Stop **125 mm** short of a disk so the magnet can reach it (`magnet.energize(BOOST)`), and drop it with `magnet.energize(DROP)` at about (-1450, 800). Run it and check that the disk lands in the bin before 15 seconds are up (watch the timer).",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "magnet.energize", min: 2, label: "Pick up and drop a disk with the magnet" },
        { kind: "definesFunction", besides: ["main", "autonomous", "driver_control"], label: "Write a helper function (like `go_to`)" },
        { kind: "usesCall", name: "competition", label: "Keep `competition(autonomous, driver_control)`" },
      ],
      quiz: [
        {
          prompt: "At 50% velocity the robot drives **400 mm per second**. About how long does a 1200 mm drive take?",
          choices: ["0.3 s", "3 s", "12 s", "30 s"],
          answer: 1,
          explain: "1200 ÷ 400 = 3 seconds. Add up every drive and turn in your plan to check it fits in 15 s.",
        },
      ],
      hints: [
        "```python\ndef autonomous():\n    go_to(-1000, 900, 125)\n    magnet.energize(BOOST)\n    go_to(-1450, 800, 0)\n    magnet.energize(DROP)\n    drivetrain.drive_for(REVERSE, 250, MM)\n```",
        "Put `import math` and `def go_to(...)` at the top, before `autonomous()`.",
      ],
      done: "A planned routine scores the same points every time: that's what autonomous is for.",
    },
    {
      id: "driver-loop",
      title: "Driver control",
      body: [
        "Now the person takes over. `driver_control()` is a loop that reads the controller about 50 times a second and sets the motors:",
        "- the left stick (`axis3`) drives the left wheel, the right stick (`axis2`) the right wheel (**tank drive**)",
        "- a button can work the magnet: `if controller.buttonA.pressing(): magnet.energize(BOOST)`",
        "Write a `while True:` loop in `driver_control()` that reads at least `controller.axis3.position()`, spins the motors and waits 20 MSEC. Press Run: your autonomous runs first, then you can drive (keys W/S and ↑/↓).",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "controller.axis3.position", label: "Read the left stick (`controller.axis3.position()`)" },
        { kind: "usesLoop", loop: "while", label: "Keep reading the controller in a `while` loop" },
        { kind: "usesCall", name: "competition", label: "Keep `competition(autonomous, driver_control)`" },
      ],
      quiz: [
        {
          prompt: "Why does the driver loop have `wait(20, MSEC)` in it?",
          choices: ["To make the robot slower", "So the program checks the controller about 50 times a second without hogging the computer", "Because the motors need a rest", "It ends driver control after 20 ms"],
          answer: 1,
          explain: "20 ms is quick enough to feel instant to a driver, and it gives the rest of the app time to run.",
        },
      ],
      hints: [
        "```python\ndef driver_control():\n    while True:\n        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)\n        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)\n        wait(20, MSEC)\n```",
      ],
      done: "Your program now has both periods. Time to think about points.",
    },
    {
      id: "scoring-math",
      title: "Scoring math",
      body: [
        "Silo Sprint scoring:",
        "- each disk resting in your **bin**: **1 point**",
        "- each disk resting on top of your **silo** (lift it with the arm and claw): **3 points**",
        "- robot parked in your **home** square when time runs out: **2 points**",
        "- the team ahead when autonomous ends: **5 bonus points** (a tie splits them: 2.5 each)",
        "A disk only counts when it is resting: not on a magnet and not in a claw. Work out the answers.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "Red ends with **3 disks** in the bin, **1 disk** on the silo, is **parked** at home, and was ahead after autonomous. What is red's score?",
          choices: ["6", "9", "13", "15"],
          answer: 2,
          explain: "3 × 1 + 1 × 3 + 2 + 5 = 13.",
        },
        {
          prompt: "Carrying a disk to the bin takes about **8 s**; stacking one on the silo takes about **20 s**. Which earns more points per second?",
          choices: ["The bin: 1 ÷ 8 ≈ 0.13 points per second", "The silo: 3 ÷ 20 = 0.15 points per second", "They are exactly the same", "You can't tell"],
          answer: 1,
          explain: "0.15 > 0.125, so the silo is slightly better, if your claw routine is reliable. Speed and reliability both matter.",
        },
        {
          prompt: "With **4 seconds** left in the match, your robot is far from home holding a disk on its magnet. What's the best move?",
          choices: ["Keep holding the disk", "Drop the disk in the bin if you're right there, otherwise head home to park", "Drive to the other team's bin", "Stop and wait"],
          answer: 1,
          explain: "A held disk scores nothing. Score it or park: points only count when the clock stops.",
        },
      ],
      hints: ["Add the parts one at a time: bin disks, silo disks, parking, then the bonus."],
      done: "Good strategy is just careful math under a time limit.",
    },
    {
      id: "match-ready",
      title: "Match ready",
      body: [
        "Last checks before match day:",
        "- Your autonomous routine should finish (or at least score) **within 15 s**. When time is up, the robot stops wherever it is, even in the middle of a drive.",
        "- Make your driver loop easy to drive: try arcade drive, slow mode on a button, the magnet on a button.",
        "- End `autonomous()` close to where the driver wants to start.",
        "Open **Match** to play against a practice bot (or a classmate's file), then answer the questions.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "competition", label: "Your program ends with `competition(autonomous, driver_control)`" },
        { kind: "hasComment", min: 2, label: "Add at least 2 comments that explain your plan" },
      ],
      quiz: [
        {
          prompt: "Your autonomous routine takes **18 s** but the period is **15 s**. What happens?",
          choices: ["The match waits for it", "The robot stops at 15 s and driver control starts; the last part never runs", "It gets a penalty and restarts", "Driver control is skipped"],
          answer: 1,
          explain: "The clock wins: autonomous() is interrupted. Put the moves that score first.",
        },
      ],
      hints: ["Comments start with `#`, for example `# 1. grab the disk at (-1000, 900)`."],
      done: "You're ready for match day. Good luck!",
    },
  ],
};
