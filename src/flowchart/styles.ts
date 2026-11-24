/** Flowchart editor CSS (injected once, like the blocks editor's). Uses the app's palette. */
export const FLOW_CSS = `
.fc{position:absolute;inset:0;display:flex;flex-direction:column;background:#FDF9F2;outline:none}
.fc-bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:5px 6px;background:#FFFDF9;border-bottom:1px solid #E9E0D2;flex:0 0 auto}
.fc-pal,.fc-tools{display:flex;gap:4px;flex-wrap:wrap}
.fc-pal-btn{display:inline-flex;align-items:center;gap:4px;min-height:40px;padding:0 7px 0 5px;border:1px solid #E9E0D2;border-radius:8px;
  background:#fff;font:600 12.5px Geist,"Segoe UI",Roboto,Arial,sans-serif;color:#0C0B0A;cursor:grab;touch-action:none;user-select:none}
.fc-pal-btn:hover:not(:disabled){border-color:#5E584E}
.fc-pal-btn:active{cursor:grabbing}
.fc-tool{min-width:40px;min-height:40px;border:1px solid #E9E0D2;border-radius:8px;background:#fff;font:600 17px Geist,"Segoe UI",Roboto,Arial,sans-serif;color:#0C0B0A;cursor:pointer;padding:0 8px}
.fc-tool-text{font-size:13px}
.fc-tool:hover:not(:disabled),.fc-tpl:hover:not(:disabled){border-color:#5E584E}
.fc-bar button:disabled,.fc-bar select:disabled{opacity:.4;cursor:not-allowed}
.fc-tpl{min-height:40px;border:1px solid #E9E0D2;border-radius:8px;background:#fff;font:600 13px Geist,"Segoe UI",Roboto,Arial,sans-serif;padding:0 4px;max-width:120px}
.fc-sep{width:1px;align-self:stretch;background:#E9E0D2;margin:2px 3px}
.fc-stage{position:relative;flex:1;min-height:0;overflow:hidden}
.fc-svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;cursor:default}
.fc-node{cursor:grab}
.fc-node .fc-glow{stroke:none}
.fc-node.fc-sel .fc-glow{stroke:#FF6A1A;stroke-width:3;stroke-dasharray:6 4}
.fc-node.fc-run .fc-shape{stroke:#FF6A1A;stroke-width:5;filter:drop-shadow(0 0 8px rgba(255,106,26,.9))}
.fc-node.fc-run .fc-glow{stroke:#FF6A1A;stroke-width:4;fill:rgba(255,106,26,.12)}
.fc-node.fc-bad .fc-shape{stroke:#B3261E;stroke-width:4}
.fc-node.fc-bad .fc-glow{stroke:#B3261E;stroke-width:3}
.fc-node.fc-off,.fc-edge.fc-off{opacity:.45}
.fc-node.fc-drop .fc-glow{stroke:#1E6B3A;stroke-width:4}
.fc-port{cursor:crosshair}
.fc-port .fc-port-dot{transition:r .1s}
.fc-port:hover .fc-port-dot,.fc-port.fc-armed .fc-port-dot{r:10;fill:#FF6A1A}
.fc-port.fc-used .fc-port-dot{fill:#5E584E}
.fc-ro .fc-port{display:none}
.fc-ro .fc-node{cursor:default}
.fc-edge{cursor:pointer}
.fc-edge:hover .fc-edge-line{stroke-width:3.5}
.fc-banner{position:absolute;left:8px;right:8px;bottom:8px;z-index:5;display:flex;align-items:center;gap:8px;background:#FBE9E7;color:#B3261E;
  border:1px solid #F2C4BF;border-radius:8px;padding:6px 8px;font:500 13.5px/1.35 Geist,"Segoe UI",Roboto,Arial,sans-serif}
.fc-banner-ico{font-size:18px}
.fc-banner-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fc-banner-btn{min-height:36px;border:1px solid #B3261E;background:#fff;color:#B3261E;border-radius:7px;font:600 13px Geist,"Segoe UI",Roboto,Arial,sans-serif;padding:0 10px;cursor:pointer}
.fc-hint{position:absolute;left:50%;top:8px;transform:translate(-50%,-8px);z-index:6;background:#0C0B0A;color:#fff;border-radius:8px;padding:6px 12px;
  font:500 13px Geist,"Segoe UI",Roboto,Arial,sans-serif;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:90%}
.fc-hint.show{opacity:1;transform:translate(-50%,0)}
.fc-panel{position:absolute;right:8px;top:62px;z-index:7;width:236px;max-height:calc(100% - 72px);overflow:auto;background:#FFFDF9;
  border:1px solid #E9E0D2;border-radius:10px;box-shadow:0 8px 24px rgba(12,11,10,.14);padding:8px 10px 10px;font:14px Geist,"Segoe UI",Roboto,Arial,sans-serif}
.fc-panel-head{display:flex;align-items:center;justify-content:space-between}
.fc-panel h3{margin:0;font:700 12px ui-monospace,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.06em;color:#A3400A}
.fc-x{min-width:36px;min-height:36px;border:0;background:transparent;font-size:16px;cursor:pointer;border-radius:6px}
.fc-x:hover{background:#E9E0D2}
.fc-row{display:flex;flex-direction:column;gap:2px;margin:6px 0}
.fc-row span{font-size:12px;color:#5E584E;font-weight:600}
.fc-row select,.fc-row input{min-height:38px;border:1px solid #E9E0D2;border-radius:7px;background:#fff;font:500 14px Geist,"Segoe UI",Roboto,Arial,sans-serif;padding:0 6px;color:#0C0B0A;width:100%;box-sizing:border-box}
.fc-row input{font-family:ui-monospace,Menlo,Consolas,monospace}
.fc-row select:focus,.fc-row input:focus{outline:none;border-color:#FF6A1A;box-shadow:0 0 0 3px rgba(255,106,26,.25)}
.fc-row input.fc-invalid{border-color:#B3261E;background:#FBE9E7}
.fc-note{margin:6px 0;font-size:12.5px;color:#5E584E;line-height:1.35}
.fc-problem{margin:6px 0;font-size:12.5px;color:#B3261E;font-weight:600;line-height:1.35}
.fc-del{margin-top:6px;min-height:38px;width:100%;border:1px solid #F2C4BF;background:#fff;color:#B3261E;border-radius:8px;font:600 13px Geist,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer}
.fc-del:hover:not(:disabled){background:#FBE9E7}
.fc-ghost{position:fixed;z-index:1000;transform:translate(-50%,-50%);pointer-events:none;padding:10px 16px;border-radius:8px;border:2px solid #D6540E;
  background:#FFE1C9;font:700 14px Geist,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 6px 18px rgba(12,11,10,.2)}
.fc-ghost.fc-k-decision{background:#FFF1B8;border-color:#9A7400}
.fc-ghost.fc-k-input{background:#DCEBFA;border-color:#2B5C8A}
.fc-ghost.fc-k-output{background:#EDE3F7;border-color:#6A3F94}
.fc-ghost.fc-k-end{background:#0C0B0A;color:#fff;border-color:#0C0B0A}
.fc-zoom{position:absolute;right:8px;bottom:8px;z-index:4;display:flex;flex-direction:column;gap:4px}
.fc-zoom .fc-tool{box-shadow:0 1px 3px rgba(12,11,10,.12)}
.fc-banner{right:58px}
.fc-narrow .fc-panel{position:relative;right:auto;top:auto;width:auto;max-height:44%;flex:0 0 auto;border-radius:0;border-width:1px 0 0;
  box-shadow:0 -4px 12px rgba(12,11,10,.08);display:flex;flex-wrap:wrap;align-content:flex-start;gap:0 8px;padding:4px 10px 8px}
.fc-narrow .fc-panel[hidden]{display:none}
.fc-narrow .fc-panel>*{flex:1 1 100%}
.fc-narrow .fc-panel>.fc-row{flex:1 1 120px;margin:3px 0}
.fc-narrow .fc-panel>.fc-del{flex:0 1 140px;margin-top:20px}
`;
