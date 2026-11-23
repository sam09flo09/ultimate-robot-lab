/**
 * Small synthesized sound effects (Web Audio, no audio files, works offline).
 * Quiet by design: a class of 30 Chromebooks shouldn't be a racket. On/off lives in the "Aa" menu.
 */
import type { SimEvent } from "../core/types";

export type SoundName = "start" | "bump" | "pickup" | "drop" | "zone" | "success" | "error" | "step";

const KEY = "robot-lab-sound-v1";
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== "off"; } catch { /* default on */ }

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const lastPlayed: Partial<Record<SoundName, number>> = {};

export function soundEnabled(): boolean { return enabled; }
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
  if (!on && ctx) void ctx.suspend().catch(() => undefined);
}

/** Browsers only allow audio after a user gesture; call this from a click (e.g. Run). */
export function unlockAudio(): void {
  if (!enabled) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  } catch { ctx = null; master = null; }
}

/** One short tone with a quick attack and exponential decay. */
function tone(freq: number, start: number, dur: number, type: OscillatorType, peak = 1, slideTo?: number): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

export function playSound(name: SoundName): void {
  if (!enabled || !ctx || ctx.state !== "running") return;
  // Don't machine-gun the same sound (e.g. a robot grinding along a wall).
  const now = performance.now();
  const gap = name === "bump" ? 400 : 80;
  if (now - (lastPlayed[name] ?? -1e9) < gap) return;
  lastPlayed[name] = now;
  try {
    switch (name) {
      case "start":   tone(660, 0, 0.09, "square", 0.5); tone(990, 0.09, 0.12, "square", 0.5); break;
      case "bump":    tone(140, 0, 0.16, "triangle", 1, 70); break;
      case "pickup":  tone(520, 0, 0.12, "sine", 0.8, 1040); break;
      case "drop":    tone(880, 0, 0.12, "sine", 0.8, 440); break;
      case "zone":    tone(1200, 0, 0.06, "sine", 0.35); break;
      case "step":    tone(784, 0, 0.1, "sine", 0.6); tone(1175, 0.08, 0.16, "sine", 0.6); break;
      case "error":   tone(220, 0, 0.14, "sawtooth", 0.35); tone(165, 0.13, 0.2, "sawtooth", 0.35); break;
      case "success": [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, i === 3 ? 0.4 : 0.14, "triangle", 0.8)); break;
    }
  } catch { /* audio is a nicety; never break the app */ }
}

/** Map sim events to sounds. */
export function soundForSimEvent(e: SimEvent): void {
  switch (e.type) {
    case "wallHit": playSound("bump"); break;
    case "pickedUp": playSound("pickup"); break;
    case "dropped": playSound("drop"); break;
    case "zoneEntered": playSound("zone"); break;
    case "goalsComplete": break; // the app plays "success" when it celebrates
  }
}
