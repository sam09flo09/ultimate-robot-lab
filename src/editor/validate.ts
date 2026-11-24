/** Teacher-facing checks for a level. Pure, no DOM. */
import type { Goal, World } from "../core/types";
import { distToSegment, pointInRect, ROBOT_SIZE, START_ID } from "./geometry";

export interface Issue {
  level: "error" | "warn" | "info";
  text: string;
  /** Item to select when the message is clicked. */
  id?: string;
  /** Goal index the message is about. */
  goal?: number;
}

export const GOAL_LABELS: Record<Goal["type"], string> = {
  reachZone: "Reach a zone",
  objectsInZone: "Push objects into a zone",
  visitInOrder: "Visit zones in order",
  noWallHits: "Don't touch any walls",
  endFacing: "Finish facing a direction",
  maxTime: "Finish within a time limit",
  objectsOnPlatform: "Put objects on a platform",
  stackHeight: "Build a stack",
};

export function validateWorld(w: World): Issue[] {
  const out: Issue[] = [];
  const zoneIds = new Set(w.zones.map((z) => z.id));
  const zoneName = (id: string) => {
    const z = w.zones.find((q) => q.id === id);
    return z?.label ? `"${z.label}"` : `"${id}"`;
  };
  const hw = w.width / 2, hh = w.height / 2;

  // goals
  if (w.goals.length === 0) out.push({ level: "info", text: "No goals yet — students will see no \"challenge complete\"." });
  w.goals.forEach((g, i) => {
    const n = `Goal ${i + 1} (${GOAL_LABELS[g.type]})`;
    const need = (id: string) => {
      if (!id) out.push({ level: "error", text: `${n} needs a zone.`, goal: i });
      else if (!zoneIds.has(id)) out.push({ level: "error", text: `${n} uses zone "${id}", which no longer exists.`, goal: i });
    };
    switch (g.type) {
      case "reachZone": need(g.zone); break;
      case "objectsInZone": {
        need(g.zone);
        const avail = w.objects.filter((o) => o.movable && (!g.color || o.color === g.color)).length;
        if (g.count > avail)
          out.push({ level: "error", text: `${n} needs ${g.count} ${g.color ? g.color.toLowerCase() + " " : ""}movable object(s), but the level has ${avail}.`, goal: i });
        if (zoneIds.has(g.zone)) {
          const z = w.zones.find((q) => q.id === g.zone)!;
          const already = w.objects.filter((o) => (!g.color || o.color === g.color) && (z.kind === "rect"
            ? pointInRect(o, z.x, z.y, z.w, z.h)
            : Math.hypot(o.x - z.x, o.y - z.y) <= z.r)).length;
          if (already >= g.count) out.push({ level: "warn", text: `${n} is already complete at the start (enough objects are in ${zoneName(g.zone)}).`, goal: i });
        }
        break;
      }
      case "visitInOrder":
        if (g.zones.length === 0) out.push({ level: "error", text: `${n} has no zones to visit.`, goal: i });
        g.zones.forEach((z) => need(z));
        break;
      case "maxTime":
        if (!(g.seconds > 0)) out.push({ level: "error", text: `${n} needs a time above 0 seconds.`, goal: i });
        break;
      default: break;
    }
  });

  // start pose
  const s = w.start;
  const r = ROBOT_SIZE / 2;
  if (Math.abs(s.x) > hw - r || Math.abs(s.y) > hh - r)
    out.push({ level: "error", text: "The robot start is outside the field or touching the border.", id: START_ID });
  for (const wl of w.walls) {
    if (distToSegment(s, wl.a, wl.b) < wl.thickness / 2 + r) {
      out.push({ level: "error", text: "The robot start is inside a wall.", id: START_ID });
      break;
    }
  }
  for (const o of w.objects) {
    if (Math.hypot(o.x - s.x, o.y - s.y) < o.size / 2 + r) {
      out.push({ level: "warn", text: `The robot starts on top of object "${o.id}".`, id: o.id });
    }
  }
  for (const z of w.zones) {
    const inside = z.kind === "rect" ? pointInRect(s, z.x, z.y, z.w, z.h) : Math.hypot(s.x - z.x, s.y - z.y) <= z.r;
    if (inside && w.goals.some((g) => g.type === "reachZone" && g.zone === z.id))
      out.push({ level: "warn", text: `The robot already starts inside goal zone ${zoneName(z.id)}.`, id: z.id });
  }

  // things outside the field
  for (const o of w.objects) {
    const e = o.size / 2;
    if (Math.abs(o.x) + e > hw || Math.abs(o.y) + e > hh)
      out.push({ level: "error", text: `Object "${o.id}" is outside the field.`, id: o.id });
    else if (w.walls.some((wl) => distToSegment(o, wl.a, wl.b) < wl.thickness / 2 + e * 0.9))
      out.push({ level: "warn", text: `Object "${o.id}" overlaps a wall.`, id: o.id });
  }
  for (const wl of w.walls) {
    if ([wl.a, wl.b].some((p) => Math.abs(p.x) > hw + 1 || Math.abs(p.y) > hh + 1))
      out.push({ level: "warn", text: `Wall "${wl.id}" goes outside the field.`, id: wl.id });
  }
  for (const z of w.zones) {
    const ex = z.kind === "rect" ? z.w / 2 : z.r, ey = z.kind === "rect" ? z.h / 2 : z.r;
    if (Math.abs(z.x) - ex > hw || Math.abs(z.y) - ey > hh)
      out.push({ level: "error", text: `Zone ${zoneName(z.id)} is outside the field.`, id: z.id });
  }
  for (const f of w.floor) {
    const outside = f.kind === "line"
      ? f.points.every((p) => Math.abs(p.x) > hw || Math.abs(p.y) > hh)
      : Math.abs(f.x) - (f.kind === "rect" ? f.w / 2 : f.r) > hw || Math.abs(f.y) - (f.kind === "rect" ? f.h / 2 : f.r) > hh;
    if (outside) out.push({ level: "warn", text: `Floor paint "${f.id}" is outside the field.`, id: f.id });
  }

  if (w.objects.some((o) => o.pickable) && !w.hardware?.magnet)
    out.push({ level: "info", text: "Some objects can be picked up, but the magnet is not fitted (Level settings)." });

  return out;
}
