// @ts-ignore -- bundled JSON dataset (Vite resolves JSON imports)
import dataset from "./dataset.json";

export type Dataset = {
  years: number[];
  states: string[];
  species: string[];
  annual: Record<string, Record<string, number[]>>;
  seasonalProfile: Record<string, number[]>;
  env: Record<string, [number, number][]>;
  provenance: { catch: string; env: string };
};

export const DATA = dataset as unknown as Dataset;
export const ALL_SPECIES = "All Species";

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const SEASONS: { name: string; months: number[] }[] = [
  { name: "Summer (Mar–May)", months: [3, 4, 5] },
  { name: "Monsoon (Jun–Sep)", months: [6, 7, 8, 9] },
  { name: "Post-monsoon (Oct–Nov)", months: [10, 11] },
  { name: "Winter (Dec–Feb)", months: [12, 1, 2] },
];

function speciesList(species: string) {
  return species === ALL_SPECIES ? DATA.species : [species];
}

/** Annual catch (tonnes) per year for a state + species selection. */
export function annualCatch(state: string, species: string): number[] {
  const list = speciesList(species);
  return DATA.years.map((_, i) =>
    list.reduce((sum, s) => sum + (DATA.annual[state]?.[s]?.[i] ?? 0), 0),
  );
}

/** Deterministic monthly catch series (tonnes), one entry per year-month. */
export function monthlyCatch(state: string, species: string): number[] {
  const list = speciesList(species);
  const out: number[] = [];
  DATA.years.forEach((year, yi) => {
    for (let m = 0; m < 12; m++) {
      let v = 0;
      for (const s of list) {
        const annual = DATA.annual[state]?.[s]?.[yi] ?? 0;
        const weight = DATA.seasonalProfile[s]?.[m] ?? 1 / 12;
        // deterministic pseudo-noise so the series is stable across renders
        const jitter = 1 + 0.06 * Math.sin(year * 3.1 + m * 1.7 + s.length);
        v += annual * weight * jitter;
      }
      out.push(v);
    }
  });
  return out;
}

export function envSeries(state: string) {
  const rows = DATA.env[state] ?? [];
  return { sst: rows.map((r) => r[0]), chl: rows.map((r) => r[1]) };
}

export function yearIndexRange(from: number, to: number) {
  const start = DATA.years.indexOf(from);
  const end = DATA.years.indexOf(to);
  return { start: Math.max(start, 0), end: end < 0 ? DATA.years.length - 1 : end };
}

export function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(0, n);
  const y = b.slice(0, n);
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    num += (xi - mx) * (yi - my);
    dx += (xi - mx) ** 2;
    dy += (yi - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Correlation of env leading catch by `lag` months. */
export function laggedCorrelation(catchM: number[], envM: number[], lag: number) {
  const a = catchM.slice(lag);
  const b = envM.slice(0, envM.length - lag || undefined);
  return pearson(a, b);
}

export type Analysis = ReturnType<typeof buildAnalysis>;

export function buildAnalysis(state: string, species: string, from: number, to: number) {
  const { start, end } = yearIndexRange(from, to);
  const years = DATA.years.slice(start, end + 1);
  const annual = annualCatch(state, species).slice(start, end + 1);

  const mStart = start * 12;
  const mEnd = (end + 1) * 12;
  const catchM = monthlyCatch(state, species).slice(mStart, mEnd);
  const { sst, chl } = envSeries(state);
  const sstM = sst.slice(mStart, mEnd);
  const chlM = chl.slice(mStart, mEnd);

  const annualLine = years.map((y, i) => ({ year: y, catch: Math.round(annual[i] ?? 0) }));

  const sstLine = years.map((y, i) => ({
    year: y,
    sst: +mean(sstM.slice(i * 12, i * 12 + 12)).toFixed(2),
  }));
  const chlLine = years.map((y, i) => ({
    year: y,
    chl: +mean(chlM.slice(i * 12, i * 12 + 12)).toFixed(3),
  }));

  const seasonal = SEASONS.map((s) => {
    let total = 0;
    catchM.forEach((v, i) => {
      if (s.months.includes((i % 12) + 1)) total += v;
    });
    return { season: s.name, catch: Math.round(total / years.length) };
  });

  const monthly = MONTHS.map((label, m) => {
    let total = 0;
    catchM.forEach((v, i) => {
      if (i % 12 === m) total += v;
    });
    return { month: label, catch: Math.round(total / years.length) };
  });

  const rChl = pearson(annual, chlLine.map((d) => d.chl));
  const rSst = pearson(annual, sstLine.map((d) => d.sst));

  const lags = [0, 1, 2, 3].map((lag) => ({
    lag,
    chl: +laggedCorrelation(catchM, chlM, lag).toFixed(2),
    sst: +laggedCorrelation(catchM, sstM, lag).toFixed(2),
  }));
  const bestChlLag = lags.reduce((a, b) => (Math.abs(b.chl) > Math.abs(a.chl) ? b : a));
  const bestSstLag = lags.reduce((a, b) => (Math.abs(b.sst) > Math.abs(a.sst) ? b : a));

  const firstThird = annual.slice(0, Math.max(1, Math.round(annual.length / 3)));
  const lastThird = annual.slice(-Math.max(1, Math.round(annual.length / 3)));
  const catchChangePct = mean(firstThird)
    ? ((mean(lastThird) - mean(firstThird)) / mean(firstThird)) * 100
    : 0;
  const sstDelta =
    mean(sstLine.slice(-5).map((d) => d.sst)) - mean(sstLine.slice(0, 5).map((d) => d.sst));
  const chlFirst = mean(chlLine.slice(0, 5).map((d) => d.chl));
  const chlChangePct = chlFirst
    ? ((mean(chlLine.slice(-5).map((d) => d.chl)) - chlFirst) / chlFirst) * 100
    : 0;

  return {
    state,
    species,
    from,
    to,
    years,
    annualLine,
    seasonal,
    monthly,
    sstLine,
    chlLine,
    correlations: {
      chlorophyll: +rChl.toFixed(2),
      sst: +rSst.toFixed(2),
      strongest: Math.abs(rChl) >= Math.abs(rSst) ? "Chlorophyll" : "SST",
    },
    lags,
    bestChlLag,
    bestSstLag,
    change: {
      catchPct: +catchChangePct.toFixed(1),
      sstDeltaC: +sstDelta.toFixed(2),
      chlPct: +chlChangePct.toFixed(1),
    },
    provenance: DATA.provenance,
  };
}

export function strength(r: number) {
  const a = Math.abs(r);
  if (a >= 0.7) return "Strong";
  if (a >= 0.4) return "Moderate";
  if (a >= 0.2) return "Weak";
  return "Negligible";
}
