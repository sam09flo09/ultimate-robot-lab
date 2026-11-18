/** Scoped CSS for the level editor. Every selector starts with .le- so it can't leak into the app. */
export const EDITOR_CSS = `
.le-root{--le-cream:#FDF9F2;--le-ink:#0C0B0A;--le-orange:#FF6A1A;--le-deep:#D6540E;--le-sand:#E9E0D2;--le-paper:#FFFDF9;
  --le-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Roboto Mono",monospace;
  position:relative;display:grid;grid-template-columns:64px minmax(0,1fr) 300px;grid-template-rows:52px 44px minmax(0,1fr);
  width:100%;height:100%;min-height:0;overflow:hidden;background:var(--le-cream);color:var(--le-ink);
  font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box;outline:none}
.le-root *,.le-root *::before,.le-root *::after{box-sizing:border-box}
.le-root button,.le-root input,.le-root select,.le-root textarea{font:inherit;color:inherit}
.le-header{grid-column:1/4;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:2px solid var(--le-ink);background:var(--le-paper);min-width:0}
.le-title{font:700 12px var(--le-mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;margin-right:6px}
.le-title b{color:var(--le-orange)}
.le-spacer{flex:1 1 auto}
.le-btn{min-height:40px;min-width:40px;padding:0 12px;border:2px solid var(--le-ink);border-radius:10px;background:var(--le-paper);
  cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;touch-action:manipulation}
.le-btn:hover{background:var(--le-sand)}
.le-btn:disabled{opacity:.35;cursor:default;background:var(--le-paper)}
.le-btn:focus-visible,.le-tool:focus-visible,.le-tab:focus-visible{outline:3px solid var(--le-orange);outline-offset:1px}
.le-btn.le-primary{background:var(--le-orange);border-color:var(--le-deep);color:#fff;font-weight:700}
.le-btn.le-primary:hover{background:var(--le-deep)}
.le-btn.le-small{min-height:32px;min-width:32px;padding:0 8px;border-radius:8px;font-size:13px}
.le-btn.le-danger{border-color:#A3261C;color:#A3261C}
.le-btn[aria-pressed="true"]{background:var(--le-ink);color:var(--le-paper)}
.le-group{display:flex;align-items:center;gap:4px}
.le-sep{width:2px;height:28px;background:var(--le-sand);margin:0 4px}
.le-rail{grid-row:2/4;display:flex;flex-direction:column;gap:4px;padding:6px;border-right:2px solid var(--le-ink);background:var(--le-paper);overflow-y:auto;overflow-x:hidden}
.le-tool{width:50px;min-height:46px;border:2px solid transparent;border-radius:10px;background:none;cursor:pointer;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:1px;padding:2px;touch-action:manipulation}
.le-tool svg{width:22px;height:22px}
.le-tool span{font:600 9px var(--le-mono);letter-spacing:.03em;text-transform:uppercase}
.le-tool:hover{background:var(--le-sand)}
.le-tool[aria-pressed="true"]{background:var(--le-ink);color:var(--le-paper);border-color:var(--le-ink)}
.le-opts{grid-column:2/3;display:flex;align-items:center;gap:10px;padding:0 10px;border-bottom:1px solid var(--le-sand);background:var(--le-cream);
  overflow-x:auto;white-space:nowrap;min-width:0}
.le-hint{font:12px var(--le-mono);color:#5b554d}
.le-stage{grid-column:2/3;grid-row:3/4;position:relative;min-width:0;min-height:0;overflow:hidden;background:var(--le-sand)}
.le-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.le-overlay{touch-action:none;cursor:default}
.le-side{grid-column:3/4;grid-row:2/4;display:flex;flex-direction:column;min-height:0;border-left:2px solid var(--le-ink);background:var(--le-paper)}
.le-tabs{display:flex;border-bottom:2px solid var(--le-ink);flex:0 0 auto}
.le-tab{flex:1;min-height:42px;border:0;background:none;cursor:pointer;font:700 11px var(--le-mono);letter-spacing:.06em;text-transform:uppercase;position:relative}
.le-tab[aria-selected="true"]{background:var(--le-ink);color:var(--le-paper)}
.le-badge{display:inline-block;min-width:16px;padding:0 4px;margin-left:4px;border-radius:8px;background:var(--le-orange);color:#fff;font-size:10px;line-height:16px}
.le-panel{flex:1 1 auto;overflow-y:auto;padding:10px 12px;min-height:0}
.le-panel h3{font:700 11px var(--le-mono);letter-spacing:.08em;text-transform:uppercase;margin:4px 0 8px;color:var(--le-deep)}
.le-field{display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:6px;margin:0 0 6px}
.le-field>label,.le-lab{font:11px var(--le-mono);text-transform:uppercase;letter-spacing:.04em;color:#5b554d}
.le-root input[type=number],.le-root input[type=text],.le-root select,.le-root textarea{width:100%;min-height:36px;padding:4px 8px;border:2px solid var(--le-sand);
  border-radius:8px;background:#fff;min-width:0}
.le-root input:focus,.le-root select:focus,.le-root textarea:focus{border-color:var(--le-orange);outline:none}
.le-root textarea{min-height:70px;resize:vertical;font:12px/1.4 var(--le-mono)}
.le-root textarea.le-code{min-height:160px}
.le-check{display:flex;align-items:center;gap:8px;min-height:36px;cursor:pointer}
.le-check input{width:20px;height:20px;accent-color:var(--le-orange)}
.le-opts .le-check{min-height:0}
.le-opts select,.le-opts input[type=number]{width:auto;min-height:34px}
.le-opts input[type=number]{width:76px}
.le-color{display:flex;gap:6px;align-items:center;min-width:0}
.le-swatch{flex:0 0 22px;height:22px;border-radius:6px;border:2px solid var(--le-ink)}
.le-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
.le-empty{color:#5b554d;font-size:13px;margin:8px 0}
.le-goal{border:2px solid var(--le-sand);border-radius:10px;padding:8px;margin:0 0 8px;background:var(--le-cream)}
.le-goal.le-bad{border-color:#D63B2F}
.le-goal-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.le-goal-head b{font:700 11px var(--le-mono);color:var(--le-deep)}
.le-goal-head select{flex:1}
.le-issues{flex:0 0 auto;max-height:132px;overflow-y:auto;border-top:2px solid var(--le-ink);padding:6px 10px;background:var(--le-cream)}
.le-issue{display:flex;gap:6px;align-items:flex-start;width:100%;text-align:left;border:0;background:none;padding:3px 0;font-size:12px;cursor:default}
.le-issue[data-target]{cursor:pointer}
.le-issue[data-target]:hover{text-decoration:underline}
.le-dot{flex:0 0 auto;font:700 10px var(--le-mono);padding:1px 4px;border-radius:4px;color:#fff;background:#5b554d}
.le-issue.le-error .le-dot{background:#D63B2F}
.le-issue.le-warn .le-dot{background:var(--le-deep)}
.le-ok{font-size:12px;color:#2E9E4F;font-weight:600}
.le-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:var(--le-ink);color:var(--le-paper);padding:8px 14px;border-radius:10px;
  font-size:13px;pointer-events:none;opacity:0;transition:opacity .2s;max-width:80%;z-index:5}
.le-toast.le-show{opacity:1}
.le-file{display:none}
@media (max-width:1100px){.le-root{grid-template-columns:60px minmax(0,1fr) 260px}.le-hide-narrow{display:none}}
`;
