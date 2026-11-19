/**
 * RichText → safe HTML. The markup is tiny (see core/activity.ts): paragraphs separated by blank
 * lines, **bold**, `code`, "- " bullet lines and fenced ``` code blocks. Every other character is
 * escaped, so the output can go straight into innerHTML. No attributes are ever emitted except
 * fixed class names.
 */

const MAX_TEXT = 50_000;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]!);
}

/** Inline markup only (`code` and **bold**). For one-line labels. */
export function renderInline(text: string): string {
  const s = String(text ?? "").slice(0, MAX_TEXT);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const tick = s.indexOf("`", i);
    if (tick < 0) { out += bold(s.slice(i)); break; }
    const end = s.indexOf("`", tick + 1);
    if (end < 0) { out += bold(s.slice(i)); break; }
    out += bold(s.slice(i, tick));
    const code = s.slice(tick + 1, end);
    out += code ? `<code>${escapeHtml(code)}</code>` : "&#96;&#96;";
    i = end + 1;
  }
  return out;
}

function bold(s: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const a = s.indexOf("**", i);
    const b = a < 0 ? -1 : s.indexOf("**", a + 2);
    if (a < 0 || b < 0) { out += escapeHtml(s.slice(i)); break; } // an unmatched "**" stays literal
    out += escapeHtml(s.slice(i, a));
    const inner = s.slice(a + 2, b);
    out += inner ? `<b>${escapeHtml(inner)}</b>` : "****";
    i = b + 2;
  }
  return out;
}

/** Full RichText (block level). */
export function renderRich(text: string): string {
  const lines = String(text ?? "").slice(0, MAX_TEXT).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(renderInline).join(" ")}</p>`); para = []; };
  const flushList = () => { if (list.length) out.push(`<ul>${list.map((l) => `<li>${renderInline(l)}</li>`).join("")}</ul>`); list = []; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.startsWith("```")) {
      flushPara(); flushList();
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "```") { code.push(lines[j]); j++; }
      out.push(`<pre class="act-code"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      i = j; // skip the closing fence (or run off the end)
      continue;
    }
    if (t === "") { flushPara(); flushList(); continue; }
    if (/^[-*] /.test(t)) { flushPara(); list.push(t.slice(2)); continue; }
    flushList();
    para.push(t);
  }
  flushPara(); flushList();
  return out.join("");
}

/** Markup stripped to plain text (for titles, aria labels, tooltips). */
export function plainText(text: string): string {
  return String(text ?? "").slice(0, MAX_TEXT).replace(/```[a-z]*\n?/gi, "").replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}
