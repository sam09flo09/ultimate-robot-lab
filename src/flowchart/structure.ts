/**
 * Flowchart graph → structured program (sequence / if-else / while), or a friendly error that
 * points at the shape or arrow that can't be structured.
 *
 * Method (reducible-graph pattern matching):
 *  1. Walk the shapes reachable from Start. Every End shape is the same virtual EXIT.
 *  2. Dominators (Cooper–Harvey–Kennedy). A back edge is an arrow u→h where h dominates u;
 *     h is a loop header. If cycles remain once back edges are removed the graph is irreducible:
 *     some arrow jumps into the middle of a loop → error on that arrow.
 *  3. Natural loops (merged per header) form a nesting forest. Each loop may have at most ONE
 *     arrow leaving it, from a diamond:
 *       - none                → `while True:` (forever)
 *       - from the header     → `while cond:` (test at the top)
 *       - from a later diamond x (every way round passes x) → the loop is rotated without `break`:
 *             P            (shapes from the header to x: the "priming" part)
 *             while stay(x):
 *                 S        (x's stay branch back to the header)
 *                 P
 *  4. Inside a loop body (or the top level) nested loops are collapsed to one step, so the region
 *     is acyclic; each diamond becomes if/else that rejoins at its immediate post-dominator.
 *     (Shapes reached by both branches without a common join are written in both branches.)
 */
import type { FlowChart, FlowEdge, FlowNode, Port } from "./model";
import { nodeLabel, nodeProblem, nodeVars } from "./model";

export const EXIT = "#exit";

