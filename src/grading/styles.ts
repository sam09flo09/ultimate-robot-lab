/** Scoped CSS for the grading panel. Every selector starts with .gr- and uses the app's :root tokens. */
export const GRADING_CSS = `
.gr-root{display:flex;flex-direction:column;gap:10px;padding:12px 16px 24px;min-height:100%;font-size:15px;color:var(--ink)}
.gr-drop{border:2px dashed var(--sand);border-radius:12px;background:var(--paper);padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.gr-drop.gr-over{border-color:var(--orange);background:var(--line)}
.gr-drop h3{font-family:var(--serif);font-weight:400;font-size:24px;margin:0;flex-basis:100%}
.gr-drop p{margin:0;color:var(--gray);font-size:14px;flex:1 1 320px}
.gr-note{font-size:13px;color:var(--deep-text)}
.gr-prog{display:flex;align-items:center;gap:12px;background:var(--paper);border:1px solid var(--sand);border-radius:10px;padding:8px 12px}
.gr-prog progress{flex:1;height:12px;accent-color:var(--orange)}
.gr-prog span{font:600 14px var(--body);white-space:nowrap}
.gr-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.gr-spacer{flex:1}
.gr-count{font-family:var(--mono);font-size:11px;opacity:.8;margin-left:4px}
.gr-wrap{overflow:auto;border:1px solid var(--sand);border-radius:10px;background:#fff;flex:1 1 auto;min-height:160px}
.gr-table{border-collapse:collapse;width:100%;font-size:14px}
.gr-table th{position:sticky;top:0;z-index:1;background:var(--well);text-align:left;border-bottom:1px solid var(--sand);padding:0;white-space:nowrap}
.gr-sort{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:4px;width:100%;padding:8px 10px;min-height:40px;cursor:pointer;font:600 12.5px var(--body);color:var(--gray)}
.gr-sort:focus-visible{outline:3px solid var(--orange);outline-offset:-3px}
.gr-sort .gr-arrow{font-size:11px;color:var(--deep-text);min-width:10px}
.gr-table td{padding:6px 10px;border-bottom:1px solid var(--sand);vertical-align:top}
.gr-row{cursor:pointer}
.gr-row:hover td{background:#FFF7EF}
.gr-row.gr-open td{background:var(--line)}
.gr-name{all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:6px;align-items:flex-start;min-height:32px;font-weight:600;max-width:280px}
.gr-name:focus-visible{outline:3px solid var(--orange);outline-offset:2px;border-radius:4px}
.gr-name .gr-caret{font-size:11px;margin-top:3px;color:var(--deep-text);transition:transform .1s}
.gr-open .gr-caret{transform:rotate(90deg)}
.gr-name span{overflow-wrap:anywhere}
.gr-file{display:block;font:12px var(--mono);color:var(--gray);overflow-wrap:anywhere;font-weight:400}
.gr-badge{display:inline-block;font:600 12px var(--body);border-radius:999px;padding:2px 9px;white-space:nowrap}
.gr-pass{background:var(--greenbg);color:var(--green)}
.gr-fail{background:#FFF1DE;color:var(--deep-text)}
.gr-err{background:var(--redbg);color:var(--red)}
.gr-sub{display:block;font-size:12.5px;color:var(--gray);overflow-wrap:anywhere}
.gr-mono{font-family:var(--mono);font-size:13px}
.gr-detail td{background:var(--paper);padding:10px 14px 14px}
.gr-dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 18px}
.gr-dgrid h4{margin:0 0 4px;font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--deep-text)}
.gr-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.gr-list li{display:flex;gap:6px;align-items:baseline}
.gr-list .gr-ok{color:var(--green);font-weight:700}
.gr-list .gr-no{color:var(--red);font-weight:700}
.gr-list small{color:var(--gray)}
.gr-out{margin:0;font:12.5px var(--mono);white-space:pre-wrap;max-height:120px;overflow:auto;background:var(--well);border-radius:6px;padding:6px 8px}
.gr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.gr-code{margin-top:10px;height:260px;border:1px solid var(--sand);border-radius:8px;overflow:hidden;background:#fff}
.gr-code pre{margin:0;padding:8px;height:100%;overflow:auto;font:13px var(--mono);white-space:pre}
.gr-warn{color:var(--red);font-weight:600}
.gr-empty{padding:24px;text-align:center;color:var(--gray)}
.gr-privacy{font-size:12.5px;color:var(--gray)}
`;

let injected = false;
export function injectGradingStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("style");
  s.dataset.robotLab = "grading";
  s.textContent = GRADING_CSS;
  document.head.appendChild(s);
}
