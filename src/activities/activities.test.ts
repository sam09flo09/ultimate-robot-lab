import { describe, it, expect, beforeEach } from "vitest";
import { renderRich, renderInline, plainText } from "./markup";
import { parseActivityFile, toActivityFile, sanitizeProgress, newProgress, sanitizeEmbedded, LIMITS } from "./activityFile";
import { loadProgress, saveProgress, loadImported, saveImported, loadCurrentId, saveCurrentId } from "./progress";
import { SAMPLE_ACTIVITY } from "./sample";

describe("markup", () => {
  it("renders the safe subset", () => {
    expect(renderRich("Hello **bold** and `code`.\nSame para.\n\nNext")).toBe("<p>Hello <b>bold</b> and <code>code</code>. Same para.</p><p>Next</p>");
    expect(renderRich("- one\n- **two**\n\nafter")).toBe("<ul><li>one</li><li><b>two</b></li></ul><p>after</p>");
    expect(renderRich("```python\ndef main():\n    pass\n```")).toBe('<pre class="act-code"><code>def main():\n    pass</code></pre>');
    expect(renderInline("`**not bold**`")).toBe("<code>**not bold**</code>");
    expect(renderInline("a ** b")).toBe("a ** b");
    expect(plainText("**Hi** `x`")).toBe("Hi x");
  });
  it("escapes hostile input everywhere", () => {
    const evil = [
      `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `**<b onclick="x">**`, "`<svg/onload=1>`",
      "```\n</code></pre><script>x</script>\n```", `- <a href="javascript:alert(1)">x</a>`, `" onmouseover="x`, "'&'",
      "```\n<unclosed", "**`<i>`**",
    ];
    for (const e of evil) {
      for (const html of [renderRich(e), renderInline(e)]) {
        expect(html).not.toMatch(/<(?!\/?(p|b|code|ul|li|pre)( class="act-code")?>)/);
        const noClass = html.split(' class="act-code"').join("");
        expect(noClass).not.toContain('"');
        expect(noClass).not.toContain("'");
      }
    }
    expect(renderRich(null as unknown as string)).toBe("");
  });
});

