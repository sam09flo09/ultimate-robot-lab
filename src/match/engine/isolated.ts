/**
 * match: Python runners isolated from each other and from the page (core/match.ts IsolatedRunner).
 *
 * Skulpt keeps its state in one global `Sk` per window (Sk.configure, Sk.builtins, …), so two programs
 * can't share one. Each IsolatedRunner gets its own Skulpt "realm":
 *  - in the browser: a hidden same-origin iframe (runnerFrame.html) that loads only the vendored Skulpt;
 *  - in tests: a node:vm context (see isolated.test.ts) — same code path.
 * The normal runtime (src/runtime createPythonRunner) runs in the main page but drives that realm's
 * Sk (RunnerInternals.sk), so the controller, input and callbacks are plain same-page calls and sensor
 * reads stay synchronous. A runtime error in one realm can't touch the other.
 */
import type { IsolatedRunner, IsolatedRunnerOptions } from "../../core/match";
import type { RunResult } from "../../core/modules";
import { createPythonRunner } from "../../runtime";

/** A loaded, independent Skulpt instance. */
export interface SkRealm {
  Sk: unknown;
  dispose(): void;
}
export type RealmLoader = () => Promise<SkRealm>;

const LOAD_TIMEOUT_MS = 20_000;

/** URL of the frame page: next to this module in dev, dist/src/match/engine/ in a build. */
export function runnerFrameUrl(): string {
  // Built at runtime so Vite leaves it alone (the page is its own build input, see vite.config.ts).
  const rel = import.meta.env.DEV ? "./runnerFrame.html" : "../src/match/engine/runnerFrame.html";
  return new URL(rel, import.meta.url).href;
}

/** Load Skulpt in a hidden same-origin iframe. */
export function iframeRealm(host?: HTMLElement, url = runnerFrameUrl()): RealmLoader {
  return () => new Promise<SkRealm>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Robot Lab match runner";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Off-screen but not display:none, so the browser doesn't throttle its timers.
    frame.style.cssText = "position:absolute;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    let done = false;
    const fail = (msg: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      frame.remove();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail("The Python engine for a match robot did not load in time."), LOAD_TIMEOUT_MS);
    frame.addEventListener("load", () => {
      if (done) return;
      const sk = (frame.contentWindow as unknown as { Sk?: unknown } | null)?.Sk;
      if (!sk) { fail("The Python engine for a match robot did not load."); return; }
      done = true;
      clearTimeout(timer);
      resolve({ Sk: sk, dispose: () => frame.remove() });
    });
    frame.addEventListener("error", () => fail("The Python engine for a match robot did not load."));
    frame.src = url;
    (host ?? document.body).appendChild(frame);
  });
}

/** Build an IsolatedRunner on a Skulpt realm from `load`. */
export async function createIsolatedRunnerWith(opts: IsolatedRunnerOptions, load: RealmLoader): Promise<IsolatedRunner> {
  const realm = await load();
  const inner = createPythonRunner(
    { ...opts, controller: opts.controller, input: opts.input },
    { sk: realm.Sk, waitForDriverPeriod: true },
  );
  let disposed = false;
  const gone: RunResult = {
    status: "error",
    error: { line: 0, type: "Error", raw: "runner disposed", html: "<b>Error</b><br>This match runner was closed. Start the match again." },
  };
  return {
    run: (source, runOpts) => (disposed ? Promise.resolve(gone) : inner.run(source, runOpts)),
    stop: () => inner.stop(),
    get running() { return !disposed && inner.running; },
    pause: () => { if (!disposed) inner.pause(); },
    resume: () => { if (!disposed) inner.resume(); },
    step: () => { if (!disposed) inner.step(); },
    get paused() { return !disposed && inner.paused; },
    variables: () => (disposed ? [] : inner.variables()),
    nextPeriod: () => { if (!disposed) inner.nextPeriod(); },
    dispose() {
      if (disposed) return;
      inner.stop();
      disposed = true;
      realm.dispose();
    },
  };
}

/** One robot's Python runner in its own hidden iframe (see the file comment). */
export function createIsolatedRunner(opts: IsolatedRunnerOptions): Promise<IsolatedRunner> {
  return createIsolatedRunnerWith(opts, iframeRealm(opts.frameHost));
}
