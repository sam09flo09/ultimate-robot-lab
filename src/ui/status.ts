/** Status-tile text, computed the same way as the original Grid Robot Sim. */
import type { World, Goal } from "../core/types";

const norm = (h: number) => { h %= 360; if (h < 0) h += 360; if (Math.abs(h - 360) < 1e-6) h = 0; return Math.round(h * 1e3) / 1e3; };

/** Square number for numberGrid worlds; "*" suffix when the robot centre is on a grid line. */
export function squareText(world: World, x: number, y: number): string {
  const sq = world.gridSize ?? 200;
  const cols = Math.max(1, Math.round(world.width / sq)), rows = Math.max(1, Math.round(world.height / sq));
  const hw = world.width / 2, hh = world.height / 2;
  const c = Math.max(0, Math.min(cols - 1, Math.floor((x + hw) / sq)));
  const r = Math.max(0, Math.min(rows - 1, Math.floor((y + hh) / sq)));
  const n = r * cols + c + 1;
  const onLine = (v: number, half: number) => { const m = (((v + half) % sq) + sq) % sq; return m < 0.5 || m > sq - 0.5; };
  return onLine(x, hw) || onLine(y, hh) ? n + "*" : String(n);
}

export function facingText(world: World, heading: number): string {
  const h = norm(heading);
  const cols = Math.max(1, Math.round(world.width / (world.gridSize ?? 200)));
  if (Math.abs(h) < 0.05) return world.background === "numberGrid" ? `up (toward ${cols + 1})` : "up";
  if (Math.abs(h - 90) < 0.05) return "right";
  if (Math.abs(h - 180) < 0.05) return "down";
  if (Math.abs(h - 270) < 0.05) return "left";
  return Math.round(h) + "°";
}

export function goalText(g: Goal, world?: World): string {
  if (g.description) return g.description;
  const zn = (id: string) => world?.zones.find((z) => z.id === id)?.label || id;
  switch (g.type) {
    case "reachZone": return `Reach ${zn(g.zone)}`;
    case "objectsInZone": return `Put ${g.count} ${g.color ? g.color.toLowerCase() + " " : ""}object${g.count === 1 ? "" : "s"} in ${zn(g.zone)}`;
    case "visitInOrder": return `Visit ${g.zones.map(zn).join(" → ")} in order`;
    case "noWallHits": return "Don’t hit any walls";
    case "endFacing": return `Finish facing ${Math.round(g.heading)}°`;
    case "maxTime": return `Finish within ${g.seconds} s`;
  }
}

export const DEFAULT_TEMPLATE = [
  "# My robot program",
  "",
  "def main():",
  "    # Write your statements below, indented 4 spaces.",
  "    pass  # placeholder: delete this line when you add statements",
  "",
  "# Start the program at main(). Do not delete.",
  "start(main)",
  "",
].join("\n");

export function starterFor(world: World): string {
  const s = world.starter?.python;
  return typeof s === "string" && s.trim() ? s : DEFAULT_TEMPLATE;
}
