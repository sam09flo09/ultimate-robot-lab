/** Scoped CSS for the notebook dialog and the print view (injected once). Uses the app's :root tokens. */
import { NOTEBOOK_PAGE_CSS } from "./page";

const UI_CSS = `
.dlg.nb-dlg{max-width:1000px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;padding:14px 18px}
.nb-dlg h2{margin:0 0 6px}
.nb-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:14px;overflow:auto;min-height:0;flex:1 1 auto;padding:2px}
.nb-col{display:flex;flex-direction:column;gap:8px;min-width:0}
.nb-row{display:grid;grid-template-columns:1.3fr .8fr;gap:8px}
.nb-dlg label.nb-f{display:flex;flex-direction:column;gap:3px;font:600 13px var(--body);color:var(--ink)}
.nb-dlg input[type=text],.nb-dlg textarea{font:14px var(--body);border:1px solid var(--sand);border-radius:8px;padding:7px 9px;background:#fff;color:var(--ink);min-height:38px;width:100%;box-sizing:border-box}
.nb-dlg textarea{resize:vertical;min-height:56px;line-height:1.4}
.nb-dlg input:focus,.nb-dlg textarea:focus{outline:none;border-color:var(--gray);box-shadow:0 0 0 3px rgba(255,106,26,.35)}
.nb-hint{font:12px var(--body);color:var(--gray);margin:0}
.nb-runlist{list-style:none;margin:0;padding:0;border:1px solid var(--sand);border-radius:10px;background:#fff;overflow:auto;max-height:300px;min-height:80px}
.nb-runlist li{display:grid;grid-template-columns:40px 58px minmax(0,1fr);gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--sand)}
.nb-runlist li:last-child{border-bottom:0}
.nb-runlist li.nb-on{background:var(--line)}
.nb-runlist .nb-empty{display:block;color:var(--gray);font-size:14px;padding:12px}
.nb-star{all:unset;box-sizing:border-box;width:40px;height:40px;display:grid;place-items:center;font-size:22px;border-radius:8px;cursor:pointer;color:var(--gray)}
.nb-star[aria-pressed=true]{color:var(--deep)}
.nb-star:focus-visible{outline:3px solid var(--orange)}
.nb-thumb{width:58px;height:58px;object-fit:contain;background:var(--well);border:1px solid var(--sand);border-radius:6px}
.nb-thumb-none{display:grid;place-items:center;font-size:11px;color:var(--gray)}
.nb-rinfo{display:flex;flex-direction:column;gap:3px;min-width:0}
.nb-rtop{font:600 13px var(--body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nb-rsub{font:12px var(--mono);color:var(--gray);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nb-rinfo input[type=text]{min-height:32px;padding:4px 8px;font-size:13px}
.nb-inc{border:1px solid var(--sand);border-radius:10px;padding:6px 10px;margin:0;display:flex;flex-wrap:wrap;gap:0 14px}
.nb-inc legend{font:600 13px var(--body);padding:0 4px}
.nb-inc label{display:inline-flex;align-items:center;gap:6px;font-size:14px;min-height:34px;cursor:pointer}
.nb-inc input{width:18px;height:18px;accent-color:var(--deep)}
.nb-inc label.nb-off{opacity:.55;cursor:default}
.nb-btns{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:10px;flex-wrap:wrap}
.nb-btns .nb-privacy{margin-right:auto;font-size:12px;color:var(--gray);max-width:360px}
.btn-nb{min-width:40px;padding-left:8px;padding-right:8px}
/* print view: an in-page overlay; @media print shows only it */
.nb-view{position:fixed;inset:0;z-index:90;background:#d9d4cc;overflow:auto;display:flex;flex-direction:column}
.nb-viewbar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--paper);border-bottom:1px solid var(--sand);flex-wrap:wrap}
.nb-viewbar p{margin:0;font-size:13px;color:var(--gray);flex:1 1 260px}
.nb-sheet{margin:16px auto 40px;box-shadow:0 4px 20px rgba(0,0,0,.25);background:#fff;width:min(820px,calc(100% - 24px))}
@media print{
  @page{margin:12mm}
  html,body{height:auto !important;overflow:visible !important;background:#fff !important}
  body.nb-printing > *:not(.nb-view){display:none !important}
  body.nb-printing .nb-view{position:static;inset:auto;overflow:visible;background:#fff;display:block}
  body.nb-printing .nb-viewbar{display:none !important}
  body.nb-printing .nb-sheet{margin:0;box-shadow:none;width:auto}
  body.nb-printing .nb-page{padding:0;max-width:none}
}
`;

let injected = false;
export function injectNotebookCss(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("style");
  s.id = "nb-css";
  s.textContent = UI_CSS + NOTEBOOK_PAGE_CSS;
  document.head.appendChild(s);
}
