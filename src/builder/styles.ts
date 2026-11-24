/** builder: scoped CSS for the Robot Builder panel. Every selector starts with .rb- so it can't leak. */
export const BUILDER_CSS = `
.rb-back{position:fixed;inset:0;z-index:70;background:rgba(12,11,10,.38);display:grid;place-items:center;padding:12px}
.rb{background:var(--paper,#FFFDF9);color:var(--ink,#0C0B0A);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);
  width:min(980px,100%);max-height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;font-size:14px}
.rb *{box-sizing:border-box}
.rb-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--sand,#E9E0D2)}
.rb-head h2{font-family:var(--serif,Georgia,serif);font-weight:400;font-size:26px;margin:0}
.rb-head .rb-sub{color:var(--gray,#5E584E);font-size:13px}
.rb-head .rb-x{margin-left:auto}
.rb-body{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;padding:12px 16px;overflow:auto;min-height:0}
.rb-left{display:flex;flex-direction:column;gap:10px;min-width:0}
.rb-preview{width:100%;aspect-ratio:1/1;border:1px solid var(--sand,#E9E0D2);border-radius:12px;overflow:hidden;background:#fff;position:relative}
.rb-preview canvas{width:100%;height:100%;display:block}
.rb-preview .rb-scale{position:absolute;left:8px;bottom:6px;font:11px var(--mono,monospace);color:var(--gray,#5E584E);background:rgba(255,255,255,.85);padding:1px 5px;border-radius:4px}
.rb-card{border:1px solid var(--sand,#E9E0D2);border-radius:12px;padding:8px 10px;background:var(--well,#F6F1E8)}
.rb-card h3{margin:0 0 4px;font:600 15px var(--body,sans-serif)}
.rb-card dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0;font-size:13px}
.rb-card dt{color:var(--gray,#5E584E)}
.rb-card dd{margin:0;font-family:var(--mono,monospace);font-size:12.5px}
.rb-right{display:flex;flex-direction:column;gap:10px;min-width:0}
.rb-lock{background:#FFF4E5;border:1px solid #F2C230;border-radius:10px;padding:8px 10px;line-height:1.4}
.rb-row{display:grid;grid-template-columns:120px minmax(0,1fr);align-items:center;gap:10px}
.rb-row>label,.rb-row>.rb-lbl{font-weight:600}
.rb-row input[type=text]{font:inherit;border:1px solid var(--sand,#E9E0D2);border-radius:8px;padding:6px 8px;min-height:36px;width:100%;max-width:280px}
.rb-range{display:flex;align-items:center;gap:10px}
.rb-range input{flex:1;accent-color:var(--orange,#FF6A1A);min-height:32px}
.rb-range output{font-family:var(--mono,monospace);font-size:12.5px;min-width:64px;text-align:right}
.rb-choices{display:flex;gap:6px;flex-wrap:wrap}
.rb-choice{border:2px solid var(--sand,#E9E0D2);background:#fff;border-radius:10px;padding:4px 8px;min-height:44px;min-width:58px;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font:600 12.5px var(--body,sans-serif);color:inherit}
.rb-choice small{font-weight:400;color:var(--gray,#5E584E);font-size:11px}
.rb-choice[aria-checked=true]{border-color:var(--orange,#FF6A1A);background:#FFF3EA}
.rb-choice:disabled{opacity:.5;cursor:not-allowed}
.rb-choice svg{display:block}
.rb-stats{display:grid;grid-template-columns:118px minmax(0,1fr) 92px;gap:6px 10px;align-items:center;border-top:1px solid var(--sand,#E9E0D2);padding-top:10px}
.rb-stats .rb-k{font-weight:600}
.rb-bar{height:12px;border-radius:6px;background:var(--well,#F6F1E8);position:relative;overflow:hidden;border:1px solid var(--sand,#E9E0D2)}
.rb-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:var(--orange,#FF6A1A);transition:width .2s}
.rb-bar b{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--ink,#0C0B0A);opacity:.55}
.rb-stats .rb-v{font-family:var(--mono,monospace);font-size:12.5px;text-align:right}
.rb-tips{margin:0;padding:8px 10px 8px 26px;background:#F3F8FF;border:1px solid #CFE0F7;border-radius:10px;line-height:1.45}
.rb-tips li{margin:1px 0}
.rb-foot{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--sand,#E9E0D2)}
.rb-foot .rb-state{color:var(--gray,#5E584E);font-size:13px;margin-right:auto}
@media (max-width:760px){.rb-body{grid-template-columns:1fr}.rb-preview{max-width:300px;margin:0 auto}}
`;
