/**
 * ORCA module 4 & 5 — Productivity trends + environmental correlation,
 * and the "Why did productivity change?" AI analysis.
 *
 * Self-contained: uses the bundled 2007–2026 dataset in ./productivity/dataset.json
 * (observed CMFRI/INCOIS-derived values 2007–2012, modelled thereafter).
 * No backend required. Gemini is used when VITE_GEMINI_API_KEY is present;
 * otherwise a deterministic local explanation is generated from the same data.
 */
import { useMemo, useState } from 'react';
import { Activity, BarChart3, Loader2, Sparkles, TriangleAlert, X } from 'lucide-react';
import { ALL_SPECIES, DATA, buildAnalysis, strength, type Analysis } from './productivity/analysis';

const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const sign = (r: number) => `${r > 0 ? '+' : ''}${r.toFixed(2)}`;

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-200">
        <BarChart3 className="h-4 w-4 text-cyan-400" />
        {title}
      </div>
      {subtitle && <p className="mb-2 text-[10px] text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

function Line({
  data,
  xKey,
  yKey,
  label,
  unit,
  color = 'text-cyan-400',
}: {
  data: any[];
  xKey: string;
  yKey: string;
  label: string;
  unit: string;
  color?: string;
}) {
  if (!data.length) return <div className="p-6 text-center text-xs text-slate-500">No data.</div>;
  const values = data.map((d) => Number(d[yKey]) || 0);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 760, h = 250, l = 66, r = 16, t = 16, b = 40;
  const x = (i: number) => l + (i * (w - l - r)) / Math.max(data.length - 1, 1);
  const y = (v: number) => t + ((max - v) * (h - t - b)) / range;
  const pts = data.map((d, i) => `${x(i)},${y(Number(d[yKey]) || 0)}`).join(' ');
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full min-w-[640px]">
        {Array.from({ length: 6 }, (_, i) => {
          const v = min + (range * i) / 5;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={l} y1={yy} x2={w - r} y2={yy} className="stroke-slate-700" />
              <text x={l - 7} y={yy + 4} textAnchor="end" className="fill-slate-400 text-[11px]">{fmt(v)}</text>
            </g>
          );
        })}
        <line x1={l} y1={t} x2={l} y2={h - b} className="stroke-slate-600" />
        <line x1={l} y1={h - b} x2={w - r} y2={h - b} className="stroke-slate-600" />
        <polyline fill="none" stroke="currentColor" strokeWidth="2.5" className={color} points={pts} />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(Number(d[yKey]) || 0)} r="3.5" className="fill-cyan-300">
              <title>{`${d[xKey]}\n${label}: ${fmt(Number(d[yKey]))} ${unit}`}</title>
            </circle>
            {(data.length <= 12 || i % 2 === 0) && (
              <text x={x(i)} y={h - 14} textAnchor="middle" className="fill-slate-500 text-[9px]">{d[xKey]}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Bars({ data, xKey, yKey, unit }: { data: any[]; xKey: string; yKey: string; unit: string }) {
  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1);
  const w = 760, h = 250, l = 66, r = 16, t = 16, b = 42, base = h - b;
  const barW = Math.min(70, (w - l - r) / data.length - 10);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full min-w-[640px]">
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
          const yy = base - p * (base - t);
          return (
            <g key={i}>
              <line x1={l} y1={yy} x2={w - r} y2={yy} className="stroke-slate-700" />
              <text x={l - 7} y={yy + 4} textAnchor="end" className="fill-slate-400 text-[11px]">{fmt(max * p)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const v = Number(d[yKey]) || 0;
          const bh = (v / max) * (base - t);
          const bx = l + (i + 0.5) * ((w - l - r) / data.length) - barW / 2;
          return (
            <g key={i}>
              <rect x={bx} y={base - bh} width={barW} height={bh} rx="4" className="fill-cyan-500/80">
                <title>{`${d[xKey]}: ${fmt(v)} ${unit}`}</title>
              </rect>
              <text x={bx + barW / 2} y={h - 16} textAnchor="middle" className="fill-slate-400 text-[9px]">
                {String(d[xKey]).split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function localExplanation(a: Analysis, question: string) {
  const dir = a.change.catchPct < 0 ? 'declined' : 'increased';
  const worst = [...a.seasonal].sort((x, y) => x.catch - y.catch)[0];
  const best = [...a.seasonal].sort((x, y) => y.catch - x.catch)[0];
  const conf = Math.abs(a.correlations.chlorophyll) >= 0.6 ? 'Moderate' : 'Low';
  return [
    `### Answer`,
    `${question.trim()}`,
    `${a.species} catch in ${a.state} ${dir} by ${Math.abs(a.change.catchPct).toFixed(1)}% between ${a.from} and ${a.to}. Over the same window mean SST changed by ${sign(a.change.sstDeltaC)} °C and mean chlorophyll-a by ${sign(a.change.chlPct)}%.`,
    `### What the data shows`,
    `- Catch change: ${sign(a.change.catchPct)}% (${a.from}–${a.to}).`,
    `- SST change: ${sign(a.change.sstDeltaC)} °C.`,
    `- Chlorophyll-a change: ${sign(a.change.chlPct)}%.`,
    `- Catch ↔ chlorophyll r = ${sign(a.correlations.chlorophyll)} (${strength(a.correlations.chlorophyll).toLowerCase()}); catch ↔ SST r = ${sign(a.correlations.sst)}.`,
    `- Strongest lag: chlorophyll leads catch by ${a.bestChlLag.lag} month(s), r = ${sign(a.bestChlLag.chl)}. Highest season: ${best?.season}; lowest: ${worst?.season}.`,
    `### Possible contributing factors`,
    `- Changes in chlorophyll-a (food availability) may have altered environmental suitability.`,
    `- Warmer-than-usual SST may have shifted the distribution of this species away from the sampled grounds.`,
    `- Fishing effort and reporting changes are not in this dataset and could also explain part of the trend.`,
    `### Confidence`,
    `${conf} — based on ${a.years.length} years of catch with matched SST and chlorophyll series.`,
    `### Evidence`,
    `Annual catch, seasonal catch, SST, chlorophyll-a, correlation and 0–3 month lag analysis.`,
    `> Correlation does not prove causation.`,
  ].join('\n');
}

async function askGemini(a: Analysis, question: string): Promise<string> {
  const key = (import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY;
  if (!key) return localExplanation(a, question);
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: key });
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Question: ${question}\n\nData bundle (JSON):\n${JSON.stringify(a)}`,
    config: {
      systemInstruction: `You are ORCA's marine productivity analyst. Explain changes in fish productivity using ONLY the supplied data bundle (catch, SST, chlorophyll, seasonality, correlations, lag analysis).
Answer in this exact markdown structure:
### Answer
One paragraph with concrete numbers.
### What the data shows
- 3 to 5 bullets, each containing a number.
### Possible contributing factors
- 2 to 3 hypotheses, never stated as proven causes.
### Confidence
Low | Moderate | High — plus one clause of justification.
### Evidence
Comma-separated list of data layers used.
Always end with the exact line:
> Correlation does not prove causation.
Never invent data. Keep it under 300 words.`,
    },
  });
  return (res.text || '').trim() || localExplanation(a, question);
}

function renderLine(line: string, i: number) {
  if (line.startsWith('### ')) return <h4 key={i} className="mt-3 text-xs font-bold text-cyan-300">{line.slice(4)}</h4>;
  if (line.startsWith('> '))
    return (
      <p key={i} className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {line.slice(2)}
      </p>
    );
  if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc text-[11px] text-slate-300">{line.slice(2)}</li>;
  if (!line.trim()) return null;
  return <p key={i} className="mt-1.5 text-[11px] leading-relaxed text-slate-300">{line}</p>;
}

const SUGGESTIONS = [
  'Why has fish productivity declined in this region?',
  'Why did sardine catch change the most during the southwest monsoon?',
  'Which environmental driver best explains the catch trend here?',
];

export default function ProductivityTrendsPanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('Karnataka');
  const [species, setSpecies] = useState('Sardine');
  const [from, setFrom] = useState(2007);
  const [to, setTo] = useState(2026);
  const [question, setQuestion] = useState<string>(SUGGESTIONS[0] as string);
  const [answer, setAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState('');
  const [loading, setLoading] = useState(false);

  const data = useMemo(
    () => buildAnalysis(state, species, Math.min(from, to), Math.max(from, to)),
    [state, species, from, to],
  );

  const run = async (q: string) => {
    setLoading(true);
    setAiError('');
    setAnswer(null);
    try {
      setAnswer(await askGemini(data, q));
    } catch (e: unknown) {
      setAnswer(localExplanation(data, q));
      setAiError(e instanceof Error ? `Gemini unavailable (${e.message}); showing local data-driven analysis.` : '');
    } finally {
      setLoading(false);
    }
  };

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed left-3 top-44 z-[9999] flex items-center gap-2 rounded-xl border border-cyan-400/60 bg-slate-950 px-4 py-2 text-xs font-bold text-cyan-300 shadow-lg"
      >
        <Activity className="h-4 w-4" /> Productivity Trends
      </button>
    );

  return (
    <div className="fixed inset-0 z-[10000] overflow-y-auto bg-slate-950/95 p-4 backdrop-blur">
      <div className="mx-auto max-w-5xl space-y-3">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Productivity trends & environmental correlation</h2>
            <p className="text-[11px] text-slate-400">
              Catch, SST and chlorophyll-a for Indian coastal states, 2007–2026, with correlation, lag analysis and AI explanation.
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-700 p-2 text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:grid-cols-4">
          <label className="text-[10px] text-slate-400">
            Region
            <select value={state} onChange={(e) => setState(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
              {DATA.states.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-slate-400">
            Species
            <select value={species} onChange={(e) => setSpecies(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
              <option>{ALL_SPECIES}</option>
              {DATA.species.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-slate-400">
            From
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
              {DATA.years.map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-slate-400">
            To
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
              {DATA.years.map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="A. Annual catch" subtitle={`${data.species} — ${data.state}, ${data.from}–${data.to} (tonnes). Hover for exact values.`}>
            <Line data={data.annualLine} xKey="year" yKey="catch" label="Catch" unit="t" />
          </Card>
          <Card title="B. Seasonal catch" subtitle="Mean catch per season (tonnes/year).">
            <Bars data={data.seasonal} xKey="season" yKey="catch" unit="t" />
          </Card>
          <Card title="B2. Monthly climatology" subtitle="Mean catch per calendar month (tonnes).">
            <Bars data={data.monthly} xKey="month" yKey="catch" unit="t" />
          </Card>
          <Card title="C. Sea surface temperature" subtitle="Annual mean SST (°C).">
            <Line data={data.sstLine} xKey="year" yKey="sst" label="SST" unit="°C" color="text-orange-400" />
          </Card>
          <Card title="D. Chlorophyll-a" subtitle="Annual mean chlorophyll-a (mg/m³) — proxy for primary productivity.">
            <Line data={data.chlLine} xKey="year" yKey="chl" label="Chlorophyll-a" unit="mg/m³" color="text-emerald-400" />
          </Card>
          <Card title="E. Correlation & F. Lag analysis" subtitle={`Pearson r, ${data.from}–${data.to}.`}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-[10px] text-slate-500">Catch ↔ Chlorophyll</div>
                <div className="text-lg font-bold text-slate-100">{sign(data.correlations.chlorophyll)}</div>
                <div className="text-[10px] text-slate-500">{strength(data.correlations.chlorophyll)}</div>
              </div>
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-[10px] text-slate-500">Catch ↔ SST</div>
                <div className="text-lg font-bold text-slate-100">{sign(data.correlations.sst)}</div>
                <div className="text-[10px] text-slate-500">{strength(data.correlations.sst)}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-300">
              Strongest relationship: <span className="font-bold text-cyan-300">{data.correlations.strongest}</span>
            </p>
            <table className="mt-2 w-full text-[11px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 text-left">Lag</th>
                  <th className="py-1 text-right">Chlorophyll r</th>
                  <th className="py-1 text-right">SST r</th>
                </tr>
              </thead>
              <tbody>
                {data.lags.map((l) => (
                  <tr key={l.lag} className="border-t border-slate-800 text-slate-300">
                    <td className="py-1">{l.lag === 0 ? 'Same month' : `${l.lag}-month lag`}</td>
                    <td className="py-1 text-right">{sign(l.chl)}</td>
                    <td className="py-1 text-right">{sign(l.sst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              Chlorophyll vs catch correlation is strongest at{' '}
              {data.bestChlLag.lag === 0 ? 'the same month' : `${data.bestChlLag.lag}-month lag`}: r = {sign(data.bestChlLag.chl)}.
            </p>
            <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Correlation does not prove causation.
            </p>
          </Card>
        </div>

        <Card title="Why did productivity change? — AI analysis" subtitle="Reads catch, SST, chlorophyll, seasonality, baselines and lag analysis for the current selection.">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => { setQuestion(s); void run(s); }}
                className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-cyan-500"
              >
                {s.length > 44 ? `${s.slice(0, 44)}…` : s}
              </button>
            ))}
          </div>
          <button
            onClick={() => void run(question)}
            disabled={loading || question.trim().length < 3}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Analysing…' : 'Analyse'}
          </button>
          {aiError && <p className="mt-2 text-[10px] text-amber-300">{aiError}</p>}
          {answer && <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">{answer.split('\n').map(renderLine)}</div>}
        </Card>

        <p className="pb-6 text-[10px] text-slate-500">
          Sources — catch: {data.provenance.catch}. Environment: {data.provenance.env}.
        </p>
      </div>
    </div>
  );
}
