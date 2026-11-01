/**
 * Renders an eval results JSON (written by eval-prompts.ts) as a standalone HTML report.
 * Usage: bun run scripts/eval-report.ts evals/results/<file>.json
 */
import { readFileSync, writeFileSync } from "fs";

export interface ReportEntry {
  id: string;
  run: number;
  tags: string[];
  input: string;
  context?: unknown;
  expect: unknown;
  pass: boolean;
  note?: string;
  failed: { field: string; expected: unknown; actual: unknown }[];
  results: { tipo: string; usa_contexto?: boolean; datos: Record<string, unknown> }[];
  rawResponse: string;
  latencyMs: number;
}

export interface ReportData {
  label: string;
  model: string;
  date: string;
  pass: number;
  total: number;
  report: ReportEntry[];
}

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
const json = (v: unknown) => esc(JSON.stringify(v, null, 2));

function bars(title: string, rows: [string, number, number][]): string {
  return `<section class="card"><h2>${esc(title)}</h2>${rows
    .map(([name, ok, total]) => {
      const p = pct(ok, total);
      const cls = p === 100 ? "good" : p >= 70 ? "warn" : "bad";
      return `<div class="bar"><span class="bar-name">${esc(name)}</span><span class="track"><span class="fill ${cls}" style="width:${p}%"></span></span><span class="bar-val">${ok}/${total} · ${p}%</span></div>`;
    })
    .join("")}</section>`;
}

