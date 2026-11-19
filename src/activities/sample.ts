/** A small sample activity used by tests (and as a fallback if the built-in content is missing). */
import type { Activity } from "../core/activity";

export const SAMPLE_ACTIVITY: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a00-sample",
  title: "Sample: first moves",
  summary: "Drive, turn and print — a tiny tour of the activity panel.",
  level: "starter",
  minutes: 10,
  standards: ["Sample Std 1"],
  steps: [
    {
      id: "drive",
      title: "Drive to square 21",
      body: "Each square is **200 mm**. Drive up two squares with:\n\n```python\ndrivetrain.drive_for(FORWARD, 400, MM)\n```\n\n- Press **Run** when ready.",
      world: { playground: "number-grid" },
      starter: { mode: "python", python: "def main():\n    # Drive up two squares\n    pass\n\nstart(main)\n" },
      lockMode: "python",
      checks: [
        { kind: "usesCall", name: "drivetrain.drive_for", label: "Use `drivetrain.drive_for`" },
        { kind: "ranWithoutError", label: "Run without errors" },
        { kind: "endsInSquare", square: 21, label: "Finish in square 21" },
      ],
      hints: ["Two squares is 2 × 200 mm.", "Try `drivetrain.drive_for(FORWARD, 400, MM)` inside `main()`."],
      done: "Nice driving!",
    },
    {
      id: "quiz",
      title: "Quick question",
      body: "Which word starts a function definition?",
      checks: [],
      quiz: [
        { prompt: "Which keyword defines a function?", code: "def main():\n    pass", choices: ["start", "def", "main"], answer: 1, explain: "`def` starts a function definition." },
      ],
      hints: ["Look at the first word of the first line."],
    },
    {
      id: "print",
      title: "Say hello",
      body: "Use `print` to say hello.",
      checks: [
        { kind: "printsOutput", label: "Use `print`" },
        { kind: "logContains", text: "hello", label: "Print hello" },
      ],
      hints: ["`print(\"hello\")`"],
    },
  ],
};
