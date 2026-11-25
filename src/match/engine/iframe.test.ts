// @vitest-environment jsdom
// match: the iframe loader. jsdom doesn't run the frame's Skulpt scripts, so this checks the frame's
// set-up, the failure path (friendly error, frame removed) and the success path with a stand-in Sk.
import { describe, it, expect } from "vitest";
import { iframeRealm, runnerFrameUrl, createIsolatedRunnerWith } from "./isolated";
import { fakeController, recorder } from "../../runtime/testkit";

describe("iframeRealm", () => {
  it("points at runnerFrame.html next to this module in dev", () => {
    expect(runnerFrameUrl()).toMatch(/\/src\/match\/engine\/runnerFrame\.html$/);
  });

  it("rejects with a friendly error and removes the frame when Skulpt is missing", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await expect(iframeRealm(host, "about:blank")()).rejects.toThrow(/Python engine for a match robot did not load/);
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("creates a hidden, off-screen frame and removes it on dispose", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const p = iframeRealm(host, "about:blank")();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.tabIndex).toBe(-1);
    expect(frame.style.display).not.toBe("none");
    (frame.contentWindow as unknown as { Sk: unknown }).Sk = { fake: true }; // stand-in for the loaded Skulpt
    const realm = await p;
    expect(realm.Sk).toEqual({ fake: true });
    const run = await createIsolatedRunnerWith(recorder(fakeController().ctl).opts, async () => realm);
    run.dispose();
    expect(host.querySelector("iframe")).toBeNull();
  });
});
