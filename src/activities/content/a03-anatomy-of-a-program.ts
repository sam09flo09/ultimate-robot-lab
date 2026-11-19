import type { Activity } from "../../core/activity";
import { ORIGINAL_TEMPLATE } from "../../worlds";

const SAMPLE = [
  "SPEED = 50",
  "",
  "def main():",
  "    drivetrain.set_drive_velocity(SPEED, PERCENT)",
  "    total = 200 * 4",
  "    drivetrain.drive_for(FORWARD, total, MM)",
  "    print(\"Done!\")",
  "",
  "start(main)",
].join("\n");

export const a03AnatomyOfAProgram: Activity = {
  format: "robot-lab-activity",
  version: 1,
  id: "a03-anatomy-of-a-program",
  title: "Anatomy of a program",
  summary: "Name the parts of real robot code: keywords, identifiers, operators, literals, statements, expressions, functions and methods.",
  level: "core",
  minutes: 30,
  standards: ["TEKS (d)(5)(A)", "YouScience Std 5 Obj 2.1", "YouScience Std 5 Obj 2.3", "YouScience Std 5 Obj 2.4"],
  steps: [
    {
      id: "keywords-identifiers",
      title: "Keywords and identifiers",
      world: { playground: "number-grid" },
      body: [
        "Programs are built from small pieces, like sentences are built from words. Here's a short robot program:",
        "```python\n" + SAMPLE + "\n```",
        "- A **keyword** is a word that belongs to Python itself and has a fixed meaning. Examples: `def`, `for`, `while`, `if`, `else`, `return`, `True`, `False`. You can't use a keyword as a name.",
        "- An **identifier** is a name that a programmer chose for something: `main`, `total`, `SPEED`, `drivetrain`.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "In the program above, which word is a **keyword**?",
          choices: ["`main`", "`def`", "`total`", "`drivetrain`"],
          answer: 1,
          explain: "`def` is part of Python: it means \"define a function\". The others are names (identifiers).",
        },
        {
          prompt: "Which one is an **identifier** that the programmer made up in this program?",
          choices: ["`total`", "`def`", "`=`", "`200`"],
          answer: 0,
          explain: "`total` is a name the programmer chose for a variable. `def` is a keyword, `=` is an operator and `200` is a literal.",
        },
        {
          prompt: "Could you name a variable `for`?",
          choices: ["Yes, any word works", "No, `for` is a keyword so Python won't allow it", "Only inside `main`", "Only in capital letters"],
          answer: 1,
          explain: "Keywords are reserved. `for = 3` is a syntax error. (`FOR` would work, because Python cares about capitals, but it would be confusing.)",
        },
      ],
      hints: [
        "Keywords are Python's own words. Identifiers are names somebody picked.",
        "`def` starts every function definition in every Python program in the world.",
      ],
      done: "Keywords belong to Python. Identifiers belong to you.",
    },
    {
      id: "operators-literals",
      title: "Operators, operands and literals",
      body: [
        "Look at this line:",
        "```python\ntotal = 200 * 4\n```",
        "- An **operator** is a symbol that does something: `*` multiplies, `+` adds, `-` subtracts, `/` divides, `=` stores a value, `==` compares, `<` and `>` compare sizes.",
        "- The **operands** are the values an operator works on. For `200 * 4`, the operands are `200` and `4`.",
        "- A **literal** is a value written directly in the code: numbers like `200`, text in quotes like `\"Done!\"`, and `True` or `False`.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "In `total = 200 * 4`, what are the **operands** of `*`?",
          choices: ["`total` and `200`", "`200` and `4`", "`=` and `*`", "Only `4`"],
          answer: 1,
          explain: "`*` multiplies the two values next to it: `200` and `4`.",
        },
        {
          prompt: "Which of these is a **literal**?",
          code: "print(\"Done!\")",
          choices: ["`print`", "`(`", "`\"Done!\"`", "`)`"],
          answer: 2,
          explain: "`\"Done!\"` is a string literal: the exact text is written right there in the code.",
        },
        {
          prompt: "What is the difference between `=` and `==`?",
          choices: [
            "No difference",
            "`=` stores a value in a variable; `==` asks whether two values are equal",
            "`==` stores a value; `=` compares",
            "`==` is only for numbers",
          ],
          answer: 1,
          explain: "`x = 5` puts 5 into x. `x == 5` is a question that is True or False.",
        },
      ],
      hints: [
        "Operands are the things on each side of the operator.",
        "A literal is a value you can read straight off the page: a number or quoted text.",
      ],
      done: "Operators do the work; operands are what they work on; literals are fixed values.",
    },
    {
      id: "statements-expressions",
      title: "Statements and expressions",
      body: [
        "- An **expression** is any piece of code that **produces a value**. `200 * 4` is an expression (its value is 800). `distance.get_distance(MM)` is an expression (its value is a number from the sensor). `SPEED` alone is an expression too.",
        "- A **statement** is a complete instruction: one line that **does something**. `total = 200 * 4` is a statement. `drivetrain.drive_for(FORWARD, total, MM)` is a statement.",
        "Statements often **contain** expressions. In `total = 200 * 4`, the whole line is a statement, and `200 * 4` is the expression inside it.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "Which of these is an **expression** (it gives a value) and not a whole statement?",
          choices: ["`total = 200 * 4`", "`200 * 4`", "`def main():`", "`start(main)`"],
          answer: 1,
          explain: "`200 * 4` produces a value: 800. The other choices are complete instructions.",
        },
        {
          prompt: "How many **statements** are inside `main` here?",
          code: "def main():\n    total = 200 * 4\n    drivetrain.drive_for(FORWARD, total, MM)\n    print(\"Done!\")",
          choices: ["1", "2", "3", "4"],
          answer: 2,
          explain: "Three instructions: store the total, drive, print.",
        },
        {
          prompt: "`distance.get_distance(MM) > 300` is…",
          choices: ["a statement", "an expression whose value is True or False", "a keyword", "a literal"],
          answer: 1,
          explain: "Comparing gives a value, True or False. That makes it an expression. You'd use it inside a statement like `if` or `while`.",
        },
      ],
      hints: [
        "Ask: does it give back a value (expression), or is it a whole instruction (statement)?",
        "Count the lines indented under `def main():`.",
      ],
      done: "Statements do; expressions give values.",
    },
    {
      id: "functions-methods",
      title: "Functions, methods and procedures",
      body: [
        "- A **function** is a named group of statements you can run (call) by its name: `print(\"Hi\")`, `start(main)`, and `main` itself.",
        "- A **method** is a function that belongs to an **object**. You call it with a dot: `object.method()`. In `drivetrain.drive_for(FORWARD, 200, MM)`, `drivetrain` is the object and `drive_for` is its method. `distance.get_distance(MM)` is the `get_distance` method of the `distance` sensor object.",
        "- A **procedure** is a function that does a job but doesn't give a value back, like `main` or `drive_for`. A function that gives a value back, like `get_distance`, **returns** a value.",
        "The values inside the brackets are called **arguments**. `FORWARD`, `200` and `MM` are the arguments to `drive_for`.",
      ].join("\n\n"),
      checks: [],
      quiz: [
        {
          prompt: "In `drivetrain.drive_for(FORWARD, 200, MM)`, what is `drive_for`?",
          choices: ["A keyword", "A method of the `drivetrain` object", "A literal", "A variable"],
          answer: 1,
          explain: "It comes after the dot, so it's a method that belongs to `drivetrain`.",
        },
        {
          prompt: "Which call is a plain **function**, not a method?",
          choices: ["`print(\"Hi\")`", "`bumper.pressed()`", "`pen.move(DOWN)`", "`brain.screen.print(\"Hi\")`"],
          answer: 0,
          explain: "`print` doesn't belong to an object (no dot). The others are methods of `bumper`, `pen` and `brain.screen`.",
        },
        {
          prompt: "Which one **returns a value** you could store in a variable?",
          choices: ["`drivetrain.turn_for(RIGHT, 90, DEGREES)`", "`pen.move(UP)`", "`distance.get_distance(MM)`", "`start(main)`"],
          answer: 2,
          explain: "`get_distance` gives back a number. The others just do a job (they're procedures).",
        },
      ],
      hints: [
        "A dot means \"belongs to\": `object.method`.",
        "Sensors answer questions; motors do jobs.",
      ],
      done: "You can name every part of a robot program. That's exactly what the certification exam asks!",
    },
    {
      id: "put-together",
      title: "Put it together",
      starter: { mode: "python", python: ORIGINAL_TEMPLATE },
      body: [
        "Write a program that uses an **expression** to work out a distance, prints it, and then drives that far.",
        "```python\ndef main():\n    total = 200 * 4\n    print(\"Driving\", total, \"mm\")\n    drivetrain.drive_for(FORWARD, total, MM)\n\nstart(main)\n```",
        "Type it in (don't paste!), then run it. Check the log: it should say `Driving 800 mm`, and the robot should finish in **square 41**.",
        "While you type, name the parts in your head: keyword, identifier, operator, literal, method.",
      ].join("\n\n"),
      checks: [
        { kind: "assignsVariable", label: "Store a value in a variable" },
        { kind: "printsOutput", label: "Use `print`" },
        { kind: "logContains", text: "800", label: "Print the distance (800)" },
        { kind: "endsInSquare", square: 41, label: "Finish in square 41" },
      ],
      hints: [
        "Remember the 4-space indent for every line inside `main`.",
        "`print(\"Driving\", total, \"mm\")` prints the text, then the value of `total`.",
        "Check the spelling of `drivetrain.drive_for(FORWARD, total, MM)`: no quotes around `total`, because it's a variable, not text.",
      ],
      done: "You used an operator, two literals and a variable to make the robot drive. That's real programming.",
    },
  ],
};
