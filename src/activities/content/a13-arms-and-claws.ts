import type { Activity } from "../../core/activity";
import { SHELF_DROP, STACK_PAD } from "./worlds";

/** arm: helper functions students are given (and the reference solutions reuse). The claw holds a block
 *  130 mm ahead of the robot's centre, so go_to(x, y, HOLD) puts the claw right over (x, y). */
export const ARM_HELPER_LINES = [
  "import math",
  "",
  "HOLD = 130  # mm from the robot's centre to the middle of the claw",
  "",
  "def go_to(x, y, stop_short):",
  "    \"\"\"Face the point (x, y) and drive toward it, stopping stop_short mm before it.\"\"\"",
  "    dx = x - location.position(X, MM)",
  "    dy = y - location.position(Y, MM)",
  "    drivetrain.turn_to_heading(math.degrees(math.atan2(dx, dy)) % 360, DEGREES)",
  "    drivetrain.drive_for(FORWARD, math.sqrt(dx * dx + dy * dy) - stop_short, MM)",
  "",
  "def pick_up(x, y):",
  "    \"\"\"Grab the block on the floor at (x, y).\"\"\"",
  "    arm.spin_to_position(0, DEGREES)",
  "    go_to(x, y, HOLD)",
  "    claw.close()",
  "",
  "def place(x, y, lift):",
  "    \"\"\"Lift to `lift` degrees, carry the block over (x, y) from below, lower it until it lands, let go.\"\"\"",
  "    arm.spin_to_position(lift, DEGREES)",
  "    go_to(x, y - 250, 0)",
  "    go_to(x, y, HOLD)",
  "    arm.spin_to_position(0, DEGREES)  # stops when the block lands",
  "    claw.open()",
  "    arm.spin_to_position(lift, DEGREES)",
  "    drivetrain.drive_for(REVERSE, 200, MM)",
  "",
];

const py = (...main: string[]) => [...ARM_HELPER_LINES, "def main():", ...main.map((l) => "    " + l), "", "start(main)", ""].join("\n");

