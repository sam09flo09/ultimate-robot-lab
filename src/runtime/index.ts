/**
 * Python runtime: runs student programs with Skulpt (global `Sk`, loaded from public/vendor)
 * against a RobotController. Implements docs/API.md.
 *
 * Approach (from docs/reference/original-app-script.js):
 *  - API objects are Skulpt classes whose methods check their arguments and explain mistakes.
 *  - Motion calls return Sk.misceval.promiseToSuspension(controllerPromise) so Python "waits".
 *  - Line tracking uses debugging breakpoints (called before every statement).
 *  - killableWhile/killableFor + debugging breakpoints: the breakpoint callback asks Skulpt to suspend
 *    every ~15 ms of busy Python, and our suspension handler resumes with setTimeout(0), so the browser
 *    (and the app's rAF loop that steps the sim) keeps running during `while True:` loops.
 *  - Stop: the run is marked stopped and its Skulpt continuation is simply never resumed
 *    (pending controller promises and yields are swallowed). Student try/except can't catch it.
 */
import type { RobotController, ColorName, DriveDir, TurnDir } from "../core/types";
import type { RunnerOptions, PythonRunner, RunResult, FriendlyError } from "../core/modules";
import { CONSTANTS, COLOR_CONSTS } from "./names";
import { friendly, precheck, MISSING_START_TEXT, type ErrorInfo } from "./friendly";

export { friendly, precheck, closestName, editDistance, esc } from "./friendly";

/** How often (ms of busy Python) Skulpt hands control back to the browser. */
const YIELD_MS = 15;
/** Max log entries per run before further entries are dropped (keeps a `while True: print()` from eating memory). */
const LOG_CAP = 2000;
/** Max onLine callbacks between two yields; more line changes are coalesced (tight loops). */
const LINE_EMITS_PER_SLICE = 40;
const MAIN_FILE = "<stdin>.py";

const NEVER: Promise<never> = new Promise<never>(() => { /* never settles */ });

/** Modules students may import. Anything else gives a friendly ImportError. */
function readFile(path: string): string {
  const files = Sk.builtinFiles && Sk.builtinFiles.files;
  if (files && files[path] !== undefined) return files[path];
  throw "File not found: '" + path + "'";
}

interface Spec {
  label: string;          // "drive_for" or "pen.move" (as shown in messages)
  params: string[];       // positional parameter names
  required: number;       // how many are required
  example: string;
  kw?: string[];          // allowed keyword names
  varargs?: boolean;      // any number of positional values (brain.screen.print)
}

function plural(n: number, word: string) { return n + " " + word + (n === 1 ? "" : "s"); }

function countMessage(s: Spec, n: number): string {
  const max = s.params.length;
  if (max === 0) return s.label + "() doesn't take any values inside the (). Example: " + s.example + ". You gave " + n + ".";
  const list = s.params.join(", ");
  const opt = s.kw && s.kw.includes("wait") ? " (you can also add wait=False)" : "";
  if (s.required === max) return s.label + " needs " + plural(max, "value") + ": " + list + opt + ". Example: " + s.example + ". You gave " + n + ".";
  if (s.required === 0) return s.label + " can have up to " + plural(max, "value") + ": " + list + ". Example: " + s.example + ". You gave " + n + ".";
  return s.label + " needs " + s.required + " to " + max + " values: " + list + opt + ". Example: " + s.example + ". You gave " + n + ".";
}

interface Ctx {
  stopped: boolean;
  settled: boolean;
  curLine: number;
  steps: number;
  startCalled: boolean;
  logCount: number;
  logCapped: boolean;
  lastStepText: string | null;
  outBuf: string;
  emitted: number;        // last line sent to onLine
  pendingLine: number;    // line not yet sent because of coalescing
  sliceEmits: number;
  lastYield: number;      // Date.now() when Python last gave the browser a turn
  finish: (r: RunResult) => void;
}

