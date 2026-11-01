/**
 * Prompt evaluation harness.
 *
 * Runs the text-message cases in evals/text-cases.ts through the SAME pipeline the bot uses
 * (PromptBuilder -> Gemini -> parseAIResponse -> applyDefaults -> mapTransactionIndices) and
 * compares the result with the expected values.
 *
 * Usage:
 *   bun run eval:prompts                       # all cases, 1 run each
 *   bun run eval:prompts --runs 3              # repeat each case to measure variance
 *   bun run eval:prompts --only cuotas,fecha   # filter by case id prefix or tag
 *   bun run eval:prompts --delay 8000          # ms between API calls (default 6000)
 *   bun run eval:prompts --label baseline      # label stored in the results file
 *
 * Needs GEMINI_API_KEY (or GEMINI_API_KEYS) in .env. Results go to evals/results/.
 */
import { mkdirSync, writeFileSync } from "fs";
import { GeminiClient } from "../src/ai/gemini";
import { PromptBuilder } from "../src/ai/prompts";
import { MessageHandlers } from "../src/bot/handlers";
import { mapTransactionIndices, parseDate } from "../src/services/validator";
import { config } from "../src/config";
import type { ConfigData, TransactionResult } from "../src/types";
import categorias from "../evals/categorias.json";
import { renderReport, type ReportData, type ReportEntry } from "./eval-report";
import { TEXT_CASES, type ExpectedTx, type FechaSpec, type TextCase } from "../evals/text-cases";

const TZ = "America/Argentina/Buenos_Aires";

// ---------- CLI ----------
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const RUNS = parseInt(arg("runs", "1")!, 10);
const DELAY_MS = parseInt(arg("delay", "6000")!, 10);
const ONLY = (arg("only") ?? "").split(",").filter(Boolean);
const LABEL = arg("label", "run")!;

// ---------- Setup ----------
const sheetsConfig: ConfigData = {
  macroCategorias: Object.keys(categorias),
  subcategorias: Object.values(categorias).flat(),
  categoriasMap: categorias as Record<string, string[]>,
};

// The post-AI steps are private in MessageHandlers; reuse them so the eval matches production.
const handlers = new MessageHandlers(null as never, null as never, null as never, null as never, null as never);
const pipeline = handlers as unknown as {
  parseAIResponse(response: string): TransactionResult[];
  applyDefaults(result: TransactionResult, text: string, cfg: ConfigData): TransactionResult;
};

const gemini = new GeminiClient();

// ---------- Dates ----------
function todayAR(): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
function resolveFecha(spec: FechaSpec): Date | null {
  const today = todayAR();
  if (spec === "vacia") return null;
  if (spec === "hoy") return today;
  if (spec === "ayer") return addDays(today, -1);
  if ("dia" in spec) return new Date(today.getFullYear(), spec.mes - 1, spec.dia);
  for (let back = 1; back <= 7; back++) {
    const candidate = addDays(today, -back);
    if (candidate.getDay() === spec.ultimoDiaSemana) return candidate;
  }
  return null;
}
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

// ---------- Pipeline ----------
async function callWithRetry(prompt: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await gemini.generateContent(prompt);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/429|rate limited|RESOURCE_EXHAUSTED/i.test(msg) && attempt <= 1) {
        console.log(`   ⏳ rate limit, esperando 65s (intento ${attempt}/1)...`);
        await sleep(65_000);
        continue;
      }
      throw error;
    }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunOutcome {
  rawResponse: string;
  results: TransactionResult[];
  error?: string;
  latencyMs: number;
}

async function runCase(testCase: TextCase): Promise<RunOutcome> {
  const prompt = PromptBuilder.buildTextPrompt(
    testCase.input,
    sheetsConfig.categoriasMap,
    testCase.contextoPrevio ?? null,
    testCase.pendiente ?? null
  );
  const started = Date.now();
  const rawResponse = await callWithRetry(prompt);
  const latencyMs = Date.now() - started;

  try {
    const parsed = pipeline.parseAIResponse(rawResponse);
    const results = parsed.map((r) => {
      if (r.usa_contexto === undefined) r.usa_contexto = testCase.contextoPrevio != null;
      const withDefaults = pipeline.applyDefaults(r, testCase.input, sheetsConfig);
      return mapTransactionIndices(withDefaults, sheetsConfig);
    });
    return { rawResponse, results, latencyMs };
  } catch (error) {
    return { rawResponse, results: [], error: error instanceof Error ? error.message.slice(0, 200) : String(error), latencyMs };
  }
}