export const a13ArmsAndClaws: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a13-arms-and-claws",
  title: "Arms and claws",
  summary: "Meet a manipulator: map the arm's work envelope, count degrees of freedom, then pick, place and stack blocks with a claw.",
  level: "core",
  minutes: 40,
  standards: ["TEKS (d)(5)(A)", "YouScience Std 5 Obj 1.2", "YouScience Std 5 Obj 1.3"],
  steps: [
    {
      id: "work-envelope",
      title: "The arm's work envelope",
      world: { playground: "stack-shop" },
      starter: {
        mode: "python",
        python: [
          "def main():",
          "    arm.spin_to_position(30, DEGREES)",
          "",
          "start(main)",
          "",
        ].join("\n"),
      },
      body: [
        "This robot has a **manipulator**: an **arm** that lifts, with a **claw** on the end. The claw is the arm's **end effector**, the part that touches the world.",
        "The arm turns on one joint. **0°** is down (claw at the floor) and **90°** is straight up. The claw's height is:",
        "```python\nheight = 300 * math.sin(math.radians(angle))   # mm\n```",
        "All the places the claw can reach make its **work envelope**. For this arm it's a tall, thin slice in front of the robot, from the floor up to 300 mm. Drive the robot and the whole envelope moves with it.",
        "Move the arm to **at least two** angles and **print** `arm.position(DEGREES)` after each one. Watch the claw rise in 3D view.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "arm.spin_to_position", min: 2, label: "Move the arm to at least two angles" },
        { kind: "printsOutput", label: "Print the arm's position" },
        { kind: "ranWithoutError", label: "Run without errors" },
      ],
      quiz: [
        {
          prompt: "The arm is at **30°**. How high is the claw? (sin 30° = 0.5)",
          choices: ["30 mm", "150 mm", "270 mm", "300 mm"],
          answer: 1,
          explain: "300 × 0.5 = 150 mm.",
        },
        {
          prompt: "What is a robot arm's **work envelope**?",
          choices: ["The box it was shipped in", "All the places its end effector can reach", "How heavy a load it can lift", "The time a move takes"],
          answer: 1,
          explain: "The work envelope is the space the end effector (here the claw) can reach.",
        },
      ],
      hints: [
        "`arm.spin_to_position(60, DEGREES)` moves the arm and waits until it gets there.",
        "```python\ndef main():\n    arm.spin_to_position(30, DEGREES)\n    print(arm.position(DEGREES))\n    arm.spin_to_position(90, DEGREES)\n    print(arm.position(DEGREES))\n\nstart(main)\n```",
      ],
      done: "You mapped the arm's reach: from the floor to 300 mm, about 60 mm in front of the robot.",
    },
    {
      id: "degrees-of-freedom",
      title: "Degrees of freedom",
      body: [
        "A **degree of freedom** (DOF) is one independent way something can move.",
        "- The arm has **one joint**, so it has **1 DOF**: it can only go up and down.",
        "- The claw opening and closing is the end effector working. It doesn't move the claw anywhere, so it isn't counted as a DOF of the arm.",
        "- The drivetrain lets the robot drive forward or back and turn, so the robot can carry the arm's work envelope around the field.",
        "Industrial arms often have **6 DOF** (like a shoulder, elbow and wrist) so they can reach a point from any direction. Answer the questions to continue.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "How many degrees of freedom does this robot's **arm** have?",
          choices: ["0", "1", "2", "6"],
          answer: 1,
          explain: "One joint that lifts and lowers: 1 DOF.",
        },
        {
          prompt: "Which part is the **end effector**?",
          choices: ["The wheels", "The claw", "The distance sensor", "The brain"],
          answer: 1,
          explain: "The end effector is the tool at the end of the arm. Here it's the claw.",
        },
        {
          prompt: "The claw can't reach a block 300 mm to the side of the robot. What's the simplest fix?",
          choices: ["Lift the arm higher", "Turn and drive the robot so the block is in front", "Open the claw wider", "Add another claw"],
          answer: 1,
          explain: "The drivetrain moves the whole work envelope. Turning and driving puts the block in reach.",
        },
      ],
      hints: [
        "Count the joints that move the claw to a new place.",
        "The end effector is whatever does the job at the end of the arm.",
      ],
      done: "1 DOF arm + a drivetrain that carries it: simple, but enough to sort and stack.",
    },
    {
      id: "pick-and-place",
      title: "Pick and place",
      world: { custom: SHELF_DROP },
      starter: { mode: "python", python: py("pick_up(-550, -300)", "place(-550, 380, 10)   # low shelf") },
      lockMode: "python",
      body: [
        "**Pick and place** is the most common job for a robot arm: grab something, move it, put it down somewhere exact.",
        "The starter gives you three helper functions: `go_to`, `pick_up` and `place`. Read `place`: it lifts the arm, drives to the spot, lowers until the block **lands**, then opens the claw.",
        "Run it. The block doesn't end up on the shelf! The low shelf is **100 mm** high, but at 10° the claw is only 300 × sin 10° ≈ 52 mm up. The block hits the side of the shelf and falls when the claw opens.",
        "Change the `lift` angle so the block clears the shelf, and put the blue block on the **low shelf**.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "claw.close", label: "Close the claw to grab" },
        { kind: "usesCall", name: "claw.open", label: "Open the claw to let go" },
        { kind: "usesCall", name: "place", label: "Use `place`" },
        { kind: "goalsComplete", label: "The blue block is on the low shelf" },
      ],
      quiz: [
        {
          prompt: "Which lift angle is the **smallest** that clears a 100 mm shelf? (sin 15° ≈ 0.26, sin 20° ≈ 0.34, sin 25° ≈ 0.42)",
          choices: ["10°", "15°", "20°", "45°"],
          answer: 2,
          explain: "300 × 0.34 ≈ 103 mm, just over 100 mm. A few degrees more gives you a safety margin.",
        },
      ],
      hints: [
        "Only the last number of `place(-550, 380, 10)` needs to change.",
        "You need 300 × sin(angle) > 100. Try 30°.",
        "```python\n    place(-550, 380, 30)   # low shelf\n```",
      ],
      done: "Lift, carry, lower, release. That's pick and place.",
    },
    {
      id: "stack-three",
      title: "Stack three",
      world: { custom: STACK_PAD },
      starter: { mode: "python", python: py("pick_up(-250, -300)", "place(0, 300, 20)   # on the anchor block") },
      lockMode: "python",
      body: [
        "Now build a **stack 3 blocks tall** on the orange pad. The heavy orange anchor block is already there (50 mm tall), so you need to add both red blocks.",
        "The starter puts the first red block on the anchor. Add code to stack the **second** red block (at x = 250, y = -300) on top.",
        "Think about the work envelope: the top of the stack is now **100 mm** high, so lift higher than last time before you drive in. When you lower, the arm stops by itself when the block lands on the stack.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "pick_up", min: 2, label: "Pick up both red blocks" },
        { kind: "usesCall", name: "place", min: 2, label: "Place both red blocks" },
        { kind: "goalsComplete", label: "A stack 3 blocks tall on the orange pad" },
      ],
      quiz: [
        {
          prompt: "Each block is 50 mm tall. How high is the top of a stack of **3**?",
          choices: ["50 mm", "100 mm", "150 mm", "300 mm"],
          answer: 2,
          explain: "3 × 50 = 150 mm. The third block lands on the 100 mm top of the second.",
        },
      ],
      hints: [
        "It's the same two lines again with new numbers: `pick_up(250, -300)` and `place(0, 300, ...)`.",
        "The stack is 100 mm tall before the second red block goes on. Lift above 20°: 30° is plenty.",
        "```python\n    pick_up(250, -300)\n    place(0, 300, 30)\n```",
      ],
      done: "Three tall! Every block you add raises the height the arm has to clear.",
    },
    {
      id: "stack-shop",
      title: "Run the Stack Shop",
      world: { playground: "stack-shop" },
      body: [
        "Put it all together in the full **Stack Shop**: the stack of 3 on the pad, the **blue** block on the **low shelf** (100 mm) and the **yellow** block on the **high shelf** (200 mm).",
        "Use the same helpers. Work out a safe lift for each place before you run it: 300 × sin(angle) must be higher than what's under the block.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "place", min: 4, label: "Place four blocks" },
        { kind: "goalsComplete", label: "Complete all three Stack Shop goals" },
      ],
      quiz: [
        {
          prompt: "Which lift angle clears the **200 mm** high shelf? (sin 30° = 0.5, sin 40° ≈ 0.64, sin 50° ≈ 0.77)",
          choices: ["30°", "40°", "50°"],
          answer: 2,
          explain: "300 × 0.77 ≈ 230 mm, above 200 mm. 40° only reaches about 193 mm.",
        },
      ],
      hints: [
        "Start from your stack-three program and add a pick_up/place pair for each shelf block.",
        "Blue is at (-550, -300) and goes to (-550, 380). Yellow is at (550, -300) and goes to (550, 380).",
        "```python\n    pick_up(-550, -300)\n    place(-550, 380, 30)\n    pick_up(550, -300)\n    place(550, 380, 50)\n```",
      ],
      done: "The shop is sorted and stacked. You planned every move inside the arm's work envelope.",
    },
  ],
};