export function createPythonRunner(opts: RunnerOptions): PythonRunner {
  const ctl: RobotController = opts.controller;
  let current: Ctx | null = null;

  function run(source: string): Promise<RunResult> {
    if (current) stopCtx(current);
    return new Promise<RunResult>((resolve) => {
      const ctx: Ctx = {
        stopped: false, settled: false, curLine: 0, steps: 0, startCalled: false,
        logCount: 0, logCapped: false, lastStepText: null, outBuf: "",
        emitted: 0, pendingLine: 0, sliceEmits: 0, lastYield: Date.now(),
        finish: (r) => {
          if (ctx.settled) return;
          ctx.settled = true;
          if (current === ctx) current = null;
          resolve(r);
        },
      };
      current = ctx;
      if (typeof Sk === "undefined") {
        ctx.finish({ status: "error", error: { line: 0, type: "Error", raw: "Skulpt not loaded", html: "<b>Error</b><br>The Python engine did not load. Reload the page." } });
        return;
      }
      const pre = precheck(source);
      if (pre) { ctx.finish({ status: "error", error: pre }); return; }
      try {
        execute(ctx, source);
      } catch (e) {
        ctx.finish({ status: "error", error: toFriendly(ctx, e, source) });
      }
    });
  }

  function stopCtx(ctx: Ctx) {
    if (ctx.stopped) return;
    ctx.stopped = true;
    try { ctl.stop(); } catch { /* ignore */ }
    flushOutput(ctx);
    ctx.finish({ status: "stopped" });
  }

  // ---------------------------------------------------------------- logging + lines

  function log(ctx: Ctx, text: string, kind: "step" | "print" | "warn") {
    if (ctx.stopped) return;
    if (ctx.logCount >= LOG_CAP) {
      if (!ctx.logCapped) {
        ctx.logCapped = true;
        opts.onLog({ line: ctx.curLine, text: "The log is full, so later messages are hidden. (Your program is still running.)", kind: "warn" });
      }
      return;
    }
    ctx.logCount++;
    opts.onLog({ line: ctx.curLine, text, kind });
  }

  /** Send a coalesced line now. `newSlice` = time is about to pass (yield / await), so reset the budget. */
  function flushLine(ctx: Ctx, newSlice = false) {
    if (newSlice) ctx.sliceEmits = 0;
    if (ctx.pendingLine && ctx.pendingLine !== ctx.emitted) {
      ctx.emitted = ctx.pendingLine;
      opts.onLine(ctx.pendingLine);
    }
    ctx.pendingLine = 0;
  }

  function onBreakpoint(ctx: Ctx, filename: string, lineno: number) {
    if (ctx.stopped || filename !== MAIN_FILE) return;
    ctx.curLine = lineno;
    if (lineno === ctx.emitted) { ctx.pendingLine = 0; return; }
    if (ctx.sliceEmits < LINE_EMITS_PER_SLICE) {
      ctx.sliceEmits++;
      ctx.emitted = lineno;
      ctx.pendingLine = 0;
      opts.onLine(lineno);
    } else {
      ctx.pendingLine = lineno;
    }
  }

  function onOutput(ctx: Ctx, text: string) {
    if (ctx.stopped) return;
    ctx.outBuf += text;
    let i: number;
    while ((i = ctx.outBuf.indexOf("\n")) >= 0) {
      const lineText = ctx.outBuf.slice(0, i);
      ctx.outBuf = ctx.outBuf.slice(i + 1);
      log(ctx, lineText, "print");
    }
  }
  function flushOutput(ctx: Ctx) {
    if (ctx.outBuf !== "") { const t = ctx.outBuf; ctx.outBuf = ""; if (!ctx.stopped) log(ctx, t, "print"); }
  }

  // ---------------------------------------------------------------- errors

  function errLine(e: any, ctx: Ctx): number {
    try {
      if (e && e.traceback && e.traceback.length) {
        for (const t of e.traceback) if (t && t.lineno && (!t.filename || t.filename === MAIN_FILE)) return t.lineno;
        for (const t of e.traceback) if (t && t.lineno) return t.lineno;
      }
      if (e && e.args && e.args.v && e.args.v.length > 2) {
        const l = Sk.ffi.remapToJs(e.args.v[2]);
        if (typeof l === "number") return l;
      }
    } catch { /* ignore */ }
    return ctx.curLine || 0;
  }
  function errText(e: any): string {
    try {
      if (e && e.args && e.args.v && e.args.v.length) return String(Sk.ffi.remapToJs(e.args.v[0]));
    } catch { /* ignore */ }
    if (e instanceof Error) return e.message;
    return String(e);
  }
  function toFriendly(ctx: Ctx, e: any, source: string): FriendlyError {
    let type = (e && e.tp$name) ? String(e.tp$name) : (e instanceof Error ? (e.name === "RangeError" ? "RecursionError" : "Error") : "Error");
    let raw = errText(e);
    if (type === "ExternalError" && /call stack/i.test(raw)) type = "RecursionError";
    if (/suspend/i.test(raw) && /cannot|can't|unhandled/i.test(raw)) {
      raw = "A robot command that takes time (like drive_for or wait) was used in a place where Python can't wait, " +
        "for example inside a list comprehension, a lambda, or sorted(key=...). Move it into a normal line inside main().";
      return friendly({ type: "RuntimeError", raw, line: errLine(e, ctx), ours: true }, source);
    }
    const info: ErrorInfo = { type, raw, line: errLine(e, ctx), ours: !!(e && e.$robotLab) };
    return friendly(info, source);
  }

  // ---------------------------------------------------------------- Python value helpers

  const none = () => Sk.builtin.none.none$;
  const pyBool = (b: boolean) => (b ? Sk.builtin.bool.true$ : Sk.builtin.bool.false$);
  const pyFloat = (x: number) => new Sk.builtin.float_(x);
  const pyInt = (x: number) => new Sk.builtin.int_(Math.round(x));
  const pyStr = (s: string) => new Sk.builtin.str(s);
  const round = (x: number, d: number) => { const f = Math.pow(10, d); return Math.round(x * f) / f; };

  function oops(type: string, msg: string): never {
    const e = new Sk.builtin[type](msg);
    e.$robotLab = true;
    throw e;
  }
  function isNum(v: any): boolean {
    if (v === undefined || v === null) return false;
    if (v instanceof Sk.builtin.bool) return false;
    return v instanceof Sk.builtin.int_ || v instanceof Sk.builtin.float_ || (Sk.builtin.lng && v instanceof Sk.builtin.lng);
  }
  function num(v: any): number { return Number(Sk.ffi.remapToJs(v)); }
  function constOf(v: any): string | null { return v instanceof Sk.builtin.str ? (v as any).v : null; }
  function argName(v: any): string {
    if (v === undefined) return "nothing";
    try { return String(Sk.misceval.objectRepr(v).toString()); } catch { return "?"; }
  }
  /** How an argument is shown in the step log: constants bare (FORWARD), everything else as Python repr. */
  function argText(v: any): string {
    const c = constOf(v);
    if (c !== null && CONSTANTS.includes(c)) return c;
    return argName(v);
  }
  /** Extra hint when a student passes "forward" or 'MM' as a quoted string. */
  function constHint(v: any): string {
    const c = constOf(v);
    if (c === null) return "";
    const up = c.toUpperCase();
    if (CONSTANTS.includes(up)) return " Write " + up + " in capitals with no quotes.";
    return "";
  }
  function needNumber(s: Spec, what: string, v: any, example: string): number {
    if (!isNum(v)) oops("TypeError", s.label + " " + what + " must be a number, like " + example + ". You gave " + argName(v) + ".");
    const x = num(v);
    if (!isFinite(x)) oops("ValueError", s.label + " " + what + " must be a normal number. You gave " + argName(v) + ".");
    return x;
  }
  function needUnit(s: Spec, v: any, allowed: string[], fallback?: string): string {
    if (v === undefined && fallback) return fallback;
    const u = constOf(v);
    if (u === null || !allowed.includes(u)) {
      oops("ValueError", s.label + " units must be " + allowed.join(" or ") + ", not " + argName(v) + "." + constHint(v));
    }
    return u as string;
  }
  function needColor(s: Spec, v: any, allowNone = true): ColorName {
    const c = constOf(v);
    const ok = COLOR_CONSTS.filter((x) => allowNone || x !== "NONE") as readonly string[];
    if (c === null || !ok.includes(c)) {
      oops("ValueError", s.label + " needs a colour: " + ok.join(", ") + ". You gave " + argName(v) + "." + constHint(v));
    }
    return c as ColorName;
  }
  function needWait(s: Spec, v: any): boolean {
    if (v === undefined) return true;
    if (v instanceof Sk.builtin.bool) return v === Sk.builtin.bool.true$;
    oops("TypeError", s.label + " wait must be True or False, like wait=False. You gave " + argName(v) + ".");
  }

  // ---------------------------------------------------------------- building the API

  function execute(ctx: Ctx, source: string) {
    const isStopErr = (e: any) => e instanceof Error && e.message === "STOPPED";
    const halt = () => Sk.misceval.promiseToSuspension(NEVER);

    /** Await a controller promise without letting a stopped run resume. STOPPED -> stopped result. */
    function guard<T>(p: Promise<T>): Promise<T> {
      return new Promise<T>((res, rej) => {
        p.then(
          (v) => { if (!ctx.stopped) { ctx.lastYield = Date.now(); res(v); } },
          (e) => {
            if (ctx.stopped) return;
            if (isStopErr(e)) { stopCtx(ctx); return; }
            rej(e);
          },
        );
      });
    }

    function step(text: string, dedupe = false) {
      ctx.steps++;
      if (dedupe && ctx.lastStepText === text) return;
      ctx.lastStepText = text;
      log(ctx, text, "step");
    }
    const callText = (name: string, args: any[], kw: Record<string, any>) =>
      name + "(" + args.map(argText).concat(Object.keys(kw).map((k) => k + "=" + argName(kw[k]))).join(", ") + ")";

    /** Wraps a JS implementation as a Python callable with friendly argument-count checks. */
    function api(spec: Spec, impl: (args: any[], kw: Record<string, any>) => any, method = true) {
      const code: any = function (kwarr: any[], tuple: any) {
        if (ctx.stopped) return halt();
        const args: any[] = tuple.v.slice(method ? 1 : 0);
        const kw: Record<string, any> = {};
        for (let i = 0; i < kwarr.length; i += 2) {
          const k = String(kwarr[i].v);
          if (!spec.kw || !spec.kw.includes(k)) {
            oops("TypeError", spec.label + " doesn't have a setting called '" + k + "'." + (spec.kw ? " You can use: " + spec.kw.map((x) => x + "=").join(", ") + "." : "") + " Example: " + spec.example + ".");
          }
          kw[k] = kwarr[i + 1];
        }
        if (!spec.varargs) {
          const extra = spec.kw && spec.kw.includes("wait") && !("wait" in kw) ? 1 : 0; // wait may be given by position too
          const n = args.length;
          if (n < spec.required || n > spec.params.length + extra) oops("TypeError", countMessage(spec, n));
          if (extra && n === spec.params.length + 1) { kw.wait = args.pop(); }
        }
        flushLine(ctx);
        return impl(args, kw);
      };
      code.co_varargs = 1;
      code.co_kwargs = 1;
      code.co_argcount = 0;
      code.co_varnames = [];
      code.co_name = pyStr(spec.label.split(".").pop() as string);
      const f = new Sk.builtin.func(code);
      try { f.$name = spec.label.split(".").pop(); f.$qualname = spec.label; } catch { /* ignore */ }
      return f;
    }

    function motion(text: string, p: Promise<void>, wait: boolean) {
      step(text);
      if (!wait) {
        p.catch(() => { /* wait=False: the outcome is ignored (STOPPED included) */ });
        return none();
      }
      return Sk.misceval.promiseToSuspension(guard(p).then(() => none()));
    }

    function makeObject(className: string, members: Record<string, any>) {
      const cls = Sk.misceval.buildClass({}, function ($gbl: any, $loc: any) {
        for (const k of Object.keys(members)) $loc[k] = members[k];
        $loc.__repr__ = new Sk.builtin.func(function () { return pyStr("<" + className + ">"); });
      }, className, []);
      return Sk.misceval.callsimArray(cls, []);
    }

    // ---- drivetrain
    const S = {
      drive_for: { label: "drive_for", params: ["direction", "distance", "units"], required: 3, kw: ["wait"], example: "drivetrain.drive_for(FORWARD, 200, MM)" },
      turn_for: { label: "turn_for", params: ["direction", "angle", "units"], required: 3, kw: ["wait"], example: "drivetrain.turn_for(RIGHT, 90, DEGREES)" },
      turn_to_heading: { label: "turn_to_heading", params: ["angle", "units"], required: 2, kw: ["wait"], example: "drivetrain.turn_to_heading(90, DEGREES)" },
      drive: { label: "drive", params: ["direction"], required: 1, example: "drivetrain.drive(FORWARD)" },
      turn: { label: "turn", params: ["direction"], required: 1, example: "drivetrain.turn(RIGHT)" },
      stop: { label: "stop", params: [], required: 0, example: "drivetrain.stop()" },
      set_drive_velocity: { label: "set_drive_velocity", params: ["velocity", "units"], required: 1, example: "drivetrain.set_drive_velocity(50, PERCENT)" },
      set_turn_velocity: { label: "set_turn_velocity", params: ["velocity", "units"], required: 1, example: "drivetrain.set_turn_velocity(50, PERCENT)" },
      set_heading: { label: "set_heading", params: ["angle", "units"], required: 1, example: "drivetrain.set_heading(0, DEGREES)" },
      heading: { label: "heading", params: ["units"], required: 0, example: "drivetrain.heading(DEGREES)" },
      rotation: { label: "rotation", params: ["units"], required: 0, example: "drivetrain.rotation(DEGREES)" },
      is_done: { label: "is_done", params: [], required: 0, example: "drivetrain.is_done()" },
    } satisfies Record<string, Spec>;

    function driveDir(s: Spec, v: any): DriveDir {
      const d = constOf(v);
      if (d === "LEFT" || d === "RIGHT") {
        oops("ValueError", s.label + " drives straight, so its direction is FORWARD or REVERSE. To turn, use drivetrain." + (s.label === "drive" ? "turn(" + d + ")" : "turn_for(" + d + ", 90, DEGREES)") + ".");
      }
      if (d !== "FORWARD" && d !== "REVERSE") oops("ValueError", s.label + " direction must be FORWARD or REVERSE, not " + argName(v) + "." + constHint(v));
      return d as DriveDir;
    }
    function turnDir(s: Spec, v: any): TurnDir {
      const d = constOf(v);
      if (d === "FORWARD" || d === "REVERSE") {
        oops("ValueError", s.label + " direction is LEFT or RIGHT. To drive straight, use drivetrain." + (s.label === "turn" ? "drive(" + d + ")" : "drive_for(" + d + ", 200, MM)") + ".");
      }
      if (d !== "LEFT" && d !== "RIGHT") oops("ValueError", s.label + " direction must be LEFT or RIGHT, not " + argName(v) + "." + constHint(v));
      return d as TurnDir;
    }
    function velocity(s: Spec, args: any[]): number {
      const v = needNumber(s, "velocity", args[0], "50");
      needUnit(s, args[1], ["PERCENT"], "PERCENT");
      const c = Math.max(1, Math.min(100, v));
      if (c !== v) log(ctx, s.label + " uses 1 to 100 PERCENT, so " + v + " became " + c + ".", "warn");
      return c;
    }

    const drivetrain = makeObject("Drivetrain", {
      drive_for: api(S.drive_for, (a, kw) => {
        const s = S.drive_for;
        let d = driveDir(s, a[0]);
        const dist = needNumber(s, "distance", a[1], "200");
        const u = needUnit(s, a[2], ["MM", "INCHES"]);
        const wait = needWait(s, kw.wait);
        let mm = dist * (u === "INCHES" ? 25.4 : 1);
        if (mm < 0) { mm = -mm; d = d === "FORWARD" ? "REVERSE" : "FORWARD"; }
        return motion(callText("drive_for", a, kw), ctl.driveFor(d, mm), wait);
      }),
      turn_for: api(S.turn_for, (a, kw) => {
        const s = S.turn_for;
        let d = turnDir(s, a[0]);
        const ang = needNumber(s, "angle", a[1], "90");
        needUnit(s, a[2], ["DEGREES"]);
        const wait = needWait(s, kw.wait);
        let deg = ang;
        if (deg < 0) { deg = -deg; d = d === "LEFT" ? "RIGHT" : "LEFT"; }
        return motion(callText("turn_for", a, kw), ctl.turnFor(d, deg), wait);
      }),
      turn_to_heading: api(S.turn_to_heading, (a, kw) => {
        const s = S.turn_to_heading;
        const ang = needNumber(s, "angle", a[0], "90");
        needUnit(s, a[1], ["DEGREES"]);
        const wait = needWait(s, kw.wait);
        return motion(callText("turn_to_heading", a, kw), ctl.turnToHeading(ang), wait);
      }),
      drive: api(S.drive, (a) => { const d = driveDir(S.drive, a[0]); step(callText("drive", a, {}), true); ctl.drive(d); return none(); }),
      turn: api(S.turn, (a) => { const d = turnDir(S.turn, a[0]); step(callText("turn", a, {}), true); ctl.turn(d); return none(); }),
      stop: api(S.stop, () => { step("stop()", true); ctl.stop(); return none(); }),
      set_drive_velocity: api(S.set_drive_velocity, (a) => {
        const v = velocity(S.set_drive_velocity, a); step(callText("set_drive_velocity", a, {}), true); ctl.setDriveVelocity(v); return none();
      }),
      set_turn_velocity: api(S.set_turn_velocity, (a) => {
        const v = velocity(S.set_turn_velocity, a); step(callText("set_turn_velocity", a, {}), true); ctl.setTurnVelocity(v); return none();
      }),
      set_heading: api(S.set_heading, (a) => {
        const v = needNumber(S.set_heading, "angle", a[0], "0");
        needUnit(S.set_heading, a[1], ["DEGREES"], "DEGREES");
        step(callText("set_heading", a, {}), true); ctl.setHeading(v); return none();
      }),
      heading: api(S.heading, (a) => { needUnit(S.heading, a[0], ["DEGREES"], "DEGREES"); return pyFloat(round(ctl.heading(), 2)); }),
      rotation: api(S.rotation, (a) => { needUnit(S.rotation, a[0], ["DEGREES"], "DEGREES"); return pyFloat(round(ctl.rotation(), 2)); }),
      is_done: api(S.is_done, () => pyBool(ctl.isDone())),
    });

    // ---- sensors
    const D = { label: "distance.get_distance", params: ["units"], required: 0, example: "distance.get_distance(MM)" };
    const distance = makeObject("DistanceSensor", {
      get_distance: api(D, (a) => {
        const u = needUnit(D, a[0], ["MM", "INCHES"], "MM");
        const mm = ctl.distanceMM();
        return pyFloat(u === "INCHES" ? round(mm / 25.4, 2) : round(mm, 1));
      }),
      found_object: api({ label: "distance.found_object", params: [], required: 0, example: "distance.found_object()" }, () => pyBool(ctl.distanceFound())),
    });

    function eye(prefix: "front_eye" | "down_eye") {
      const front = prefix === "front_eye";
      const det = { label: prefix + ".detect", params: ["color"], required: 1, example: prefix + ".detect(" + (front ? "RED" : "BLACK") + ")" };
      const br = { label: prefix + ".brightness", params: ["units"], required: 0, example: prefix + ".brightness(PERCENT)" };
      const colorNow = () => (front ? ctl.frontColor() : ctl.downColor());
      const members: Record<string, any> = {
        detect: api(det, (a) => { const c = needColor(det, a[0]); return pyBool(colorNow() === c); }),
        color: api({ label: prefix + ".color", params: [], required: 0, example: prefix + ".color()" }, () => pyStr(colorNow())),
        brightness: api(br, (a) => { needUnit(br, a[0], ["PERCENT"], "PERCENT"); return pyInt(front ? ctl.frontBrightness() : ctl.downBrightness()); }),
      };
      if (front) members.near_object = api({ label: "front_eye.near_object", params: [], required: 0, example: "front_eye.near_object()" }, () => pyBool(ctl.frontNear()));
      return makeObject(front ? "FrontEye" : "DownEye", members);
    }

    const bumper = makeObject("Bumper", {
      pressed: api({ label: "bumper.pressed", params: [], required: 0, example: "bumper.pressed()" }, () => pyBool(ctl.bumperPressed())),
    });

    const P = { label: "location.position", params: ["axis", "units"], required: 1, example: "location.position(X, MM)" };
    const location = makeObject("Location", {
      position: api(P, (a) => {
        const ax = constOf(a[0]);
        if (ax !== "X" && ax !== "Y") oops("ValueError", "location.position needs X or Y first, then MM. Example: location.position(X, MM). You gave " + argName(a[0]) + "." + constHint(a[0]));
        const u = needUnit(P, a[1], ["MM", "INCHES"], "MM");
        const mm = ax === "X" ? ctl.positionX() : ctl.positionY();
        return pyFloat(u === "INCHES" ? round(mm / 25.4, 2) : round(mm, 1));
      }),
    });

    // ---- hardware
    const PM = { label: "pen.move", params: ["direction"], required: 1, example: "pen.move(DOWN)" };
    const PC = { label: "pen.set_pen_color", params: ["color"], required: 1, example: "pen.set_pen_color(RED)" };
    const ME = { label: "magnet.energize", params: ["mode"], required: 1, example: "magnet.energize(BOOST)" };
    const pen = makeObject("Pen", {
      move: api(PM, (a) => {
        const d = constOf(a[0]);
        if (d !== "UP" && d !== "DOWN") oops("ValueError", "pen.move needs UP or DOWN. Example: pen.move(DOWN). You gave " + argName(a[0]) + "." + constHint(a[0]));
        if (!ctl.penDown(d === "DOWN")) oops("RuntimeError", "This playground has no pen. Pick a playground with a pen to draw.");
        step("pen." + callText("move", a, {}));
        return none();
      }),
      set_pen_color: api(PC, (a) => {
        const c = needColor(PC, a[0], false);
        if (!ctl.setPenColor(c)) oops("RuntimeError", "This playground has no pen. Pick a playground with a pen to draw.");
        step("pen." + callText("set_pen_color", a, {}));
        return none();
      }),
    });
    const magnet = makeObject("Magnet", {
      energize: api(ME, (a) => {
        const m = constOf(a[0]);
        if (m !== "BOOST" && m !== "DROP") oops("ValueError", "magnet.energize needs BOOST (pick up) or DROP (let go). Example: magnet.energize(BOOST). You gave " + argName(a[0]) + "." + constHint(a[0]));
        if (!ctl.magnet(m === "BOOST")) oops("RuntimeError", "This playground has no magnet. Pick a playground with a magnet to pick things up.");
        step("magnet." + callText("energize", a, {}));
        return none();
      }),
    });

    // ---- brain
    const toText = (v: any) => (v instanceof Sk.builtin.str ? (v as any).v : String(new Sk.builtin.str(v).v));
    const screen = makeObject("Screen", {
      print: api({ label: "brain.screen.print", params: ["value"], required: 0, varargs: true, kw: ["sep"], example: "brain.screen.print(\"Hello\")" }, (a, kw) => {
        const sep = kw.sep !== undefined ? toText(kw.sep) : " ";
        opts.onScreen?.({ kind: "print", text: a.map(toText).join(sep) });
        return none();
      }),
      new_line: api({ label: "brain.screen.new_line", params: [], required: 0, example: "brain.screen.new_line()" }, () => { opts.onScreen?.({ kind: "newline" }); return none(); }),
      clear_screen: api({ label: "brain.screen.clear_screen", params: [], required: 0, example: "brain.screen.clear_screen()" }, () => { opts.onScreen?.({ kind: "clear" }); return none(); }),
    });
    const TT = { label: "brain.timer.time", params: ["units"], required: 0, example: "brain.timer.time(SECONDS)" };
    const timer = makeObject("Timer", {
      time: api(TT, (a) => {
        const u = needUnit(TT, a[0], ["SECONDS", "MSEC"], "SECONDS");
        const s = ctl.timer();
        return pyFloat(u === "MSEC" ? round(s * 1000, 0) : round(s, 3));
      }),
      clear: api({ label: "brain.timer.clear", params: [], required: 0, example: "brain.timer.clear()" }, () => { ctl.resetTimer(); return none(); }),
    });
    const brain = makeObject("Brain", { screen, timer });

    // ---- top-level functions
    const W = { label: "wait", params: ["time", "units"], required: 1, example: "wait(1, SECONDS)" };
    const waitFn = api(W, (a) => {
      if (!isNum(a[0])) oops("TypeError", "wait needs a number, then SECONDS. Example: wait(1, SECONDS). You gave " + argName(a[0]) + ".");
      const t = num(a[0]);
      if (!isFinite(t) || t < 0) oops("ValueError", "wait time must be 0 or more. You gave " + argName(a[0]) + ".");
      const u = constOf(a[1] === undefined ? pyStr("SECONDS") : a[1]);
      if (u !== "SECONDS" && u !== "MSEC") oops("ValueError", "wait units must be SECONDS or MSEC, not " + argName(a[1]) + "." + constHint(a[1]));
      const text = "wait(" + argText(a[0]) + ", " + u + ")";
      return motion(text, ctl.wait(u === "MSEC" ? t / 1000 : t), true);
    }, false);

    const startFn = api({ label: "start", params: ["function"], required: 1, example: "start(main)" }, (a) => {
      const fn = a[0];
      if (fn === Sk.builtin.none.none$) {
        oops("TypeError", "Write start(main) with no () after main. With the (), Python runs main first and gives start nothing.");
      }
      if (fn === undefined || !Sk.builtin.checkCallable(fn)) {
        oops("TypeError", "start() needs the name of your function, like start(main), with no () after main. You gave " + argName(fn) + ".");
      }
      ctx.startCalled = true;
      return Sk.misceval.callsimOrSuspendArray(fn, []);
    }, false);

    // ---- install
    for (const c of CONSTANTS) Sk.builtins[c] = pyStr(c);
    Object.assign(Sk.builtins, {
      drivetrain, distance, front_eye: eye("front_eye"), down_eye: eye("down_eye"), bumper, location,
      pen, magnet, brain, wait: waitFn, start: startFn,
    });

    Sk.configure({
      output: (t: string) => onOutput(ctx, String(t)),
      read: readFile,
      __future__: Sk.python3,
      execLimit: null,
      // Skulpt 1.2's yieldLimit has a bug: after a yield inside a function's while loop, the code after
      // the loop is skipped. So yielding is driven from the debugger breakpoints instead (they suspend
      // before each statement and on every loop iteration, and resume correctly).
      yieldLimit: null,
      killableWhile: true,
      killableFor: true,
      debugging: true,
      breakpoints: (filename: string, lineno: number) => {
        onBreakpoint(ctx, filename, lineno);
        return !ctx.stopped && Date.now() - ctx.lastYield > YIELD_MS;
      },
      inputfun: () => oops("RuntimeError", "input() can't be used in Robot Lab. Put the value straight into your program instead, like speed = 50."),
      inputfunTakesPrompt: true,
    });

    const handlers = {
      "*": (r: any) => {
        if (ctx.stopped) return NEVER;
        flushLine(ctx, true);
        const type = r && r.data && r.data.type;
        if (type === "Sk.debug" || type === "Sk.delay" || type === "Sk.yield") {
          // Give the browser (and the app's sim loop) a turn, then carry on.
          return new Promise((res, rej) => {
            setTimeout(() => {
              if (ctx.stopped) return;
              ctx.lastYield = Date.now();
              try { res(r.resume()); } catch (e) { rej(e); }
            }, 0);
          });
        }
        return undefined; // Sk.promise etc: default handling (our promises are guarded)
      },
    };

    Sk.misceval.asyncToPromise(() => Sk.importMainWithBody("<stdin>", false, source, true), handlers).then(
      () => {
        if (ctx.stopped) return;
        flushOutput(ctx);
        flushLine(ctx);
        if (!ctx.startCalled) log(ctx, MISSING_START_TEXT, "warn");
        ctx.finish({ status: "finished", startCalled: ctx.startCalled, steps: ctx.steps });
      },
      (e: any) => {
        if (ctx.stopped) return;
        flushOutput(ctx);
        if (e instanceof Error && e.message === "STOPPED") { stopCtx(ctx); return; }
        ctx.finish({ status: "error", error: toFriendly(ctx, e, source) });
      },
    );
  }

  return {
    run,
    stop() { if (current) stopCtx(current); },
    get running() { return current !== null; },
  };
}