// ---------- Scoring ----------
interface FieldCheck { field: string; ok: boolean; expected: unknown; actual: unknown }

function compare(expected: ExpectedTx, actual: TransactionResult): FieldCheck[] {
  const d = actual.datos;
  const checks: FieldCheck[] = [{ field: "tipo", ok: expected.tipo === actual.tipo, expected: expected.tipo, actual: actual.tipo }];

  const eq = (field: keyof ExpectedTx, actualValue: unknown, ok: boolean) =>
    checks.push({ field, ok, expected: expected[field], actual: actualValue });

  if (expected.macro_categoria !== undefined) eq("macro_categoria", d.macro_categoria, d.macro_categoria === expected.macro_categoria);
  if (expected.subcategoria !== undefined) {
    const accepted = Array.isArray(expected.subcategoria) ? expected.subcategoria : [expected.subcategoria];
    eq("subcategoria", d.subcategoria, accepted.includes(d.subcategoria ?? ""));
  }
  if (expected.categoria !== undefined) eq("categoria", d.categoria, d.categoria === expected.categoria);
  if (expected.monto !== undefined) eq("monto", d.monto, Math.abs((d.monto ?? NaN) - expected.monto) < 0.51);
  if (expected.moneda !== undefined) eq("moneda", d.moneda, d.moneda === expected.moneda);
  if (expected.cotizacion !== undefined) eq("cotizacion", d.cotizacion, d.cotizacion === expected.cotizacion);
  if (expected.cuotas !== undefined) eq("cuotas", d.cuotas, (d.cuotas ?? 1) === expected.cuotas);
  if (expected.n_cuota !== undefined) eq("n_cuota", d.n_cuota, (d.n_cuota ?? 1) === expected.n_cuota);
  if (expected.mi_parte !== undefined) eq("mi_parte", d.mi_parte, (d.mi_parte ?? 100) === expected.mi_parte);
  if (expected.usa_contexto !== undefined) eq("usa_contexto", actual.usa_contexto, Boolean(actual.usa_contexto) === expected.usa_contexto);
  if (expected.fecha !== undefined) {
    const want = resolveFecha(expected.fecha);
    const got = d.fecha ? parseDate(d.fecha) : null;
    const ok = want === null ? !d.fecha : got !== null && ymd(got) === ymd(want);
    checks.push({ field: "fecha", ok, expected: want ? fmt(want) : "(vacía)", actual: d.fecha || "(vacía)" });
  }
  return checks;
}

interface CaseScore { pass: boolean; checks: FieldCheck[]; note?: string }

function score(testCase: TextCase, outcome: RunOutcome): CaseScore {
  if (testCase.expect === "ninguna") {
    const pass = outcome.results.length === 0;
    return { pass, checks: [], note: pass ? undefined : `devolvió ${outcome.results.length} transacción(es)` };
  }
  if (outcome.error) return { pass: false, checks: [], note: `error: ${outcome.error}` };
  if (outcome.results.length !== testCase.expect.length) {
    return { pass: false, checks: [], note: `esperaba ${testCase.expect.length} transacción(es), devolvió ${outcome.results.length}` };
  }

  // Pair expected <-> actual by (tipo, monto) first so order doesn't matter.
  const remaining = [...outcome.results];
  const checks: FieldCheck[] = [];
  for (const exp of testCase.expect) {
    let idx = remaining.findIndex((r) => r.tipo === exp.tipo && exp.monto !== undefined && Math.abs((r.datos.monto ?? NaN) - exp.monto) < 0.51);
    if (idx < 0) idx = remaining.findIndex((r) => r.tipo === exp.tipo);
    if (idx < 0) idx = 0;
    const [actual] = remaining.splice(idx, 1);
    checks.push(...compare(exp, actual));
  }
  return { pass: checks.every((c) => c.ok), checks };
}

