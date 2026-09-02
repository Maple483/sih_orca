import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, ChevronLeft, ChevronRight, Fish, GitCompare, Leaf, Thermometer, TriangleAlert, X } from 'lucide-react';

type Annual = {
  Year: number;
  catch: number;
  sst: number;
  chlorophyll: number;
  catch_z: number;
  catch_anomaly: boolean;
};

type Analysis = {
  state: string;
  annual: Annual[];
  seasonal: { Season: string; mean_catch: number; mean_sst: number; mean_chlorophyll: number }[];
  top_species: { Species: string; catch_tonnes: number }[];
  species: string[];
  correlation: { catch_vs_sst: number | null; catch_vs_chlorophyll: number | null };
  anomalies: { Year: number; catch: number; catch_z: number }[];
  explanation: { text: string; caution: string; peak_season: string | null };
};

const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(Number(n) || 0);
const fmt2 = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n) || 0);

function Card({ title, children }: { title: string; children: any }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-200">
        <BarChart3 className="h-4 w-4 text-cyan-400" />{title}
      </div>
      {children}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex items-center gap-1 text-[10px] text-slate-500">{icon}<span>{label}</span></div>
      <div className="mt-1 text-sm font-bold text-slate-100">{value}</div>
    </div>
  );
}

function CatchTrend({ data }: { data: Annual[] }) {
  if (!data.length) return <div className="py-8 text-center text-xs text-slate-500">No annual catch data available.</div>;

  const width = 680;
  const height = 245;
  const left = 72;
  const right = 22;
  const top = 18;
  const bottom = 42;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const values = data.map(d => Number(d.catch) || 0);
  const max = Math.max(...values, 1);
  const step = max / 4;
  const x = (i: number) => left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => top + innerH - (v / max) * innerH;
  const points = data.map((d, i) => `${x(i)},${y(d.catch)}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[560px] w-full">
        {[0, 1, 2, 3, 4].map(i => {
          const value = step * i;
          const yy = y(value);
          return (
            <g key={i}>
              <line x1={left} x2={width - right} y1={yy} y2={yy} className="stroke-slate-800" />
              <text x={left - 10} y={yy + 4} textAnchor="end" className="fill-slate-500 text-[10px]">{fmt(value)}</text>
            </g>
          );
        })}
        <text transform={`translate(15 ${top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="fill-slate-400 text-[10px]">Catch (tonnes)</text>
        <line x1={left} x2={left} y1={top} y2={top + innerH} className="stroke-slate-700" />
        <line x1={left} x2={width - right} y1={top + innerH} y2={top + innerH} className="stroke-slate-700" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-400" />
        {data.map((d, i) => (
          <g key={d.Year}>
            <circle cx={x(i)} cy={y(d.catch)} r="5" className={d.catch_anomaly ? 'fill-red-400' : 'fill-cyan-400'}>
              <title>{`${d.Year}: ${fmt(d.catch)} tonnes${d.catch_anomaly ? ' · anomaly' : ''}`}</title>
            </circle>
            <text x={x(i)} y={height - 14} textAnchor="middle" className="fill-slate-500 text-[10px]">{d.Year}</text>
          </g>
        ))}
      </svg>
      <div className="mt-1 text-[10px] text-slate-500">Hover over each point to see the exact annual catch value.</div>
    </div>
  );
}

function EnvironmentTrend({ data }: { data: Annual[] }) {
  if (!data.length) return <div className="py-8 text-center text-xs text-slate-500">No environmental data available.</div>;

  const width = 680;
  const height = 245;
  const left = 62;
  const right = 22;
  const top = 18;
  const bottom = 42;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const sst = data.map(d => Number(d.sst) || 0);
  const chl = data.map(d => Number(d.chlorophyll) || 0);
  const minSst = Math.min(...sst);
  const maxSst = Math.max(...sst);
  const minChl = Math.min(...chl);
  const maxChl = Math.max(...chl);
  const x = (i: number) => left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const norm = (v: number, min: number, max: number) => top + innerH - ((v - min) / (max - min || 1)) * innerH;
  const ySst = (v: number) => norm(v, minSst, maxSst);
  const yChl = (v: number) => norm(v, minChl, maxChl);
  const sstPoints = data.map((d, i) => `${x(i)},${ySst(d.sst)}`).join(' ');
  const chlPoints = data.map((d, i) => `${x(i)},${yChl(d.chlorophyll)}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[560px] w-full">
        {[0, 1, 2, 3, 4].map(i => {
          const fraction = i / 4;
          const yy = top + innerH * fraction;
          const sstValue = maxSst - (maxSst - minSst) * fraction;
          const chlValue = maxChl - (maxChl - minChl) * fraction;
          return (
            <g key={i}>
              <line x1={left} x2={width - right} y1={yy} y2={yy} className="stroke-slate-800" />
              <text x={left - 9} y={yy + 4} textAnchor="end" className="fill-orange-400 text-[9px]">{sstValue.toFixed(1)}</text>
              <text x={width - right + 8} y={yy + 4} className="fill-emerald-400 text-[9px]">{chlValue.toFixed(2)}</text>
            </g>
          );
        })}
        <text transform={`translate(13 ${top + innerH / 2}) rotate(-90)`} textAnchor="middle" className="fill-orange-400 text-[10px]">SST (°C)</text>
        <text transform={`translate(${width - 4} ${top + innerH / 2}) rotate(90)`} textAnchor="middle" className="fill-emerald-400 text-[10px]">Chlorophyll (mg/m³)</text>
        <polyline points={sstPoints} fill="none" stroke="currentColor" strokeWidth="3" className="text-orange-400" />
        <polyline points={chlPoints} fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-400" />
        {data.map((d, i) => (
          <g key={d.Year}>
            <circle cx={x(i)} cy={ySst(d.sst)} r="4" className="fill-orange-400"><title>{`${d.Year}: SST ${d.sst.toFixed(2)} °C`}</title></circle>
            <circle cx={x(i)} cy={yChl(d.chlorophyll)} r="4" className="fill-emerald-400"><title>{`${d.Year}: chlorophyll ${d.chlorophyll.toFixed(3)} mg/m³`}</title></circle>
            <text x={x(i)} y={height - 14} textAnchor="middle" className="fill-slate-500 text-[10px]">{d.Year}</text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[10px] text-slate-500">
        <span className="text-orange-400">● SST</span>
        <span className="text-emerald-400">● Chlorophyll</span>
        <span>Hover over points for exact values.</span>
      </div>
    </div>
  );
}

function Corr({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const strength = value == null ? 'Unavailable' : Math.abs(value) >= 0.7 ? 'Strong' : Math.abs(value) >= 0.3 ? 'Moderate' : 'Weak';
  const direction = value == null ? '' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <div className="text-[10px] text-slate-500">Catch vs {label}</div>
      <div className="mt-1 flex items-baseline gap-2"><span className="text-lg font-bold text-slate-100">{value == null ? '—' : value.toFixed(2)}</span><span className="text-[10px] text-slate-500">{strength}</span></div>
      <div className="mt-2 h-1.5 rounded bg-slate-800"><div className={v >= 0 ? 'h-full rounded bg-emerald-400' : 'h-full rounded bg-orange-400'} style={{ width: `${Math.min(100, Math.abs(v) * 100)}%` }} /></div>
      {value != null && <div className="mt-2 text-[10px] text-slate-400">{direction} relationship: as {label} changes, catch tends to {value >= 0 ? 'increase' : 'decrease'} in this dataset.</div>}
    </div>
  );
}

export default function FishProductivityPanel() {
  const [open, setOpen] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [state, setState] = useState('');
  const [species, setSpecies] = useState('');
  const [compareState, setCompareState] = useState('');
  const [data, setData] = useState<Analysis | null>(null);
  const [comparison, setComparison] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/marine-productivity/regions`)
      .then(r => { if (!r.ok) throw new Error('Backend returned an error'); return r.json(); })
      .then(x => { setRegions(x.regions || []); if (x.regions?.length) setState(x.regions[0]); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Marine productivity API unavailable. Start the ORCA backend on port 8000.'));
  }, []);

  useEffect(() => {
    if (!state) return;
    setLoading(true);
    setError('');
    setComparison(null);
    fetch(`${API}/api/marine-productivity/analysis?state=${encodeURIComponent(state)}${species ? `&species=${encodeURIComponent(species)}` : ''}`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).detail?.message || 'Unable to load analysis'); return r.json(); })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unable to load analysis'))
      .finally(() => setLoading(false));
  }, [state, species]);

  const compare = async () => {
    if (!compareState) return;
    try {
      const r = await fetch(`${API}/api/marine-productivity/compare?region_a=${encodeURIComponent(state)}&region_b=${encodeURIComponent(compareState)}${species ? `&species=${encodeURIComponent(species)}` : ''}`);
      if (!r.ok) throw new Error('Comparison failed');
      setComparison(await r.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Comparison failed');
    }
  };

  const trend = useMemo(() => {
    if (!data?.annual.length) return 0;
    const first = data.annual[0].catch;
    const last = data.annual[data.annual.length - 1].catch;
    return ((last - first) / Math.max(Math.abs(first), 1)) * 100;
  }, [data]);

  const catchDirection = trend > 1 ? 'increased' : trend < -1 ? 'decreased' : 'remained broadly stable';

  return <>
    <button onClick={() => setOpen(v => !v)} className="fixed left-3 top-24 z-[9999] flex items-center gap-2 rounded-xl border border-cyan-400/60 bg-slate-950 px-4 py-3 text-sm font-bold text-cyan-300 shadow-2xl ring-1 ring-cyan-500/20">
      <Fish className="h-5 w-5" />Marine Productivity{open ? <ChevronLeft /> : <ChevronRight />}
    </button>

    {open && <aside className="fixed left-0 top-0 bottom-0 z-[9998] w-[500px] max-w-[96vw] overflow-y-auto border-r border-cyan-500/30 bg-slate-950 shadow-2xl">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950 p-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-100"><Fish className="h-5 w-5 text-cyan-400" />Marine Productivity</div>
          <div className="text-[10px] text-slate-500">Annual fish catch × SST × chlorophyll · 2007–2012</div>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-lg p-1 hover:bg-slate-800"><X className="text-slate-500" /></button>
      </header>

      <div className="space-y-4 p-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Region & fish filter</div>
          <select value={state} onChange={e => { setState(e.target.value); setSpecies(''); setComparison(null); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200">
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={species} onChange={e => setSpecies(e.target.value)} className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200">
            <option value="">All fish / total marine catch</option>
            {data?.species.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <p className="mt-2 text-[10px] text-slate-500">No species selected = total catch for the selected coastal region. Selecting a species recalculates every catch trend and correlation for that species only.</p>
        </section>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"><TriangleAlert className="mr-1 inline h-4 w-4" />{error}</div>}
        {loading && <div className="p-6 text-center text-xs text-slate-500">Computing marine productivity…</div>}

        {data && !loading && <>
          <div className="grid grid-cols-2 gap-2">
            <Metric icon={<Fish />} label={species ? 'Mean annual species catch' : 'Mean annual total catch'} value={`${fmt(data.annual.reduce((a, b) => a + b.catch, 0) / data.annual.length)} t`} />
            <Metric icon={<Activity />} label="2007 → 2012 catch change" value={`${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`} />
            <Metric icon={<Thermometer />} label="Mean SST" value={`${(data.annual.reduce((a, b) => a + b.sst, 0) / data.annual.length).toFixed(2)} °C`} />
            <Metric icon={<Leaf />} label="Mean chlorophyll" value={`${(data.annual.reduce((a, b) => a + b.chlorophyll, 0) / data.annual.length).toFixed(3)} mg/m³`} />
          </div>

          <Card title={species ? `${species} catch trend · 2007–2012` : 'Total fish catch trend · 2007–2012'}>
            <CatchTrend data={data.annual} />
            <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[10px] text-slate-400">
              Catch {catchDirection} from {fmt(data.annual[0].catch)} t in {data.annual[0].Year} to {fmt(data.annual[data.annual.length - 1].catch)} t in {data.annual[data.annual.length - 1].Year}.
            </div>
          </Card>

          <Card title="Mean SST & chlorophyll trend · 2007–2012">
            <EnvironmentTrend data={data.annual} />
          </Card>

          <Card title="How environmental change relates to fish productivity">
            <div className="grid grid-cols-2 gap-2"><Corr label="SST" value={data.correlation.catch_vs_sst} /><Corr label="chlorophyll" value={data.correlation.catch_vs_chlorophyll} /></div>
            <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs leading-relaxed text-slate-300">
              <div className="mb-1 font-semibold text-cyan-300">Interpretation</div>
              {data.explanation.text}
              <div className="mt-2 text-[10px] text-amber-300">Correlation describes association, not proof that SST or chlorophyll caused the catch change. Fishing effort, stock availability, recruitment, weather and management can also affect landings.</div>
            </div>
          </Card>

          <Card title="Seasonal productivity">
            <div className="grid grid-cols-2 gap-2">
              {data.seasonal.map(s => <div key={s.Season} className="rounded-lg border border-slate-800 p-2"><div className="text-xs font-semibold text-slate-200">{s.Season.replace('_', ' ')}</div><div className="text-[10px] text-slate-500">Catch {fmt(s.mean_catch)} t</div><div className="text-[10px] text-slate-500">SST {s.mean_sst.toFixed(2)}°C · Chl {s.mean_chlorophyll.toFixed(3)} mg/m³</div></div>)}
            </div>
          </Card>

          <Card title="Dominant fish types">
            {data.top_species.slice(0, 8).map((s, i) => <div key={s.Species} className="flex gap-2 text-[10px]"><span>{i + 1}</span><span className="flex-1 truncate text-slate-300">{s.Species}</span><span className="text-cyan-300">{fmt(s.catch_tonnes)} t</span></div>)}
          </Card>

          <Card title="Catch anomalies">
            {data.anomalies.length ? data.anomalies.map(a => <div key={a.Year} className="flex justify-between rounded bg-red-500/10 px-2 py-1 text-xs"><span>{a.Year}</span><span>{fmt(a.catch)} t · z={a.catch_z.toFixed(2)}</span></div>) : <div className="text-xs text-slate-500">No catch anomalies under the z ≥ 2 rule.</div>}
          </Card>

          <Card title="Region vs region">
            <div className="flex gap-2">
              <select value={compareState} onChange={e => setCompareState(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200"><option value="">Compare with…</option>{regions.filter(r => r !== state).map(r => <option key={r} value={r}>{r}</option>)}</select>
              <button onClick={compare} disabled={!compareState} className="rounded-lg bg-cyan-500 px-3 text-slate-950 disabled:opacity-40"><GitCompare className="h-4 w-4" /></button>
            </div>
            {comparison && <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">{[comparison.region_a, comparison.region_b].map((r: any) => <div key={r.state} className="rounded-lg border border-slate-800 p-2"><b>{r.state}</b><div>Catch {fmt(r.mean_catch)} t</div><div>SST {r.mean_sst.toFixed(2)}°C</div><div>Chl {r.mean_chlorophyll.toFixed(3)} mg/m³</div></div>)}</div>}
          </Card>
        </>}
      </div>
    </aside>}
  </>;
}
