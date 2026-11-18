// Manual test page: `npx vite` then open /src/blocks/preview.html
import { createBlocksEditor } from "./index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeEl = $("code");
const stateEl = $("state");
let current = 0;

const editor = createBlocksEditor($("blocks"), {
  hardware: { pen: true, magnet: true },
  onChange: render,
});

function render() {
  const lines = editor.getPython().replace(/\n$/, "").split("\n");
  codeEl.innerHTML = "";
  lines.forEach((text, i) => {
    const s = document.createElement("span");
    s.textContent = text || " ";
    s.className = i + 1 === current ? "on" : "";
    s.onclick = () => highlight(i + 1);
    codeEl.appendChild(s);
  });
  stateEl.textContent = JSON.stringify(editor.getState()).length + " bytes of state";
}
function highlight(line: number) {
  current = current === line ? 0 : line;
  editor.highlightLine(current);
  render();
}

const hw = () => ({ pen: $<HTMLInputElement>("pen").checked, magnet: $<HTMLInputElement>("magnet").checked });
$("pen").onchange = $("magnet").onchange = () => editor.setHardware(hw());
$("ro").onchange = () => editor.setReadOnly($<HTMLInputElement>("ro").checked);
$("save").onclick = () => { try { localStorage.setItem("rl-blocks-preview", JSON.stringify(editor.getState())); } catch { /* private mode */ } };
$("load").onclick = () => {
  let s: unknown = null;
  try { s = JSON.parse(localStorage.getItem("rl-blocks-preview") ?? "null"); } catch { /* ignore */ }
  editor.setState(s); render();
};
$("garbage").onclick = () => { editor.setState({ blocks: { blocks: [{ type: "nope" }] } }); render(); };
$("step").onclick = () => {
  const n = editor.getPython().split("\n").length - 1;
  highlight(current >= n ? 1 : current + 1);
};
window.addEventListener("resize", () => editor.resize());
render();
(window as unknown as { editor: unknown }).editor = editor;