// ---------- Main ----------
async function main() {
  if (config.ai.gemini.apiKeys.length === 0) {
    console.error("Falta GEMINI_API_KEY en .env");
    process.exit(1);
  }

  const cases = TEXT_CASES.filter((c) => ONLY.length === 0 || ONLY.some((o) => c.id.startsWith(o) || c.tags.includes(o)));
  console.log(`\nModelo: ${config.ai.gemini.modelName} | casos: ${cases.length} | corridas por caso: ${RUNS} | etiqueta: ${LABEL}\n`);

  const report: ReportEntry[] = [];
  const byTag = new Map<string, { pass: number; total: number }>();
  const byField = new Map<string, { ok: number; total: number }>();
  let pass = 0;
  let total = 0;
  let latency = 0;

  for (const testCase of cases) {
    for (let run = 1; run <= RUNS; run++) {
      let outcome: RunOutcome;
      try {
        outcome = await runCase(testCase);
      } catch (error) {
        console.log(`💥 ${testCase.id}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
        console.log("Abortando: no se pudo llamar a la API. Resultados parciales abajo.");
        cases.length = 0;
        break;
      }
      const result = score(testCase, outcome);
      total++;
      latency += outcome.latencyMs;
      if (result.pass) pass++;
      for (const tag of testCase.tags) {
        const t = byTag.get(tag) ?? { pass: 0, total: 0 };
        t.total++;
        if (result.pass) t.pass++;
        byTag.set(tag, t);
      }
      for (const c of result.checks) {
        const f = byField.get(c.field) ?? { ok: 0, total: 0 };
        f.total++;
        if (c.ok) f.ok++;
        byField.set(c.field, f);
      }

      const suffix = RUNS > 1 ? ` #${run}` : "";
      if (result.pass) {
        console.log(`✅ ${testCase.id}${suffix}`);
      } else {
        console.log(`❌ ${testCase.id}${suffix}  "${testCase.input}"`);
        if (result.note) console.log(`   ${result.note}`);
        for (const c of result.checks.filter((x) => !x.ok)) {
          console.log(`   ${c.field}: esperado ${JSON.stringify(c.expected)} | obtenido ${JSON.stringify(c.actual)}`);
        }
      }
      report.push({ id: testCase.id, run, tags: testCase.tags, input: testCase.input, context: testCase.pendiente ?? testCase.contextoPrevio, expect: testCase.expect, pass: result.pass, note: result.note, failed: result.checks.filter((c) => !c.ok), results: outcome.results, rawResponse: outcome.rawResponse, latencyMs: outcome.latencyMs });
      await sleep(DELAY_MS);
    }
  }

  const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);
  console.log("\n==================== RESUMEN ====================");
  console.log(`Casos OK: ${pass}/${total} (${pct(pass, total)}) | latencia media: ${total ? Math.round(latency / total) : 0} ms`);
  console.log("\nPor categoría de caso:");
  for (const [tag, t] of [...byTag].sort()) console.log(`  ${tag.padEnd(12)} ${t.pass}/${t.total}  ${pct(t.pass, t.total)}`);
  console.log("\nPor campo:");
  for (const [field, f] of [...byField].sort()) console.log(`  ${field.padEnd(16)} ${f.ok}/${f.total}  ${pct(f.ok, f.total)}`);

  mkdirSync("evals/results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `evals/results/${stamp}-${LABEL}.json`;
  const data: ReportData = { label: LABEL, model: config.ai.gemini.modelName, date: new Date().toISOString(), pass, total, report };
  writeFileSync(file, JSON.stringify(data, null, 2));
  const htmlFile = file.replace(/\.json$/, ".html");
  writeFileSync(htmlFile, renderReport(data));
  console.log(`\nDetalle: ${file}\nReporte HTML: ${htmlFile}`);
}

// Some imported services keep timers alive; exit explicitly so the command returns.
void main().then(() => process.exit(0));
