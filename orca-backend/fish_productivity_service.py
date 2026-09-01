"""Fish productivity analytics service for ORCA.

Run independently with:
    uvicorn fish_productivity_service:app --host 0.0.0.0 --port 8001

Data files expected in ./data:
    fish_landings.csv        - India fish landings from data.gov.in
    sst_chlorophyll.csv      - prepared NASA Ocean Color point/grid observations
    pfz_advisories.csv       - already present in this repository

The service intentionally accepts several common column names so the raw
Government/NASA exports do not have to be manually renamed.
"""

import csv
import math
import os
import re
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FISH_FILE = os.path.join(DATA_DIR, "fish_landings.csv")
ENV_FILE = os.path.join(DATA_DIR, "sst_chlorophyll.csv")
PFZ_FILE = os.path.join(DATA_DIR, "pfz_advisories.csv")

app = FastAPI(title="ORCA Fish Productivity Analytics")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).strip().lower())


def pick(row: Dict[str, Any], names: List[str]) -> Optional[Any]:
    normalized = {clean_key(k): v for k, v in row.items()}
    for name in names:
        value = normalized.get(clean_key(name))
        if value is not None and str(value).strip() != "":
            return value
    return None


def number(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    match = re.search(r"[-+]?\d*\.?\d+", text)
    if not match:
        return None
    try:
        return float(match.group())
    except ValueError:
        return None


def year_value(value: Any) -> Optional[int]:
    n = number(value)
    if n is not None and 1900 <= int(n) <= 2100:
        return int(n)
    match = re.search(r"(19\d{2}|20\d{2}|21\d{2})", str(value))
    return int(match.group()) if match else None


def month_value(value: Any) -> Optional[int]:
    if value is None:
        return None
    n = number(value)
    if n is not None and 1 <= int(n) <= 12:
        return int(n)
    text = str(value).lower().strip()
    months = {m.lower(): i for i, m in enumerate(
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1
    )}
    for name, idx in months.items():
        if text.startswith(name[:3]):
            return idx
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).month
    except Exception:
        return None


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def read_csv(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_fish() -> List[Dict[str, Any]]:
    output = []
    for row in read_csv(FISH_FILE):
        y = year_value(pick(row, ["year", "yr", "financial year", "year of landing", "date"]))
        if y is None:
            continue
        catch = number(pick(row, ["catch", "landings", "landing", "quantity", "production", "fish catch", "total catch", "tonnes", "000 tonnes"]))
        if catch is None:
            continue
        species = str(pick(row, ["species", "fish species", "fish", "group of species", "species group", "fish type"]) or "Unknown").strip()
        region = str(pick(row, ["coast", "coastal region", "region", "state", "state/ut", "state name", "ut"]) or "All India").strip()
        lat = number(pick(row, ["latitude", "lat"]))
        lon = number(pick(row, ["longitude", "lon", "lng"]))
        month = month_value(pick(row, ["month", "date", "landing month"]))
        output.append({"year": y, "month": month, "catch": catch, "species": species, "region": region, "lat": lat, "lon": lon})
    return output


def load_environment() -> List[Dict[str, Any]]:
    output = []
    for row in read_csv(ENV_FILE):
        y = year_value(pick(row, ["year", "date", "datetime", "time"]))
        if y is None:
            continue
        month = month_value(pick(row, ["month", "date", "datetime", "time"]))
        lat = number(pick(row, ["latitude", "lat"]))
        lon = number(pick(row, ["longitude", "lon", "lng"]))
        sst = number(pick(row, ["sst", "sea surface temperature", "sst c", "sst_c", "temperature"]))
        chl = number(pick(row, ["chlorophyll", "chlorophyll a", "chlor_a", "chl", "chl a"]))
        if sst is None and chl is None:
            continue
        output.append({"year": y, "month": month, "lat": lat, "lon": lon, "sst": sst, "chlorophyll": chl})
    return output


def load_pfz() -> List[Dict[str, Any]]:
    rows = []
    for idx, row in enumerate(read_csv(PFZ_FILE)):
        lat = number(pick(row, ["Latitude_Decimal", "latitude", "lat"]))
        lon = number(pick(row, ["Longitude_Decimal", "longitude", "lon"]))
        if lat is None or lon is None:
            continue
        rows.append({
            "id": str(idx),
            "lat": lat,
            "lon": lon,
            "coast": str(pick(row, ["From the coast of", "coast", "coast name"]) or "Unknown"),
            "state": str(pick(row, ["State", "state"]) or "Unknown"),
            "direction": str(pick(row, ["Direction", "direction"]) or ""),
            "validity": str(pick(row, ["Forecast_Validity", "validity"]) or ""),
            "depth": str(pick(row, ["Depth (mtr) From-To", "depth"]) or ""),
        })
    return rows


class AnalyzeRequest(BaseModel):
    mode: str = "region"
    region: Optional[str] = None
    pfz_id: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    species: Optional[str] = None
    compare_region: Optional[str] = None


def nearest_pfz(lat: float, lon: float, pfz: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not pfz:
        return None
    return min(pfz, key=lambda p: haversine(lat, lon, p["lat"], p["lon"]))


def pearson(a: List[float], b: List[float]) -> Optional[float]:
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    xa = [p[0] for p in pairs]
    xb = [p[1] for p in pairs]
    ma, mb = sum(xa) / len(xa), sum(xb) / len(xb)
    da = math.sqrt(sum((x - ma) ** 2 for x in xa))
    db = math.sqrt(sum((x - mb) ** 2 for x in xb))
    if da == 0 or db == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in pairs) / (da * db)


def zscore(value: float, values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((x - mean) ** 2 for x in values) / len(values))
    return 0.0 if sd == 0 else (value - mean) / sd


def slope(points: List[Tuple[int, float]]) -> float:
    if len(points) < 2:
        return 0.0
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return 0.0 if den == 0 else sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def season(month: Optional[int]) -> str:
    if month is None:
        return "Unknown"
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Pre-monsoon"
    if month in (6, 7, 8, 9):
        return "Monsoon"
    return "Post-monsoon"


def filter_fish(rows: List[Dict[str, Any]], req: AnalyzeRequest, pfz: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    selected_pfz = None
    if req.mode == "coordinate":
        if req.lat is None or req.lon is None:
            raise HTTPException(400, "Latitude and longitude are required for coordinate mode")
        selected_pfz = nearest_pfz(req.lat, req.lon, pfz)
    elif req.mode == "pfz" and req.pfz_id:
        selected_pfz = next((p for p in pfz if p["id"] == req.pfz_id), None)

    target = req.region
    if selected_pfz:
        target = selected_pfz["coast"] or selected_pfz["state"]

    filtered = rows
    if target and target.lower() not in ("all", "all india", "india"):
        needle = target.lower()
        filtered = [r for r in rows if needle in r["region"].lower() or r["region"].lower() in needle]
        if not filtered and selected_pfz:
            state = selected_pfz["state"].lower()
            filtered = [r for r in rows if state and state in r["region"].lower()]

    if req.species and req.species.lower() != "all":
        filtered = [r for r in filtered if req.species.lower() in r["species"].lower()]

    if req.mode == "coordinate" and req.lat is not None and req.lon is not None:
        geo_rows = [r for r in filtered if r["lat"] is not None and r["lon"] is not None]
        if geo_rows:
            filtered = sorted(geo_rows, key=lambda r: haversine(req.lat, req.lon, r["lat"], r["lon"]))[: max(50, min(500, len(geo_rows)))]

    return filtered, {"selected_pfz": selected_pfz, "target_region": target or "All India"}


def env_for_location(env: List[Dict[str, Any]], req: AnalyzeRequest, selected_pfz: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not env:
        return []
    lat, lon = req.lat, req.lon
    if lat is None and selected_pfz:
        lat, lon = selected_pfz["lat"], selected_pfz["lon"]
    if lat is None:
        return env
    with_geo = [e for e in env if e["lat"] is not None and e["lon"] is not None]
    if not with_geo:
        return env
    # Keep observations in a ~100 km neighbourhood; if no rows match, use nearest 500 rows.
    local = [e for e in with_geo if haversine(lat, lon, e["lat"], e["lon"]) <= 100]
    if local:
        return local
    return sorted(with_geo, key=lambda e: haversine(lat, lon, e["lat"], e["lon"]))[:500]


def aggregate_year(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets = defaultdict(float)
    for r in rows:
        buckets[r["year"]] += r["catch"]
    return [{"year": y, "catch": round(buckets[y], 3)} for y in sorted(buckets)]


def aggregate_species(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets = defaultdict(float)
    for r in rows:
        buckets[r["species"]] += r["catch"]
    return [{"species": s, "catch": round(v, 3)} for s, v in sorted(buckets.items(), key=lambda x: x[1], reverse=True)[:15]]


def aggregate_species_year(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets = defaultdict(float)
    for r in rows:
        buckets[(r["year"], r["species"])] += r["catch"]
    return [{"year": y, "species": s, "catch": round(v, 3)} for (y, s), v in sorted(buckets.items())]


def aggregate_environment(env: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets = defaultdict(lambda: {"sst": [], "chlorophyll": []})
    for r in env:
        b = buckets[r["year"]]
        if r["sst"] is not None: b["sst"].append(r["sst"])
        if r["chlorophyll"] is not None: b["chlorophyll"].append(r["chlorophyll"])
    result = []
    for y in sorted(buckets):
        b = buckets[y]
        result.append({
            "year": y,
            "sst": round(sum(b["sst"]) / len(b["sst"]), 3) if b["sst"] else None,
            "chlorophyll": round(sum(b["chlorophyll"]) / len(b["chlorophyll"]), 5) if b["chlorophyll"] else None,
        })
    return result


def heatmap(env: List[Dict[str, Any]], parameter: str) -> List[Dict[str, Any]]:
    valid = [e for e in env if e.get("lat") is not None and e.get("lon") is not None and e.get(parameter) is not None]
    # Downsample to a compact grid for the browser.
    grid = {}
    for e in valid:
        lat = round(e["lat"] * 2) / 2
        lon = round(e["lon"] * 2) / 2
        key = (lat, lon)
        grid.setdefault(key, []).append(e[parameter])
    return [{"lat": k[0], "lon": k[1], "value": round(sum(v) / len(v), 5)} for k, v in grid.items()]


@app.get("/api/fish-productivity/regions")
def regions() -> Dict[str, Any]:
    fish = load_fish()
    pfz = load_pfz()
    regions = sorted({r["region"] for r in fish if r["region"]})
    pfz_regions = sorted({p["coast"] for p in pfz if p["coast"]})
    species = sorted({r["species"] for r in fish if r["species"]})
    return {"regions": sorted(set(regions + pfz_regions)), "species": species, "pfz": pfz, "fish_rows": len(fish), "environment_rows": len(load_environment())}


@app.post("/api/fish-productivity/analyze")
def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    fish = load_fish()
    env = load_environment()
    pfz = load_pfz()
    if not fish:
        raise HTTPException(404, "fish_landings.csv was not found or contains no recognizable Year/Catch rows")

    selected, selection = filter_fish(fish, req, pfz)
    if not selected:
        return {"selection": selection, "message": "No fish landing records matched this selection.", "years": [], "species": [], "environment": [], "heatmaps": {"chlorophyll": [], "sst": []}}

    selected_env = env_for_location(env, req, selection.get("selected_pfz"))
    years = aggregate_year(selected)
    species = aggregate_species(selected)
    species_year = aggregate_species_year(selected)
    environment = aggregate_environment(selected_env)

    # Merge annual fisheries + environment series and calculate anomalies/correlation.
    env_map = {r["year"]: r for r in environment}
    catches = [r["catch"] for r in years]
    catch_map = {r["year"]: r["catch"] for r in years}
    catch_years = [r["year"] for r in years]
    merged = []
    for y in sorted(set(catch_years) | set(env_map)):
        c = catch_map.get(y)
        e = env_map.get(y, {})
        merged.append({"year": y, "catch": c, "sst": e.get("sst"), "chlorophyll": e.get("chlorophyll")})

    sst_pairs = [(r["catch"], r["sst"]) for r in merged if r["catch"] is not None and r["sst"] is not None]
    chl_pairs = [(r["catch"], r["chlorophyll"]) for r in merged if r["catch"] is not None and r["chlorophyll"] is not None]
    corr_sst = pearson([p[0] for p in sst_pairs], [p[1] for p in sst_pairs]) if sst_pairs else None
    corr_chl = pearson([p[0] for p in chl_pairs], [p[1] for p in chl_pairs]) if chl_pairs else None

    for r in merged:
        r["catch_anomaly"] = round(zscore(r["catch"], catches), 3) if r["catch"] is not None else None
    anomalies = [r for r in merged if r["catch_anomaly"] is not None and abs(r["catch_anomaly"]) >= 2]

    trend = slope([(r["year"], r["catch"]) for r in years])
    direction = "increasing" if trend > 0 else "decreasing" if trend < 0 else "stable"
    first = years[0]["catch"] if years else 0
    last = years[-1]["catch"] if years else 0
    pct = ((last - first) / first * 100) if first else None

    explanation_bits = []
    if direction == "increasing":
        explanation_bits.append(f"Fish productivity shows an overall increasing trend ({pct:.1f}% from the first to the latest available year)." if pct is not None else "Fish productivity shows an overall increasing trend.")
    elif direction == "decreasing":
        explanation_bits.append(f"Fish productivity shows an overall decreasing trend ({pct:.1f}% from the first to the latest available year)." if pct is not None else "Fish productivity shows an overall decreasing trend.")
    else:
        explanation_bits.append("Fish productivity is broadly stable over the available period.")
    if corr_chl is not None:
        explanation_bits.append(f"Catch vs chlorophyll correlation is {corr_chl:.2f}; positive values indicate higher catches tend to coincide with higher chlorophyll.")
    if corr_sst is not None:
        explanation_bits.append(f"Catch vs SST correlation is {corr_sst:.2f}; this is an association, not proof of causation.")
    if anomalies:
        explanation_bits.append(f"{len(anomalies)} catch anomaly year(s) exceed ±2 standard deviations and are flagged for investigation.")
    if not env:
        explanation_bits.append("No NASA environmental CSV was found, so SST/chlorophyll correlation and heatmaps are waiting for the environmental export.")

    seasons = defaultdict(float)
    for r in selected:
        seasons[season(r["month"])] += r["catch"]
    seasonal = [{"season": k, "catch": round(v, 3)} for k, v in seasons.items() if k != "Unknown"]
    seasonal.sort(key=lambda x: x["catch"], reverse=True)

    comparison = None
    if req.compare_region:
        compare_req = AnalyzeRequest(mode="region", region=req.compare_region, species=req.species)
        compare_rows, _ = filter_fish(fish, compare_req, pfz)
        compare_year = aggregate_year(compare_rows)
        comparison = {"region": req.compare_region, "years": compare_year, "total_catch": round(sum(r["catch"] for r in compare_rows), 3)}

    return {
        "selection": selection,
        "years": years,
        "species": species,
        "species_year": species_year,
        "environment": environment,
        "merged": merged,
        "seasonal": seasonal,
        "anomalies": anomalies,
        "heatmaps": {"chlorophyll": heatmap(selected_env, "chlorophyll"), "sst": heatmap(selected_env, "sst")},
        "correlation": {"catch_chlorophyll": corr_chl, "catch_sst": corr_sst},
        "trend": {"direction": direction, "slope": round(trend, 4), "percent_change": round(pct, 2) if pct is not None else None},
        "explanation": " ".join(explanation_bits),
        "comparison": comparison,
        "data_status": {"fish_rows": len(fish), "environment_rows": len(env), "selected_fish_rows": len(selected)},
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "fish_file": os.path.exists(FISH_FILE), "environment_file": os.path.exists(ENV_FILE), "pfz_file": os.path.exists(PFZ_FILE)}
