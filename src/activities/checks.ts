/**
 * Pure step checking: code checks run on a token scan of the student's Python (comments and string
 * literals never count), run checks look at the most recent run, quiz items at the chosen answers.
 */
import type { ActivityStep, CodeCheck, RunCheck, StepCheckResult } from "../core/activity";
import type { RunResult } from "../core/modules";
import { scanPython, calls, assignedNames, withScope, lead, type Scan, type Stmt } from "./pyscan";

export interface LastRun {
  result: RunResult;
  goalsAllPassed: boolean;
  finalSquare: number | null;
  output: string[];
}

export interface CheckContext {
  python: string;
  lastRun: LastRun | null;
  quizAnswers: number[];
  /** Optional: the step's starter code. Comments already in it don't count for hasComment. */
  starterPython?: string;
}

type AnyCheck = CodeCheck | RunCheck;

export const RUN_CHECK_KINDS = ["goalsComplete", "ranWithoutError", "endsInSquare", "logContains"] as const;
export const CODE_CHECK_KINDS = [
  "usesCall", "usesLoop", "usesIf", "definesFunction", "assignsVariable", "definesConstant",
  "hasComment", "readsSensor", "printsOutput", "maxLines",
] as const;

export function isRunCheck(c: AnyCheck): c is RunCheck {
  return (RUN_CHECK_KINDS as readonly string[]).includes(c.kind);
}

const SENSORS = new Set(["distance", "front_eye", "down_eye", "bumper", "location"]);
const CONSTANT = /^_*[A-Z][A-Z0-9_]*$/;
const NEED_RUN = "Press Run to check this.";

/** A sensible label for a check (used by the authoring form when the teacher leaves it blank). */
export function defaultLabel(c: AnyCheck): string {
  switch (c.kind) {
    case "usesCall": return `Use \`${c.name}\`${(c.min ?? 1) > 1 ? ` at least ${c.min} times` : ""}`;
    case "usesLoop": return c.loop === "for" ? "Use a `for` loop" : c.loop === "while" ? "Use a `while` loop" : "Use a loop";
    case "usesIf": return c.withElse ? "Use `if` … `else`" : "Use an `if`";
    case "definesFunction": return "Define your own function with `def`";
    case "assignsVariable": return c.name ? `Store a value in \`${c.name}\`` : "Store a value in a variable";
    case "definesConstant": return "Define a CONSTANT (an UPPER_CASE name at the top of the program)";
    case "hasComment": return (c.min ?? 1) > 1 ? `Write at least ${c.min} comments` : "Write a comment";
    case "readsSensor": return "Read a sensor";
    case "printsOutput": return "Print something";
    case "maxLines": return `Use ${c.lines} lines of code or fewer`;
    case "goalsComplete": return "Complete all the challenge goals";
    case "ranWithoutError": return "Run your program without errors";
    case "endsInSquare": return `Finish in square ${c.square}`;
    case "logContains": return `Print \`${c.text}\``;
  }
}

