import type { Activity } from "../../core/activity";

export const a01MeetYourRobot: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a01-meet-your-robot",
  title: "Meet your robot",
  summary: "Snap blocks together to drive and turn on the number grid. Find out where every program starts.",
  level: "starter",
  minutes: 25,
  standards: ["TEKS (d)(5)(A)", "TEKS (d)(9)(C)", "YouScience Std 5 Obj 2.2", "YouScience Std 5 Obj 1.5"],
  steps: [
    {
      id: "entry-point",
      title: "Where does a program start?",
      world: { playground: "number-grid" },
      starter: { mode: "blocks" },
      body: [
        "Welcome to Robot Lab! On the right is the **number grid**: 100 squares, each 200 mm wide. Square 1 is in the bottom-left corner. Your robot starts there, facing up toward square 11.",
        "Look at the blocks area. There is already a block that says **when started**. This is the **entry point** of your program: the place where the computer begins running your code.",
        "Every program needs exactly one entry point. In Arduino it was `setup()`. Here it is the **when started** block. Blocks that are not attached under it never run.",
        "Answer the questions below to finish this step.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "What is the **entry point** of a program?",
          choices: [
            "The last line of the program",
            "The place where the computer starts running the program",
            "Any block that makes the robot move",
            "The button you press to save",
          ],
          answer: 1,
          explain: "The entry point is where running begins. In Robot Lab blocks, that is the **when started** block.",
        },
        {
          prompt: "You drag a **drive** block onto the workspace but leave it floating by itself, not attached to **when started**. What happens when you press Run?",
          choices: [
            "The robot drives anyway",
            "The robot drives twice",
            "Nothing: the block is not connected to the entry point, so it never runs",
            "The program crashes",
          ],
          answer: 2,
          explain: "Only blocks connected under the entry point run. A loose block is ignored.",
        },
      ],
      hints: [
        "The entry point is where the computer **begins**.",
        "Blocks only run if they are snapped under **when started**.",
      ],
      done: "Nice! Every program you write today starts at an entry point.",
    },
    {
      id: "drive-to-41",
      title: "Drive to square 41",
      body: [
        "Time to move. Each square is **200 mm**. Square 41 is 4 squares straight up from square 1.",
        "- Open the **Drivetrain** category.",
        "- Drag a **drive forward for 200 mm** block and snap it under **when started**.",
        "- Change the number so the robot ends in square 41.",
        "- Press **Run**.",
        "If you miss, press **Reset** and try a different number. Guessing, checking and fixing is how programmers work!",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "drivetrain.drive_for", label: "Use a **drive for** block" },
        { kind: "endsInSquare", square: 41, label: "Finish in square 41" },
      ],
      hints: [
        "How many squares is it from 1 up to 41? Count 11, 21, 31, 41.",
        "That is 4 squares. Each square is 200 mm. What is 4 × 200?",
        "Use **drive forward for 800 mm**.",
      ],
      done: "800 mm = 4 squares. You just turned a measurement into a program!",
    },
    {
      id: "turn-to-45",
      title: "Turn the corner to square 45",
      body: [
        "Now make the robot go **up to 41, then turn right and drive to 45**.",
        "- Keep your drive block.",
        "- Add a **turn right for 90 degrees** block under it.",
        "- Add another **drive forward** block. How far is it from 41 to 45?",
        "Blocks run **in order, from top to bottom**. That order is called a **sequence**.",
      ].join("\n\n"),
      checks: [
        { kind: "usesCall", name: "drivetrain.turn_for", label: "Use a **turn for** block" },
        { kind: "endsInSquare", square: 45, label: "Finish in square 45" },
      ],
      hints: [
        "After turning right, the robot faces toward bigger numbers in the same row: 42, 43, 44, 45.",
        "From 41 to 45 is 4 squares, so 800 mm again.",
        "Your blocks: drive forward 800 mm, turn right 90 degrees, drive forward 800 mm.",
      ],
      done: "You built a sequence: drive, turn, drive. The order of the blocks matters!",
    },
    {
      id: "corner-100",
      title: "Challenge: the far corner",
      body: [
        "Square **100** is in the top-right corner. Get the robot there.",
        "Plan first: how many squares up? How many squares right? Then build it and test it.",
        "Bonus: open the **Pen** category, put **move pen down** at the start, and watch the robot draw its route.",
      ].join("\n\n"),
      checks: [{ kind: "endsInSquare", square: 100, label: "Finish in square 100" }],
      hints: [
        "From square 1 to square 91 is 9 squares up. From 91 to 100 is 9 squares right.",
        "9 squares × 200 mm = 1800 mm.",
        "Drive forward 1800 mm, turn right 90 degrees, drive forward 1800 mm.",
      ],
      done: "Corner reached! Next time you'll see the same program written in Python.",
    },
  ],
};
