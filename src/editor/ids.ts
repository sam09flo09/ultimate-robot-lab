/** Id helpers for the level editor. Every editable item gets a unique id so it can be selected. */
import type { World } from "../core/types";

/** Ids we accept from files: short, safe characters only. */
export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const ID_PREFIX = { wall: "wall", floor: "paint", object: "obj", zone: "zone" } as const;

/** All ids currently used by walls, floor shapes, objects and zones. */
export function collectIds(w: World): Set<string> {
  const s = new Set<string>();
  for (const it of w.walls) if (it.id) s.add(it.id);
  for (const it of w.floor) if (it.id) s.add(it.id);
  for (const it of w.objects) if (it.id) s.add(it.id);
  for (const it of w.zones) if (it.id) s.add(it.id);
  return s;
}

/** Smallest `${prefix}${n}` (n >= 1) not in `used`. Adds it to `used`. */
export function nextId(used: Set<string>, prefix: string): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

/**
 * Give every wall / floor shape / object / zone a unique, valid id (mutates `w`, returns it).
 * The first item keeps a duplicated id; later duplicates are renamed. Goals keep pointing at the first.
 */
export function ensureIds(w: World): World {
  const used = new Set<string>();
  const fix = (item: { id?: string }, prefix: string) => {
    if (typeof item.id === "string" && ID_RE.test(item.id) && !used.has(item.id)) {
      used.add(item.id);
      return;
    }
    item.id = undefined;
  };
  w.walls.forEach((it) => fix(it, ID_PREFIX.wall));
  w.floor.forEach((it) => fix(it, ID_PREFIX.floor));
  w.objects.forEach((it) => fix(it, ID_PREFIX.object));
  w.zones.forEach((it) => fix(it, ID_PREFIX.zone));
  for (const it of w.walls) if (!it.id) it.id = nextId(used, ID_PREFIX.wall);
  for (const it of w.floor) if (!it.id) it.id = nextId(used, ID_PREFIX.floor);
  for (const it of w.objects) if (!it.id) it.id = nextId(used, ID_PREFIX.object);
  for (const it of w.zones) if (!it.id) it.id = nextId(used, ID_PREFIX.zone);
  return w;
}