const normText = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function codeCheck(c: CodeCheck, scan: Scan, ctx: CheckContext): { passed: boolean; detail?: string } {
  switch (c.kind) {
    case "usesCall": {
      const want = String(c.name).trim();
      const min = Math.max(1, Math.floor(c.min ?? 1));
      const n = calls(scan).filter((x) => x === want).length;
      return { passed: n >= min, detail: min > 1 ? `Found ${n} of ${min}.` : n ? undefined : "Not used yet." };
    }
    case "usesLoop": {
      const which = c.loop ?? "any";
      const ok = scan.stmts.some((s) => { const k = lead(s); return which === "any" ? k === "for" || k === "while" : k === which; });
      return { passed: ok, detail: ok ? undefined : "No loop yet." };
    }
    case "usesIf": {
      const hasIf = scan.stmts.some((s) => lead(s) === "if");
      if (!c.withElse) return { passed: hasIf, detail: hasIf ? undefined : "No if yet." };
      const ok = hasIfElse(scan.stmts);
      return { passed: ok, detail: ok ? undefined : hasIf ? "Add an else to your if." : "No if yet." };
    }
    case "definesFunction": {
      const besides = new Set(Array.isArray(c.besides) ? c.besides : ["main"]);
      const defs = defNames(scan.stmts);
      const ok = defs.some((d) => !besides.has(d));
      return { passed: ok, detail: ok ? undefined : "No function of your own yet." };
    }
    case "assignsVariable": {
      const names = scan.stmts.flatMap(assignedNames);
      const ok = c.name ? names.includes(c.name) : names.length > 0;
      return { passed: ok, detail: ok ? undefined : c.name ? `\`${c.name}\` isn't set yet.` : "No variable yet." };
    }
    case "definesConstant": {
      const ok = withScope(scan).some(({ stmt, moduleLevel }) => moduleLevel && assignedNames(stmt).some((n) => CONSTANT.test(n)));
      return { passed: ok, detail: ok ? undefined : "No UPPER_CASE name set outside your functions yet." };
    }
    case "hasComment": {
      const min = Math.max(1, Math.floor(c.min ?? 1));
      const starter = new Set(ctx.starterPython ? scanPython(ctx.starterPython).comments.map((t) => normText(t.text)) : []);
      const n = scan.comments.filter((t) => normText(t.text.replace(/^#+/, "")) !== "" && !starter.has(normText(t.text))).length;
      return { passed: n >= min, detail: min > 1 ? `Found ${n} of ${min}.` : n ? undefined : "No comment of your own yet." };
    }
    case "readsSensor": {
      const ok = calls(scan).some((x) => { const p = x.split("."); return p.length >= 2 && SENSORS.has(p[0]); });
      return { passed: ok, detail: ok ? undefined : "No sensor read yet." };
    }
    case "printsOutput": {
      const ok = calls(scan).some((x) => x === "print" || x === "brain.screen.print");
      return { passed: ok, detail: ok ? undefined : "Nothing printed yet." };
    }
    case "maxLines": {
      const n = scan.codeLines.size;
      const max = Math.max(1, Math.floor(c.lines));
      return { passed: n > 0 && n <= max, detail: `${n} line${n === 1 ? "" : "s"} of code (aim for ${max} or fewer).` };
    }
  }
}

function runCheck(c: RunCheck, last: CheckContext["lastRun"]): { passed: boolean; detail?: string } {
  if (!last) return { passed: false, detail: NEED_RUN };
  const r = last.result;
  switch (c.kind) {
    case "goalsComplete":
      return { passed: last.goalsAllPassed, detail: last.goalsAllPassed ? undefined : "Not every goal is done yet — see the Challenge tab." };
    case "ranWithoutError": {
      if (r.status === "error") return { passed: false, detail: "Your last run had an error." };
      if (r.status === "stopped") return { passed: false, detail: "Your last run was stopped before it finished." };
      if (!r.startCalled) return { passed: false, detail: "start(main) never ran." };
      return { passed: true };
    }
    case "endsInSquare": {
      if (last.finalSquare === null) return { passed: false, detail: "This check only works on the number grid." };
      const ok = last.finalSquare === c.square;
      return { passed: ok, detail: ok ? undefined : `The robot ended in square ${last.finalSquare}.` };
    }
    case "logContains": {
      const want = normText(String(c.text));
      const ok = want === "" ? last.output.length > 0 : normText(last.output.join("\n")).includes(want);
      return { passed: ok, detail: ok ? undefined : last.output.length ? "That text wasn't printed in your last run." : "Your last run didn't print anything." };
    }
  }
}

function defNames(stmts: Stmt[]): string[] {
  const out: string[] = [];
  for (const s of stmts) {
    if (lead(s) !== "def") continue;
    const i = s.toks.findIndex((t) => t.kind === "name" && t.text === "def");
    const n = s.toks[i + 1];
    if (n && n.kind === "name") out.push(n.text);
  }
  return out;
}

/** True when some `else:` belongs to an if/elif chain (not to a for/while/try). */
function hasIfElse(stmts: Stmt[]): boolean {
  for (let k = 0; k < stmts.length; k++) {
    if (lead(stmts[k]) !== "else") continue;
    const ind = stmts[k].indent;
    for (let j = k - 1; j >= 0; j--) {
      if (stmts[j].indent > ind) continue;
      if (stmts[j].indent < ind) break;
      const l = lead(stmts[j]);
      if (l === "if" || l === "elif") return true;
      break;
    }
  }
  return false;
}

/** Check one step. Never throws. */
export function checkStep(step: ActivityStep, ctx: CheckContext): StepCheckResult {
  const items: StepCheckResult["items"] = [];
  let scan: Scan | null = null;
  for (const c of step.checks ?? []) {
    let res: { passed: boolean; detail?: string };
    try {
      if (isRunCheck(c)) res = runCheck(c, ctx.lastRun);
      else res = codeCheck(c, (scan ??= scanPython(ctx.python ?? "")), ctx);
    } catch {
      res = { passed: false, detail: "This check couldn't be worked out." };
    }
    items.push({ label: c.label || defaultLabel(c), passed: res.passed, ...(res.detail ? { detail: res.detail } : {}) });
  }
  (step.quiz ?? []).forEach((q, i) => {
    const a = ctx.quizAnswers?.[i];
    const answered = typeof a === "number" && a >= 0;
    const passed = answered && a === q.answer;
    const n = (step.quiz ?? []).length;
    items.push({
      label: n > 1 ? `Answer question ${i + 1} correctly` : "Answer the question correctly",
      passed,
      ...(passed ? {} : { detail: answered ? "Not quite — try another answer." : "Not answered yet." }),
    });
  });
  return { passed: items.every((x) => x.passed), items };
}