export interface FlowError {
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export type Stmt =
  | { t: "do"; node: string }
  | { t: "if"; node: string; then: Stmt[]; else: Stmt[] }
  /** test: which branch of the diamond keeps looping ("yes" → `while c`, "no" → `while not c`). */
  | { t: "while"; node: string; test: "yes" | "no" | "forever"; body: Stmt[] };

export interface Structured {
  ok: boolean;
  body: Stmt[];
  error: FlowError | null;
  /** Shapes connected to Start (others are ignored and drawn faded). */
  reachable: Set<string>;
  vars: string[];
  nodes: Map<string, FlowNode>;
}

const MAX_STMTS = 3000;

class Unstructured extends Error {
  constructor(public fe: FlowError) { super(fe.message); }
}
const fail = (fe: FlowError): never => { throw new Unstructured(fe); };

interface Succ { port: Port; to: string; edge: FlowEdge; }
interface Loop {
  header: string;
  body: Set<string>;
  exit: { from: string; port: Port; to: string; edge: FlowEdge; stay: Port; stayTo: string } | null;
}

const quote = (n: FlowNode | undefined) => (n ? `“${nodeLabel(n)}”` : "the top of the loop");

export function structure(chart: FlowChart): Structured {
  const nodes = new Map(chart.nodes.map((n) => [n.id, n]));
  const reachable = new Set<string>();
  const result = (body: Stmt[], error: FlowError | null, vars: string[] = []): Structured =>
    ({ ok: !error, body, error, reachable, vars, nodes });
  try {
    const body = analyse(chart, nodes, reachable);
    const vars = new Set<string>();
    for (const id of reachable) {
      const n = nodes.get(id)!;
      const v = nodeVars(n);
      v.sets.forEach((x) => vars.add(x)); v.uses.forEach((x) => vars.add(x));
    }
    return result(body, null, [...vars].sort());
  } catch (e) {
    if (e instanceof Unstructured) return result([], e.fe);
    throw e;
  }
}

function analyse(chart: FlowChart, nodes: Map<string, FlowNode>, reachable: Set<string>): Stmt[] {
  // ---- start
  const starts = chart.nodes.filter((n) => n.kind === "start");
  if (!starts.length) fail({ message: "Add a Start shape: every flowchart begins at Start." });
  if (starts.length > 1) fail({ message: "A flowchart can only have one Start. Delete this one.", nodeId: starts[1].id });
  const start = starts[0].id;

  // ---- arrows (the first arrow from each port wins; arrows into Start are ignored)
  const out = new Map<string, Map<Port, FlowEdge>>();
  for (const e of chart.edges) {
    const to = nodes.get(e.to);
    if (!nodes.has(e.from) || !to || to.kind === "start") continue;
    if (!out.has(e.from)) out.set(e.from, new Map());
    const m = out.get(e.from)!;
    if (!m.has(e.port)) m.set(e.port, e);
  }
  const succCache = new Map<string, Succ[]>();
  const succ = (id: string): Succ[] => {
    let s = succCache.get(id);
    if (s) return s;
    const n = nodes.get(id)!;
    const ports: Port[] = n.kind === "decision" ? ["yes", "no"] : n.kind === "end" ? [] : ["out"];
    s = [];
    for (const p of ports) {
      const e = out.get(id)?.get(p);
      if (!e) continue;
      s.push({ port: p, to: nodes.get(e.to)!.kind === "end" ? EXIT : e.to, edge: e });
    }
    succCache.set(id, s);
    return s;
  };

  // ---- reachability (+ missing arrows / unfinished shapes, only for connected shapes)
  const order: string[] = []; // DFS preorder (yes before no)
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id); order.push(id);
    const s = succ(id);
    for (let i = s.length - 1; i >= 0; i--) if (s[i].to !== EXIT && !seen.has(s[i].to)) stack.push(s[i].to);
  }
  seen.forEach((id) => reachable.add(id));
  for (const n of chart.nodes) if (n.kind === "end" && hasArrowInFrom(chart, n.id, reachable)) reachable.add(n.id);

  const startSucc = succ(start);
  if (!startSucc.length) return []; // an empty program
  for (const id of order) {
    const n = nodes.get(id)!;
    if (n.kind === "decision") {
      const ports = new Set(succ(id).map((s) => s.port));
      if (!ports.has("yes")) fail({ message: "This diamond has no Yes arrow. Drag from its Yes dot to the shape to do when the answer is yes.", nodeId: id });
      if (!ports.has("no")) fail({ message: "This diamond has no No arrow. Drag from its No dot to the shape to do when the answer is no.", nodeId: id });
    } else if (n.kind !== "end" && n.kind !== "start" && !succ(id).length) {
      fail({ message: "This shape has no arrow coming out of it. Drag from the dot at its bottom to the next shape (or to an End shape).", nodeId: id });
    }
    const p = nodeProblem(n);
    if (p) fail({ message: p, nodeId: id });
  }

  // ---- dominators over the connected shapes (EXIT excluded)
  const rpo = reversePostorder(start, succ);
  const index = new Map(rpo.map((id, i) => [id, i]));
  const preds = new Map<string, string[]>(rpo.map((id) => [id, []]));
  for (const id of rpo) for (const s of succ(id)) if (s.to !== EXIT) preds.get(s.to)!.push(id);
  const idom = new Map<string, string>([[start, start]]);
  const intersect = (a: string, b: string) => {
    while (a !== b) {
      while (index.get(a)! > index.get(b)!) a = idom.get(a)!;
      while (index.get(b)! > index.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const id of rpo) {
      if (id === start) continue;
      let nd: string | null = null;
      for (const p of preds.get(id)!) if (idom.has(p)) nd = nd === null ? p : intersect(p, nd);
      if (nd !== null && idom.get(id) !== nd) { idom.set(id, nd); changed = true; }
    }
  }
  const dominates = (a: string, b: string) => {
    for (let x = b; ; x = idom.get(x)!) { if (x === a) return true; if (x === start) return a === start; }
  };

  // ---- back edges, then check what's left is acyclic (reducible)
  const isBack = (from: string, to: string) => to !== EXIT && dominates(to, from);
  checkReducible(rpo, succ, isBack, index, nodes);

  // ---- natural loops, merged per header
  const loops = new Map<string, Loop>();
  for (const u of rpo) for (const s of succ(u)) {
    if (!isBack(u, s.to)) continue;
    const h = s.to;
    const L = loops.get(h) ?? { header: h, body: new Set([h]), exit: null };
    loops.set(h, L);
    const work = [u];
    while (work.length) {
      const x = work.pop()!;
      if (L.body.has(x)) continue;
      L.body.add(x);
      for (const p of preds.get(x)!) work.push(p);
    }
  }
  const loopList = [...loops.values()].sort((a, b) => a.body.size - b.body.size || index.get(a.header)! - index.get(b.header)!);
  const innermost = (id: string) => loopList.find((L) => L.body.has(id)) ?? null;

  for (const L of loopList) {
    const exits: { from: string; s: Succ }[] = [];
    for (const id of rpo) {
      if (!L.body.has(id)) continue;
      for (const s of succ(id)) if (s.to === EXIT || !L.body.has(s.to)) exits.push({ from: id, s });
    }
    if (exits.length > 1) {
      fail({
        message: `This arrow is a second way out of the loop that starts at ${quote(nodes.get(L.header))}. ` +
          "A loop can only have one way out: one diamond whose arrow leaves the loop. Try making a single diamond decide when the loop ends.",
        edgeId: exits[1].s.edge.id,
      });
    }
    if (!exits.length) continue;
    const { from: x, s } = exits[0];
    const inner = innermost(x);
    if (inner !== L) {
      fail({
        message: `This arrow leaves two loops at once. Make the inner loop (starting at ${quote(nodes.get(inner!.header))}) end first, ` +
          `then use a diamond in the outer loop to leave it.`,
        edgeId: s.edge.id,
      });
    }
    const stay = succ(x).find((q) => q.port !== s.port)!;
    if (x !== L.header) {
      // every way round the loop must pass through x
      const reach = new Set<string>();
      const work = succ(L.header).filter((q) => L.body.has(q.to) && q.to !== x);
      while (work.length) {
        const q = work.pop()!;
        if (q.to === L.header) {
          fail({
            message: `This arrow goes back to the top of the loop without passing the diamond ${quote(nodes.get(x))} that ends the loop. ` +
              "Connect it to that diamond's path instead, so every trip round the loop asks the question.",
            edgeId: q.edge.id,
          });
        }
        if (reach.has(q.to)) continue;
        reach.add(q.to);
        for (const r of succ(q.to)) if (r.to !== EXIT && L.body.has(r.to) && r.to !== x) work.push(r);
      }
    }
    L.exit = { from: x, port: s.port, to: s.to, edge: s.edge, stay: stay.port, stayTo: stay.to };
  }

  // ---- emit
  let count = 0;
  const bump = () => {
    if (++count > MAX_STMTS) fail({ message: "This flowchart is too tangled to turn into Python. Try using fewer arrows that cross between branches." });
  };

  /** Successors inside a region: nested loops are one step (to their exit), stop shapes end the region. */
  const csucc = (n: string, stop: Set<string>, origin: string): string[] => {
    if (n === EXIT || n === origin || stop.has(n)) return [];
    const L = loops.get(n);
    if (L) return L.exit ? [L.exit.to] : [];
    return succ(n).map((s) => s.to);
  };

  /** Immediate post-dominator of decision d inside the region (null = the branches never meet). */
  const mergePoint = (d: string, stop: Set<string>): string | null => {
    const topo: string[] = [];
    const state = new Map<string, 1 | 2>();
    const visit = (n: string) => {
      const st = state.get(n);
      if (st === 2) return;
      if (st === 1) fail({ message: "This part of the flowchart loops in a way Robot Lab can't follow. Check the arrows that go back up.", nodeId: d });
      state.set(n, 1);
      for (const s of csucc(n, stop, d)) visit(s);
      state.set(n, 2);
      topo.push(n); // post-order: successors first
    };
    const roots = succ(d).map((s) => s.to);
    for (const r of roots) visit(r);
    const pdom = new Map<string, Set<string>>();
    const meet = (ss: string[]): Set<string> => {
      let acc: Set<string> | null = null;
      for (const s of ss) {
        const ps: Set<string> = pdom.get(s)!;
        const prev: Set<string> | null = acc;
        acc = prev === null ? new Set(ps) : new Set([...prev].filter((v: string) => ps.has(v)));
      }
      return acc ?? new Set<string>();
    };
    for (const n of topo) { const m = meet(csucc(n, stop, d)); m.add(n); pdom.set(n, m); }
    let best: string | null = null, bestSize = -1;
    for (const p of meet(roots)) {
      if (p === d) continue;
      const size = pdom.get(p)!.size;
      if (size > bestSize) { best = p; bestSize = size; }
    }
    return best;
  };

  const emitSeq = (from: string, stop: Set<string>, suppress: string | null): Stmt[] => {
    const outStmts: Stmt[] = [];
    let n = from, first = true;
    for (;;) {
      if (n === EXIT) break;
      const resumed = first && suppress === n;
      if (!resumed && stop.has(n)) break;
      first = false;
      const L = resumed ? undefined : loops.get(n);
      if (L) {
        outStmts.push(...emitLoop(L));
        if (!L.exit) break;
        n = L.exit.to;
        continue;
      }
      bump();
      const node = nodes.get(n)!;
      if (node.kind === "decision") {
        const m = mergePoint(n, stop);
        const inner = new Set(stop);
        if (m !== null) inner.add(m);
        const [y, no] = [succ(n).find((s) => s.port === "yes")!, succ(n).find((s) => s.port === "no")!];
        outStmts.push({ t: "if", node: n, then: emitSeq(y.to, inner, null), else: emitSeq(no.to, inner, null) });
        if (m === null) break;
        n = m;
      } else {
        outStmts.push({ t: "do", node: n });
        n = succ(n)[0].to;
      }
    }
    return outStmts;
  };

  const emitLoop = (L: Loop): Stmt[] => {
    const h = L.header;
    bump();
    if (!L.exit) return [{ t: "while", node: h, test: "forever", body: emitSeq(h, new Set([h]), h) }];
    const { from: x, stay, stayTo } = L.exit;
    const test = stay === "yes" ? "yes" : "no";
    const S = stayTo === h ? [] : emitSeq(stayTo, new Set([h]), null);
    if (x === h) return [{ t: "while", node: h, test, body: S }];
    const P = emitSeq(h, new Set([x]), h);
    return [...P, { t: "while", node: x, test, body: [...S, ...emitSeq(h, new Set([x]), h)] }];
  };

  return emitSeq(startSucc[0].to, new Set(), null);
}

