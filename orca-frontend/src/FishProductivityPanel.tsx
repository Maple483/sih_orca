import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Fish, LocateFixed, MapPin, Navigation, RefreshCw, Waves, X } from 'lucide-react';

type LiveConditions = {
  sst_c?: number | null;
  satellite_sst_c?: number | null;
  wave_height_m?: number | null;
  wave_direction_deg?: number | null;
  wave_period_s?: number | null;
  current_velocity_kmh?: number | null;
  current_direction_deg?: number | null;
  source?: string;
  satellite_sst_source?: string;
  error?: string;
};

type PFZResult = {
  rank: number;
  rank_score: number;
  distance_km: number;
  from_coast: string;
  direction: string;
  bearing_deg: number | null;
  distance_advisory_km: string;
  depth_m: string;
  lat: number;
  lon: number;
  state: string;
  forecast_validity: string;
  reasons: string[];
};

type PFZResponse = {
  status: string;
  user_location: { lat: number; lon: number };
  generated_at?: string;
  live_conditions: LiveConditions;
  results: PFZResult[];
  method: string;
  message?: string;
};

const API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

const SAMPLE_LOCATIONS = [
  { name: 'Chennai coast', lat: 13.08, lon: 80.27 },
  { name: 'Goa coast', lat: 15.50, lon: 73.55 },
  { name: 'Kochi coast', lat: 9.93, lon: 76.26 },
  { name: 'Mumbai coast', lat: 18.96, lon: 72.82 },
];

const fmt = (value: number | null | undefined, digits = 1) => value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits);

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5"><div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-slate-100">{value}</div></div>;
}

function PFZMap({ userLat, userLon, results }: { userLat: number; userLon: number; results: PFZResult[] }) {
  const points = results.slice(0, 5);
  const allLat = [userLat, ...points.map(p => p.lat)], allLon = [userLon, ...points.map(p => p.lon)];
  const minLat = Math.min(...allLat), maxLat = Math.max(...allLat), minLon = Math.min(...allLon), maxLon = Math.max(...allLon);
  const latRange = Math.max(maxLat - minLat, 0.4), lonRange = Math.max(maxLon - minLon, 0.4), padLat = latRange * 0.18, padLon = lonRange * 0.18;
  const loLat = minLat - padLat, hiLat = maxLat + padLat, loLon = minLon - padLon, hiLon = maxLon + padLon;
  const xy = (lat: number, lon: number) => ({ x: 42 + ((lon - loLon) / Math.max(hiLon - loLon, 0.001)) * 316, y: 168 - ((lat - loLat) / Math.max(hiLat - loLat, 0.001)) * 128 });
  const user = xy(userLat, userLon);
  return <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
    <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PFZ proximity view</div><div className="flex items-center gap-3 text-[9px] text-slate-500"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-white" /> You</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> PFZ</span></div></div>
    <svg viewBox="0 0 400 200" className="h-48 w-full">
      <defs><pattern id="pfz-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" className="stroke-slate-800" strokeWidth="0.7" /></pattern></defs>
      <rect width="400" height="200" fill="url(#pfz-grid)" />
      {points.map((p, idx) => { const q = xy(p.lat, p.lon); return <g key={`${p.lat}-${p.lon}`}>
        <line x1={user.x} y1={user.y} x2={q.x} y2={q.y} className={idx === 0 ? 'stroke-emerald-500/60' : 'stroke-slate-700'} strokeWidth={idx === 0 ? 2 : 1} strokeDasharray="4 4" />
        <circle cx={q.x} cy={q.y} r={idx === 0 ? 7 : 5} className={idx === 0 ? 'fill-emerald-400/20 stroke-emerald-300' : 'fill-cyan-400/15 stroke-cyan-400'} strokeWidth="1.5" />
        <text x={q.x + 8} y={q.y + 3} className="fill-slate-300 text-[9px]">#{p.rank} {p.from_coast || p.state || 'PFZ'}</text>
      </g>; })}
      <circle cx={user.x} cy={user.y} r="7" className="fill-white/20 stroke-white" strokeWidth="2" /><circle cx={user.x} cy={user.y} r="2.5" className="fill-white" /><text x={user.x + 9} y={user.y + 3} className="fill-white text-[9px] font-semibold">Your position</text>
    </svg>
  </div>;
}