function caseHtml(e: ReportEntry): string {
  const failedFields = new Set(e.failed.map((f) => f.field));
  const results = e.results
    .map((r) => {
      const cells = Object.entries({ tipo: r.tipo, ...r.datos, usa_contexto: r.usa_contexto })
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `<tr class="${failedFields.has(k) ? "diff" : ""}"><th>${esc(k)}</th><td>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>`)
        .join("");
      return `<table class="kv">${cells}</table>`;
    })
    .join("") || `<p class="muted">Sin transacciones</p>`;

  const diffs = e.failed.length
    ? `<table class="diffs"><tr><th>Campo</th><th>Esperado</th><th>Obtenido</th></tr>${e.failed
        .map((f) => `<tr><td>${esc(f.field)}</td><td>${esc(JSON.stringify(f.expected))}</td><td>${esc(JSON.stringify(f.actual))}</td></tr>`)
        .join("")}</table>`
    : "";

  return `<details class="case ${e.pass ? "ok" : "fail"}" data-status="${e.pass ? "ok" : "fail"}" data-tags="${esc(e.tags.join(" "))}">
  <summary><span class="badge ${e.pass ? "good" : "bad"}">${e.pass ? "OK" : "FALLÓ"}</span>
    <code class="id">${esc(e.id)}${e.run > 1 ? ` #${e.run}` : ""}</code>
    <span class="input">${esc(e.input)}</span>
    ${e.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
    <span class="muted lat">${e.latencyMs} ms</span></summary>
  <div class="body">
    ${e.note ? `<p class="note">${esc(e.note)}</p>` : ""}
    ${diffs}
    <div class="cols">
      <div><h3>Esperado</h3><pre>${json(e.expect)}</pre></div>
      <div><h3>Obtenido (después del pipeline del bot)</h3>${results}</div>
    </div>
    ${e.context ? `<h3>Contexto enviado al prompt</h3><pre>${json(e.context)}</pre>` : ""}
    <details><summary>Respuesta cruda de Gemini</summary><pre>${esc(e.rawResponse)}</pre></details>
  </div>
</details>`;
}

export function renderReport(data: ReportData): string {
  const byTag = new Map<string, [number, number]>();
  const byField = new Map<string, [number, number]>();
  for (const e of data.report) {
    for (const t of e.tags) {
      const v = byTag.get(t) ?? [0, 0];
      v[1]++;
      if (e.pass) v[0]++;
      byTag.set(t, v);
    }
  }
  // Field accuracy comes from failures only; total per field is not stored per entry, so count by case.
  for (const e of data.report) {
    for (const f of e.failed) {
      const v = byField.get(f.field) ?? [0, 0];
      v[1]++;
      byField.set(f.field, v);
    }
  }

  const avgLatency = data.report.length ? Math.round(data.report.reduce((s, e) => s + e.latencyMs, 0) / data.report.length) : 0;
  const failed = data.report.filter((e) => !e.pass);
  const rate = pct(data.pass, data.total);

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evals · ${esc(data.label)}</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--good:#16a34a;--warn:#d97706;--bad:#dc2626;--goodbg:#dcfce7;--badbg:#fee2e2;--code:#f5f5f4}
@media(prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--good:#4ade80;--warn:#fbbf24;--bad:#f87171;--goodbg:#14532d55;--badbg:#7f1d1d55;--code:#292524}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}h1{margin:0 0 4px;font-size:24px}h2{margin:0 0 12px;font-size:16px}h3{margin:12px 0 6px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.muted{color:var(--muted)}.sub{color:var(--muted);margin-bottom:20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.kpi,.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.kpi b{display:block;font-size:28px}.kpi span{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:24px}
.bar{display:grid;grid-template-columns:110px 1fr 90px;gap:8px;align-items:center;margin:6px 0;font-size:13px}.track{background:var(--code);border-radius:99px;height:8px;overflow:hidden}.fill{display:block;height:100%}.fill.good{background:var(--good)}.fill.warn{background:var(--warn)}.fill.bad{background:var(--bad)}.bar-val{text-align:right;color:var(--muted)}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:99px;padding:6px 14px;cursor:pointer}button.on{background:var(--fg);color:var(--bg)}
details.case{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--good);border-radius:10px;margin:8px 0}details.case.fail{border-left-color:var(--bad)}
details.case>summary{cursor:pointer;padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;list-style:none}details.case>summary::-webkit-details-marker{display:none}
.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}.badge.good{background:var(--goodbg);color:var(--good)}.badge.bad{background:var(--badbg);color:var(--bad)}
.id{font-size:12px;color:var(--muted)}.input{flex:1 1 220px;font-weight:500}.tag{font-size:11px;background:var(--code);padding:1px 8px;border-radius:99px;color:var(--muted)}.lat{font-size:12px;margin-left:auto}
.body{padding:0 14px 14px;border-top:1px solid var(--line)}.note{color:var(--bad);font-weight:600}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
pre{background:var(--code);padding:10px;border-radius:8px;overflow:auto;font-size:12px;margin:0;white-space:pre-wrap;word-break:break-word}
table{border-collapse:collapse;width:100%;font-size:13px}.kv{margin-bottom:8px}.kv th{text-align:left;color:var(--muted);font-weight:500;width:130px;padding:3px 8px 3px 0;vertical-align:top}.kv td{padding:3px 0}
tr.diff th,tr.diff td{color:var(--bad);font-weight:700;background:var(--badbg)}
.diffs{margin:10px 0}.diffs th,.diffs td{border:1px solid var(--line);padding:5px 8px;text-align:left}.diffs th{background:var(--code)}
</style></head><body><main>
<h1>Evals de prompts · ${esc(data.label)}</h1>
<p class="sub">${esc(data.model)} · ${esc(new Date(data.date).toLocaleString("es-AR"))}</p>
<div class="kpis">
  <div class="kpi"><b style="color:var(--${rate >= 90 ? "good" : rate >= 70 ? "warn" : "bad"})">${rate}%</b><span>casos correctos</span></div>
  <div class="kpi"><b>${data.pass}/${data.total}</b><span>aprobados</span></div>
  <div class="kpi"><b style="color:var(--${failed.length ? "bad" : "good"})">${failed.length}</b><span>fallidos</span></div>
  <div class="kpi"><b>${avgLatency} ms</b><span>latencia media</span></div>
</div>
<div class="grid">
${bars("Por categoría de caso", [...byTag].sort().map(([k, v]) => [k, v[0], v[1]]))}
${failed.length ? `<section class="card"><h2>Campos que fallaron</h2>${[...byField].sort((a, b) => b[1][1] - a[1][1]).map(([f, v]) => `<div class="bar"><span class="bar-name">${esc(f)}</span><span class="track"><span class="fill bad" style="width:${pct(v[1], failed.length)}%"></span></span><span class="bar-val">${v[1]} caso(s)</span></div>`).join("")}</section>` : ""}
</div>
<div class="toolbar" id="filters"><button data-f="all" class="on">Todos (${data.report.length})</button><button data-f="fail">Solo fallidos (${failed.length})</button><button data-f="ok">Solo aprobados (${data.report.length - failed.length})</button></div>
<div id="cases">${[...data.report].sort((a, b) => Number(a.pass) - Number(b.pass)).map(caseHtml).join("")}</div>
<script>
document.getElementById('filters').addEventListener('click',function(ev){var b=ev.target.closest('button');if(!b)return;
this.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});
document.querySelectorAll('#cases .case').forEach(function(c){c.style.display=(b.dataset.f==='all'||c.dataset.status===b.dataset.f)?'':'none'})});
</script>
</main></body></html>`;
}

if (import.meta.main) {
  const input = process.argv[2];
  if (!input) {
    console.error("Uso: bun run scripts/eval-report.ts evals/results/<archivo>.json");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(input, "utf8")) as ReportData;
  const out = input.replace(/\.json$/, ".html");
  writeFileSync(out, renderReport(data));
  console.log(`Reporte: ${out}`);
}
