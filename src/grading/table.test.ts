// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { invalidResult, type GradeResult } from "./grade";
import { filterEntries, renderBody, renderHead, sortEntries, type Entry } from "./table";

const EVIL = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;

function row(over: Partial<GradeResult>): GradeResult {
  return {
    ...invalidResult("x.robolab", ""), status: "finished", statusText: "Finished", verdict: "passed",
    goalsPassed: 1, goalsTotal: 1, finalPose: { x: 0, y: 0, heading: 0 }, ...over,
  };
}

const handlers = (detail?: (e: Entry) => HTMLElement) => ({
  onToggle: () => {}, onSort: () => {}, detail: detail ?? (() => document.createElement("div")),
});

describe("results table", () => {
  it("renders hostile file / project / world names as text, not markup", () => {
    const tbody = document.createElement("tbody");
    const r = row({ fileName: EVIL + ".robolab", projectName: EVIL, worldName: EVIL, statusText: EVIL, errorText: EVIL });
    renderBody(tbody, [{ id: 1, r }], new Set([1]), handlers((e) => { const d = document.createElement("div"); d.textContent = e.r.errorText; return d; }));
    expect(tbody.querySelector("img")).toBeNull();
    expect(tbody.querySelector("script")).toBeNull();
    expect(tbody.textContent).toContain(EVIL);
    expect(tbody.querySelectorAll("tr")).toHaveLength(2); // row + detail
    expect(tbody.querySelector(".gr-name")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("sorts and filters", () => {
    const list: Entry[] = [
      { id: 1, r: row({ projectName: "Cleo", verdict: "error", status: "error" }) },
      { id: 2, r: row({ projectName: "ana", goalsPassed: 0 , verdict: "notpassed" }) },
      { id: 3, r: row({ projectName: "Ben", savedAt: "2026-11-21T10:00:00Z" }) },
    ];
    expect(sortEntries(list, { key: "name", dir: 1 }).map((e) => e.r.projectName)).toEqual(["ana", "Ben", "Cleo"]);
    expect(sortEntries(list, { key: "name", dir: -1 }).map((e) => e.r.projectName)).toEqual(["Cleo", "Ben", "ana"]);
    expect(sortEntries(list, { key: "verdict", dir: 1 }).map((e) => e.id)).toEqual([3, 2, 1]);
    expect(sortEntries(list, { key: "saved", dir: -1 })[0].id).toBe(3);
    expect(filterEntries(list, "passed").map((e) => e.id)).toEqual([3]);
    expect(filterEntries(list, "error").map((e) => e.id)).toEqual([1]);
    expect(filterEntries(list, "all")).toHaveLength(3);
    const thead = document.createElement("thead");
    renderHead(thead, { key: "goals", dir: -1 }, handlers());
    const sorted = [...thead.querySelectorAll("th")].filter((t) => t.getAttribute("aria-sort") !== "none");
    expect(sorted).toHaveLength(1);
    expect(sorted[0].getAttribute("aria-sort")).toBe("descending");
  });
});