export default function FishProductivityPanel() {
  const [open, setOpen] = useState(true);
  const [lat, setLat] = useState('13.08');
  const [lon, setLon] = useState('80.27');
  const [sample, setSample] = useState('Chennai coast');
  const [data, setData] = useState<PFZResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState('');
  const nearestDistance = useMemo(() => data?.results?.[0]?.distance_km ?? null, [data]);
  const nearest = data?.results?.[0];

  const findPFZ = async () => {
    const latitude = Number(lat), longitude = Number(lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter valid latitude (-90 to 90) and longitude (-180 to 180).'); return;
    }
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/api/marine-productivity/pfz?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&max_results=5`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.detail?.message || payload?.message || `Server returned ${response.status}`);
      setData(payload as PFZResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load PFZ recommendations.'); setData(null);
    } finally { setLoading(false); }
  };

  const useBrowserLocation = () => {
    if (!navigator.geolocation) { setError('Browser geolocation is not available. Enter coordinates manually.'); return; }
    setLocationLoading(true); setError('');
    navigator.geolocation.getCurrentPosition(
      position => { setLat(position.coords.latitude.toFixed(5)); setLon(position.coords.longitude.toFixed(5)); setSample('Current device location'); setLocationLoading(false); },
      () => { setError('Location permission was denied or unavailable. Enter coordinates manually.'); setLocationLoading(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const chooseSample = (name: string) => { const item = SAMPLE_LOCATIONS.find(x => x.name === name); if (!item) return; setSample(item.name); setLat(item.lat.toFixed(2)); setLon(item.lon.toFixed(2)); };

  useEffect(() => { if (open && !data) findPFZ(); }, [open]);

  return <>
    <button onClick={() => setOpen(v => !v)} className="fixed bottom-5 right-5 z-[1700] flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-slate-950/95 px-4 py-3 text-sm font-bold text-emerald-300 shadow-2xl backdrop-blur-md hover:bg-slate-900" title="Potential Fishing Zone Finder">
      <Fish className="h-5 w-5" /> PFZ Finder
    </button>
    {open && <aside className="fixed bottom-20 right-5 z-[1699] max-h-[80vh] w-[470px] max-w-[94vw] overflow-y-auto rounded-2xl border border-emerald-400/30 bg-slate-950/98 shadow-2xl backdrop-blur-xl">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/98 p-4"><div><div className="flex items-center gap-2 text-sm font-bold text-slate-100"><Fish className="h-5 w-5 text-emerald-400" />Potential Fishing Zone Finder</div><div className="mt-0.5 text-[10px] text-slate-500">Fisher location → live marine conditions → ranked PFZ</div></div><button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></header>
      <div className="space-y-4 p-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"><div className="mb-3 flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Fisherman location</div><button onClick={useBrowserLocation} className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-cyan-300 hover:bg-slate-800">{locationLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />}Use device GPS</button></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">Latitude<input value={lat} onChange={e => setLat(e.target.value)} type="number" step="any" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white outline-none focus:border-emerald-400" /></label><label className="text-[10px] text-slate-500">Longitude<input value={lon} onChange={e => setLon(e.target.value)} type="number" step="any" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white outline-none focus:border-emerald-400" /></label></div>
          <div className="mt-3 flex gap-2"><select value={sample} onChange={e => chooseSample(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300"><option value="Chennai coast">Try Chennai coast</option><option value="Goa coast">Try Goa coast</option><option value="Kochi coast">Try Kochi coast</option><option value="Mumbai coast">Try Mumbai coast</option><option value="Current device location">Current device location</option></select><button onClick={findPFZ} disabled={loading} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">{loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}Find best PFZ</button></div>
          <div className="mt-2 text-[9px] text-slate-500">Testing tip: start with Chennai, Goa, Kochi or Mumbai, then change the coordinates slightly and run again.</div>
        </section>
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"><AlertTriangle className="mr-1 inline h-4 w-4" />{error}</div>}
        {data && <>
          <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /><div className="min-w-0"><div className="text-xs font-bold text-emerald-300">Best available PFZ</div><div className="mt-1 text-base font-bold text-white">#{nearest?.rank} {nearest?.from_coast || 'PFZ Advisory'}</div><div className="mt-1 text-[11px] text-slate-400">{nearest?.state} · {fmt(nearestDistance)} km away · score {fmt(nearest?.rank_score, 0)}/100</div></div></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Bearing" value={nearest?.bearing_deg == null ? '—' : `${fmt(nearest.bearing_deg, 0)}°`} /><Metric label="Direction" value={nearest?.direction || '—'} /><Metric label="Advisory distance" value={nearest?.distance_advisory_km || '—'} /><Metric label="Depth" value={nearest?.depth_m || '—'} /></div></section>
          <section><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Waves className="h-3.5 w-3.5 text-cyan-400" />Live marine conditions</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Metric label="Satellite SST" value={`${fmt(data.live_conditions.satellite_sst_c, 2)} °C`} /><Metric label="Model SST" value={`${fmt(data.live_conditions.sst_c, 2)} °C`} /><Metric label="Wave height" value={`${fmt(data.live_conditions.wave_height_m, 2)} m`} /><Metric label="Wave period" value={`${fmt(data.live_conditions.wave_period_s, 1)} s`} /><Metric label="Ocean current" value={`${fmt(data.live_conditions.current_velocity_kmh, 2)} km/h`} /><Metric label="Current direction" value={data.live_conditions.current_direction_deg == null ? '—' : `${fmt(data.live_conditions.current_direction_deg, 0)}°`} /></div><div className="mt-2 text-[9px] text-slate-600">{data.live_conditions.satellite_sst_source || data.live_conditions.source || 'Live source status unavailable.'}</div></section>
          <PFZMap userLat={data.user_location.lat} userLon={data.user_location.lon} results={data.results} />
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="mb-3 flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ranked PFZ advisories</div><div className="text-[9px] text-slate-500">{data.results.length} candidates</div></div><div className="space-y-2">{data.results.map((pfz, index) => <div key={`${pfz.lat}-${pfz.lon}`} className={`rounded-lg border p-3 ${index === 0 ? 'border-emerald-500/35 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/60'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-300">#{pfz.rank}</span><span className="truncate text-xs font-bold text-slate-100">{pfz.from_coast || 'PFZ Advisory'}</span></div><div className="mt-1 flex items-center gap-2 text-[9px] text-slate-500"><MapPin className="h-3 w-3" />{pfz.lat.toFixed(4)}, {pfz.lon.toFixed(4)} · {pfz.state}</div></div><div className="text-right"><div className="text-sm font-bold text-emerald-300">{fmt(pfz.distance_km)} km</div><div className="text-[9px] text-slate-500">score {fmt(pfz.rank_score, 0)}</div></div></div><div className="mt-2 grid grid-cols-3 gap-2 text-[9px] text-slate-400"><span>Bearing <b className="text-slate-200">{pfz.bearing_deg == null ? '—' : `${fmt(pfz.bearing_deg, 0)}°`}</b></span><span>Dir <b className="text-slate-200">{pfz.direction || '—'}</b></span><span>Depth <b className="text-slate-200">{pfz.depth_m || '—'}</b></span></div>{pfz.reasons.length > 0 && <div className="mt-2 text-[9px] text-emerald-300/80">Why ranked: {pfz.reasons.join(' · ')}</div>}</div>)}</div></section>
          <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-[9px] leading-relaxed text-slate-500"><div className="mb-1 flex items-center gap-1 font-bold text-slate-300"><ChevronDown className="h-3 w-3" />How to verify</div>The result is generated from the repository PFZ advisories, then ranked using fisher-to-PFZ distance, advisory freshness and available live marine conditions. Move the input coordinates and confirm the nearest advisory/ranking changes.</section>
        </>}
      </div>
    </aside>}
  </>;
}
