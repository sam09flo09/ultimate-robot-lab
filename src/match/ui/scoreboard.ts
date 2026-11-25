/**
 * match: scoreboard + end-screen markup. Team and project names come from files other students made,
 * so EVERYTHING user-provided goes through esc().
 */
import type { MatchScore, Team } from "../../core/match";
import { TEAM_COLOR } from "../../core/match";
import { esc } from "../../ui/dom";

export interface TeamNames { A: string; B: string; }

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The live bar: "Team A name  12 — 7  Team B name". */
export function scoreboardHtml(names: TeamNames, score: Pick<MatchScore, "A" | "B">): string {
  const side = (t: Team) =>
    `<div class="mt-team mt-${t.toLowerCase()}" style="--team:${TEAM_COLOR[t]}">` +
    `<span class="mt-badge" aria-hidden="true">${t}</span>` +
    `<span class="mt-name" title="${esc(names[t])}">${esc(names[t])}</span>` +
    `<span class="mt-score" aria-label="Team ${t} score">${pts(score[t])}</span></div>`;
  return side("A") + side("B");
}

export type Winner = Team | "tie";
export function winnerOf(s: Pick<MatchScore, "A" | "B">): Winner {
  return s.A > s.B ? "A" : s.B > s.A ? "B" : "tie";
}

/** End screen: winner banner + the breakdown table for both teams. */
export function endSummaryHtml(names: TeamNames, score: MatchScore): string {
  const w = winnerOf(score);
  const banner = w === "tie"
    ? `<h2 class="me-win me-tie">It's a tie! ${pts(score.A)} – ${pts(score.B)}</h2>`
    : `<h2 class="me-win" style="--team:${TEAM_COLOR[w]}"><span class="mt-badge">${w}</span> ${esc(names[w])} wins!</h2>`;
  const col = (t: Team) => {
    const rows = score.lines.filter((l) => l.team === t);
    const body = rows.length
      ? rows.map((l) => `<tr><td>${esc(l.label)}${l.count !== undefined ? ` <span class="muted">×${esc(l.count)}</span>` : ""}</td><td class="me-pts">${pts(l.points)}</td></tr>`).join("")
      : `<tr><td colspan="2" class="muted">No points scored</td></tr>`;
    return `<div class="me-col" style="--team:${TEAM_COLOR[t]}"><h3><span class="mt-badge">${t}</span> ${esc(names[t])}</h3>` +
      `<table class="me-table"><tbody>${body}</tbody><tfoot><tr><th>Total</th><th class="me-pts">${pts(score[t])}</th></tr></tfoot></table></div>`;
  };
  const auto = score.autonomousWinner
    ? `<p class="me-auto">Autonomous period: ${score.autonomousWinner === "tie" ? "a tie" : `won by Team ${score.autonomousWinner} (${esc(names[score.autonomousWinner])})`}.</p>`
    : "";
  return banner + `<div class="me-cols">${col("A")}${col("B")}</div>` + auto;
}
