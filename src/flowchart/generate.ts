/**
 * Structured flowchart → Python program + line map (lineMap[i] = id of the shape that produced
 * line i+1, or null). Program shape mirrors the blocks generator:
 *   variables = 0 / def main(): / global ... / body / start(main)
 */
import type { FlowChart } from "./model";
import { conditionCode, statementCode } from "./model";
import { structure, type FlowError, type Stmt, type Structured } from "./structure";

export interface FlowProgram {
  code: string;
  lineMap: (string | null)[];
  error: FlowError | null;
  /** Shapes connected to Start. */
  reachable: Set<string>;
}

const IND = "    ";

export function generateFlowchart(chart: FlowChart): FlowProgram {
  const s: Structured = structure(chart);
  const start = chart.nodes.find((n) => n.kind === "start")?.id ?? null;
  if (s.error) {
    const msg = s.error.message.replace(/\s+/g, " ");
    const code = `# This flowchart can't be turned into Python yet:\n# ${msg}\ndef main():\n${IND}pass\n\nstart(main)\n`;
    return { code, lineMap: code.split("\n").slice(0, -1).map(() => null), error: s.error, reachable: s.reachable };
  }
  const lines: { text: string; id: string | null }[] = [];
  const push = (text: string, id: string | null) => lines.push({ text, id });

  const emit = (stmts: Stmt[], ind: string): void => {
    for (const st of stmts) {
      const node = s.nodes.get(st.node)!;
      if (st.t === "do") {
        for (const l of statementCode(node) ?? []) push(ind + l, st.node);
      } else if (st.t === "if") {
        const c = conditionCode(node.args)!;
        if (!st.then.length && st.else.length) {
          push(`${ind}if ${c.negated}:`, st.node);
          emit(st.else, ind + IND);
        } else {
          push(`${ind}if ${c.code}:`, st.node);
          if (st.then.length) emit(st.then, ind + IND); else push(`${ind}${IND}pass`, st.node);
          if (st.else.length) { push(`${ind}else:`, st.node); emit(st.else, ind + IND); }
        }
      } else {
        if (st.test === "forever") push(`${ind}while True:`, st.node);
        else {
          const c = conditionCode(node.args)!;
          push(`${ind}while ${st.test === "yes" ? c.code : c.negated}:`, st.node);
        }
        if (st.body.length) emit(st.body, ind + IND);
        else push(`${ind}${IND}wait(5, MSEC)`, st.node); // keep checking without hogging the Chromebook
      }
    }
  };

  if (s.vars.length) {
    for (const v of s.vars) push(`${v} = 0`, null);
    push("", null);
  }
  push("def main():", start);
  if (s.vars.length) push(`${IND}global ${s.vars.join(", ")}`, start);
  const before = lines.length;
  emit(s.body, IND);
  if (lines.length === before) push(`${IND}pass`, start);
  push("", null);
  push("start(main)", start);
  return {
    code: lines.map((l) => l.text).join("\n") + "\n",
    lineMap: lines.map((l) => l.id),
    error: null,
    reachable: s.reachable,
  };
}
