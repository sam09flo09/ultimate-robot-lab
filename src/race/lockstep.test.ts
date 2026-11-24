import { describe, expect, it } from "vitest";
import { createLockstep, trackController } from "./lockstep";
import { createSim } from "../sim";
import { getPlayground } from "../worlds";

describe("trackController", () => {
  it("counts pending motion/wait promises and passes everything else through", async () => {
    const sim = createSim(getPlayground("zigzag-gates")!);
    const t = trackController(sim.controller);
    expect(t.pending()).toBe(0);
    const p = t.controller.driveFor("FORWARD", 10);
    const q = t.controller.wait(0.05);
    expect(t.pending()).toBe(2);
    expect(t.controller.positionX()).toBe(-1200);
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    await p; await q;
    await Promise.resolve();
    expect(t.pending()).toBe(0);
    t.controller.driveFor("FORWARD", 1000).catch(() => {});
    sim.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.pending()).toBe(0); // rejected (STOPPED) also counts down
  });
});

describe("createLockstep", () => {
  it("runs whole substeps only, carrying the remainder, whatever the dt sequence", async () => {
    let n = 0;
    const l = createLockstep({ step: () => { n++; }, canAdvance: () => true, maxBacklog: 10 });
    for (const dt of [0.004, 0.004, 0.004, 0.03, 0.1]) { l.advance(dt); await l.drain(); }
    expect(n).toBe(Math.floor((0.142 + 1e-9) * 120));
  });

  it("does not pass time while the program computes (until the idle cap)", async () => {
    let n = 0, ready = false;
    let clock = 0;
    const l = createLockstep({
      step: () => { n++; }, canAdvance: () => ready, maxBacklog: 10,
      idleWait: async () => { clock += 10; if (clock >= 30) ready = true; }, now: () => clock, idleCapMs: 1000,
    });
    l.advance(0.05);
    await l.drain();
    expect(clock).toBe(30); // waited for the program first
    expect(n).toBe(6);
  });

  it("cancel drops the backlog", async () => {
    let n = 0;
    const l = createLockstep({ step: () => { n++; if (n === 3) l.cancel(); }, canAdvance: () => true, maxBacklog: 10 });
    l.advance(1);
    await l.drain();
    expect(n).toBe(3);
    expect(l.busy).toBe(false);
  });

  it("caps the backlog", async () => {
    let n = 0;
    const l = createLockstep({ step: () => { n++; }, canAdvance: () => true, maxBacklog: 0.1 });
    l.advance(5);
    await l.drain();
    expect(n).toBe(12);
  });
});