describe("activity files", () => {
  it("round-trips the sample (teacher import adds t- prefix)", () => {
    const { activity, warnings } = parseActivityFile(toActivityFile(SAMPLE_ACTIVITY));
    expect(warnings).toEqual([]);
    expect(activity.id).toBe("t-a00-sample");
    expect({ ...activity, id: SAMPLE_ACTIVITY.id }).toEqual(SAMPLE_ACTIVITY);
    expect(parseActivityFile(toActivityFile(SAMPLE_ACTIVITY), { teacher: false }).activity).toEqual(SAMPLE_ACTIVITY);
    const again = parseActivityFile(toActivityFile(activity)).activity;
    expect(again.id).toBe("t-a00-sample");
  });
  it("rejects non-activities with readable messages", () => {
    expect(() => parseActivityFile("not json")).toThrow(/isn't readable JSON/);
    expect(() => parseActivityFile("[]")).toThrow(/not a Robot Lab activity/);
    expect(() => parseActivityFile(JSON.stringify({ format: "robot-lab-project", version: 1 }))).toThrow(/not a Robot Lab activity/);
    expect(() => parseActivityFile(JSON.stringify({ format: "robot-lab-activity", version: 2, steps: [] }))).toThrow(/newer/);
    expect(() => parseActivityFile(JSON.stringify({ format: "robot-lab-activity", version: 1, steps: [] }))).toThrow(/no steps/);
    expect(() => parseActivityFile(JSON.stringify({ format: "robot-lab-activity", version: 1, steps: [1, null, "x"] }))).toThrow(/no usable steps/);
    expect(() => parseActivityFile("x".repeat(4 * 1024 * 1024))).toThrow(/too big/);
  });
  it("whitelists fields and caps hostile values", () => {
    const hostile = {
      format: "robot-lab-activity", version: 1, id: "../../<script>", title: "<b>T</b>\u0000\n".repeat(100),
      summary: 42, level: "expert", minutes: 1e9, standards: ["a", 3, "", ...Array(100).fill("s")], author: "teacher@school.org",
      __proto__: { polluted: true }, extra: "dropped", constructor: "x",
      steps: [
        {
          id: "s", title: "", body: "x".repeat(LIMITS.body * 2), hints: ["h", 5, ""], lockMode: "java", extra: 1,
          world: { playground: "nowhere" },
          starter: { mode: "python", python: 12 },
          checks: [
            { kind: "usesCall", name: "os.system('rm')", label: "bad" },
            { kind: "usesCall", name: "drivetrain.drive_for", min: -5, label: "<i>x</i>", evil: true },
            { kind: "eval", code: "alert(1)" },
            { kind: "endsInSquare", square: "21" },
            { kind: "maxLines", lines: "x" },
            { kind: "logContains", text: { a: 1 } },
          ],
          quiz: [
            { prompt: "?", choices: ["a", "b"], answer: 5, explain: "" },
            { prompt: "?", choices: ["a"], answer: 0, explain: "" },
            { prompt: "ok?", choices: ["a", "b"], answer: 1, explain: "e", code: "x = 1", junk: 1 },
          ],
        },
        { id: "s", title: "Dup id", body: "", checks: "nope", hints: "nope", world: { custom: { walls: "bad", width: -1 } } },
        "not a step",
      ],
    };
    const { activity, warnings } = parseActivityFile(JSON.stringify(hostile), { knownPlayground: (id) => id === "number-grid" });
    expect(activity.id).toBe("t-script");
    expect(activity.title.length).toBeLessThanOrEqual(LIMITS.title);
    expect(activity.title).not.toMatch(/[\u0000\n]/);
    expect(activity.summary).toBe("");
    expect(activity.level).toBe("core");
    expect(activity.minutes).toBe(LIMITS.minutes);
    expect(activity.standards.length).toBeLessThanOrEqual(LIMITS.standards);
    expect(activity.author).toBeUndefined();
    expect(Object.keys(activity).sort()).toEqual(["format", "id", "level", "minutes", "standards", "steps", "summary", "title", "version"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const [s1, s2] = activity.steps;
    expect(activity.steps.length).toBe(2);
    expect(s1.body.length).toBe(LIMITS.body);
    expect(s1.title).toBe("Step 1");
    expect(s1.hints).toEqual(["h"]);
    expect(s1.lockMode).toBeUndefined();
    expect(s1.starter).toEqual({ mode: "python" });
    expect(s1.checks).toEqual([
      { kind: "usesCall", name: "drivetrain.drive_for", min: 1, label: "<i>x</i>" },
      { kind: "maxLines", lines: 20, label: "" },
      { kind: "logContains", text: "", label: "" },
    ]);
    expect(s1.quiz).toEqual([{ prompt: "ok?", choices: ["a", "b"], answer: 1, explain: "e", code: "x = 1" }]);
    expect(Object.keys(s1)).not.toContain("extra");
    expect(s2.id).not.toBe(s1.id);
    expect(s2.checks).toEqual([]);
    expect(s2.hints).toEqual([]);
    expect(s2.world && "custom" in s2.world && s2.world.custom.id).toBe("custom");
    expect(s2.world && "custom" in s2.world && Array.isArray(s2.world.custom.walls)).toBe(true);
    expect(warnings.some((w) => w.includes("nowhere"))).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it("caps step counts", () => {
    const many = { ...SAMPLE_ACTIVITY, steps: Array.from({ length: 200 }, (_, i) => ({ ...SAMPLE_ACTIVITY.steps[2], id: "s" + i })) };
    const { activity, warnings } = parseActivityFile(JSON.stringify(many));
    expect(activity.steps.length).toBe(LIMITS.steps);
    expect(warnings[0]).toMatch(/first/);
  });
});

describe("progress", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
    };
  });
  it("round-trips progress keyed by activity id", () => {
    const p = newProgress(SAMPLE_ACTIVITY);
    p.stepIndex = 2; p.completed = ["drive", "quiz"]; p.hintsShown = { drive: 2 }; p.quizAnswers = { quiz: [1] };
    expect(saveProgress(p)).toBe(true);
    const back = loadProgress(SAMPLE_ACTIVITY)!;
    expect({ ...back, updatedAt: "" }).toEqual({ ...p, updatedAt: "" });
    expect(loadProgress({ ...SAMPLE_ACTIVITY, id: "other" })).toBeNull();
  });
  it("sanitizes junk progress against the activity", () => {
    const p = sanitizeProgress({ stepIndex: 99, completed: ["drive", "nope", 3, "drive"], hintsShown: { drive: 50, nope: 1 }, quizAnswers: { quiz: [7, "x"], drive: [1] } }, SAMPLE_ACTIVITY);
    expect(p.stepIndex).toBe(2);
    expect(p.completed).toEqual(["drive"]);
    expect(p.hintsShown).toEqual({ drive: 2 });
    expect(p.quizAnswers).toEqual({ quiz: [-1] });
    mem.set("robot-lab-activity-progress-v1:a00-sample", "{broken");
    expect(loadProgress(SAMPLE_ACTIVITY)).toBeNull();
  });
  it("survives storage that throws", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("x"); },
    };
    expect(saveProgress(newProgress(SAMPLE_ACTIVITY))).toBe(false);
    expect(loadProgress(SAMPLE_ACTIVITY)).toBeNull();
    expect(loadImported()).toEqual([]);
    expect(loadCurrentId()).toBeNull();
    expect(() => saveCurrentId(null)).not.toThrow();
  });
  it("stores imported activities and the current id", () => {
    const t = parseActivityFile(toActivityFile(SAMPLE_ACTIVITY)).activity;
    saveImported(t); saveImported(t);
    expect(loadImported().map((a) => a.id)).toEqual(["t-a00-sample"]);
    saveCurrentId("t-a00-sample");
    expect(loadCurrentId()).toBe("t-a00-sample");
  });
  it("embedded project activity: built-ins are looked up, others sanitized", () => {
    const w: string[] = [];
    const e = sanitizeEmbedded({ activity: { ...SAMPLE_ACTIVITY, title: "tampered" }, progress: { stepIndex: 1 } }, (id) => (id === "a00-sample" ? SAMPLE_ACTIVITY : undefined), w)!;
    expect(e.activity).toBe(SAMPLE_ACTIVITY);
    expect(e.progress.stepIndex).toBe(1);
    const t = sanitizeEmbedded({ activity: { ...SAMPLE_ACTIVITY, id: "mine" }, progress: null }, () => undefined, w)!;
    expect(t.activity.id).toBe("t-mine");
    expect(t.progress.activityId).toBe("t-mine");
    expect(sanitizeEmbedded({ activity: { format: "x" } }, () => undefined, w)).toBeNull();
    expect(w.length).toBe(1);
    expect(sanitizeEmbedded(null, () => undefined, w)).toBeNull();
  });
});

describe("built-in activities", () => {
  it("survive validation unchanged (so saved projects and files round-trip)", async () => {
    const { BUILT_INS } = await import("./builtins");
    const { getPlayground } = await import("../worlds");
    expect(BUILT_INS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const a of BUILT_INS) {
      expect(ids.has(a.id)).toBe(false); ids.add(a.id);
      const r = parseActivityFile(toActivityFile(a), { teacher: false, knownPlayground: (id) => !!getPlayground(id) });
      expect(r.warnings, a.id).toEqual([]);
      for (let i = 0; i < a.steps.length; i++) {
        const s = a.steps[i], t = r.activity.steps[i];
        expect({ ...t, world: undefined }, `${a.id}/${s.id}`).toEqual({ ...s, world: undefined });
      }
    }
  });
});