function hasArrowInFrom(chart: FlowChart, id: string, from: Set<string>): boolean {
  return chart.edges.some((e) => e.to === id && from.has(e.from));
}

function reversePostorder(start: string, succ: (id: string) => Succ[]): string[] {
  const post: string[] = [];
  const seen = new Set<string>([start]);
  const stack: { id: string; i: number }[] = [{ id: start, i: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const s = succ(top.id);
    if (top.i < s.length) {
      const to = s[top.i++].to;
      if (to !== EXIT && !seen.has(to)) { seen.add(to); stack.push({ id: to, i: 0 }); }
    } else { post.push(top.id); stack.pop(); }
  }
  return post.reverse();
}

/** Without back edges the graph must be acyclic. Otherwise find the arrow that jumps into a loop. */
function checkReducible(rpo: string[], succ: (id: string) => Succ[], isBack: (a: string, b: string) => boolean,
  index: Map<string, number>, nodes: Map<string, FlowNode>): void {
  const color = new Map<string, 1 | 2>();
  let bad: { u: string; v: string; edge: FlowEdge } | null = null;
  const stack: { id: string; i: number }[] = [{ id: rpo[0], i: 0 }];
  color.set(rpo[0], 1);
  while (stack.length && !bad) {
    const top = stack[stack.length - 1];
    const s = succ(top.id);
    if (top.i < s.length) {
      const q = s[top.i++];
      if (q.to === EXIT || isBack(top.id, q.to)) continue;
      const c = color.get(q.to);
      if (c === 1) { bad = { u: top.id, v: q.to, edge: q.edge }; break; }
      if (!c) { color.set(q.to, 1); stack.push({ id: q.to, i: 0 }); }
    } else { color.set(top.id, 2); stack.pop(); }
  }
  if (!bad) return;
  // C = shapes on the cycle through u→v: reachable from v and able to reach u.
  const fwd = new Set<string>();
  const w1 = [bad.v];
  while (w1.length) { const x = w1.pop()!; if (fwd.has(x)) continue; fwd.add(x); for (const s of succ(x)) if (s.to !== EXIT) w1.push(s.to); }
  const preds = new Map<string, string[]>();
  for (const id of rpo) for (const s of succ(id)) if (s.to !== EXIT) { if (!preds.has(s.to)) preds.set(s.to, []); preds.get(s.to)!.push(id); }
  const C = new Set<string>();
  const w2 = [bad.u];
  while (w2.length) { const x = w2.pop()!; if (C.has(x) || !fwd.has(x)) continue; C.add(x); for (const p of preds.get(x) ?? []) w2.push(p); }
  const entries: { from: string; to: string; edge: FlowEdge }[] = [];
  for (const id of rpo) if (!C.has(id)) for (const s of succ(id)) if (C.has(s.to)) entries.push({ from: id, to: s.to, edge: s.edge });
  const top = entries.reduce<string | null>((best, e) => (best === null || index.get(e.to)! < index.get(best)! ? e.to : best), null) ?? bad.v;
  const culprit = entries.filter((e) => e.to !== top).sort((a, b) => index.get(b.from)! - index.get(a.from)!)[0];
  fail({
    message: `This arrow jumps into the middle of a loop. A loop can only be entered at its top — try connecting it to ${quote(nodes.get(top))} instead.`,
    edgeId: culprit ? culprit.edge.id : bad.edge.id,
  });
}
