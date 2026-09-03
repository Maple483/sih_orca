"""Live satellite-assisted PFZ recommendation service for ORCA.

This is intentionally separate from the historical Marine Productivity analytics.
It uses the repository's PFZ advisory nodes as candidate fishing grounds and
samples current NOAA satellite SST + chlorophyll around those nodes before
ranking them for the fisherman's location.
"""
from __future__ import annotations

import csv
import io
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import requests
from fastapi import HTTPException, Query

BASE = Path(__file__).resolve().parent / "data"
PFZ_DATA = BASE / "pfz_advisories.csv"

SST_DATASET = "noaacwSNPPACSPOSSTL3GCDaily"
CHL_DATASET = "noaacwNPPVIIRSchlaDaily"
ERDDAP = "https://coastwatch.noaa.gov/erddap/griddap"
SST_URL = f"{ERDDAP}/{SST_DATASET}.csv"
CHL_URL = f"{ERDDAP}/{CHL_DATASET}.csv"

CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
CACHE_TTL = 10 * 60
GRID = 0.0375


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_candidates() -> list[dict[str, Any]]:
    if not PFZ_DATA.exists():
        raise HTTPException(503, detail="PFZ advisory data is unavailable")
    with PFZ_DATA.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            out.append({
                "coast_name": row["From the coast of"],
                "direction": row["Direction"],
                "bearing_deg": float(row["Bearing (deg)"]),
                "distance_km_range": row["Distance (km) From-To"],
                "depth_mtr_range": row["Depth (mtr) From-To"],
                "state": row["State"],
                "validity": row["Forecast_Validity"],
                "lat": float(row["Latitude_Decimal"]),
                "lon": float(row["Longitude_Decimal"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _csv_rows(text: str) -> list[dict[str, Any]]:
    return list(csv.DictReader(io.StringIO(text)))


def _number(value: Any) -> Optional[float]:
    try:
        x = float(value)
        return x if math.isfinite(x) and x > -900 else None
    except (TypeError, ValueError):
        return None


def fetch_sst(lat: float, lon: float) -> dict[str, Any]:
    """Fetch latest available satellite SST plus a local SST-front proxy."""
    lat0 = round(lat / GRID) * GRID
    lon0 = round(lon / GRID) * GRID
    eps = GRID * 2
    query = (
        f"?sea_surface_temperature[(last)][(0)]"
        f"[({lat0 - eps:.4f}):{GRID:.4f}:({lat0 + eps:.4f})]"
        f"[({lon0 - eps:.4f}):{GRID:.4f}:({lon0 + eps:.4f})]"
    )
    r = requests.get(SST_URL + query, timeout=12)
    r.raise_for_status()
    rows = _csv_rows(r.text)
    if not rows:
        raise ValueError("No SST returned")

    values = []
    center = None
    timestamp = None
    for row in rows:
        v = _number(row.get("sea_surface_temperature"))
        if v is None:
            continue
        la = _number(row.get("latitude"))
        lo = _number(row.get("longitude"))
        values.append((la, lo, v))
        if la is not None and lo is not None and abs(la - lat0) <= GRID * 0.51 and abs(lo - lon0) <= GRID * 0.51:
            center = v
        timestamp = row.get("time") or timestamp

    if center is None and values:
        center = min(values, key=lambda x: haversine_km(lat, lon, x[0], x[1]))[2]

    # Maximum neighbouring SST difference acts as a simple front/gradient proxy.
    gradient = 0.0
    for la, lo, v in values:
        for la2, lo2, v2 in values:
            if la is None or lo is None or la2 is None or lo2 is None:
                continue
            if abs(la - la2) <= GRID * 1.01 and abs(lo - lo2) <= GRID * 1.01:
                gradient = max(gradient, abs(v - v2))

    if center is None:
        raise ValueError("Satellite SST is missing at this PFZ")
    return {
        "sst_c": center,
        "sst_gradient_c": gradient,
        "satellite_sst_time": timestamp,
    }


def fetch_chlorophyll(lat: float, lon: float) -> dict[str, Any]:
    """Fetch latest daily satellite chlorophyll-a at a PFZ node."""
    lat0 = round(lat / GRID) * GRID
    lon0 = round(lon / GRID) * GRID
    query = f"?chlor_a[(last)][(0)][({lat0:.4f})][({lon0:.4f})]"
    r = requests.get(CHL_URL + query, timeout=12)
    r.raise_for_status()
    rows = _csv_rows(r.text)
    if not rows:
        raise ValueError("No chlorophyll returned")
    row = rows[0]
    chl = _number(row.get("chlor_a"))
    if chl is None:
        raise ValueError("Satellite chlorophyll is missing at this PFZ")
    return {"chlorophyll_mg_m3": chl, "satellite_chl_time": row.get("time")}


def _minmax(values: list[float]) -> tuple[float, float]:
    return (min(values), max(values)) if values else (0.0, 1.0)


def rank_pfz(lat: float, lon: float, limit: int = 5) -> dict[str, Any]:
    candidates = load_candidates()
    if not candidates:
        raise HTTPException(503, detail="No PFZ advisory candidates are available")

    # Avoid a huge remote-data fan-out: only candidate nodes within 600 km are relevant.
    for c in candidates:
        c["distance_to_vessel_km"] = haversine_km(lat, lon, c["lat"], c["lon"])
    nearby = sorted(candidates, key=lambda x: x["distance_to_vessel_km"])
    nearby = [c for c in nearby if c["distance_to_vessel_km"] <= 600][:18] or nearby[:12]

    enriched: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(6, len(nearby))) as pool:
        jobs = {
            pool.submit(lambda c: {**fetch_sst(c["lat"], c["lon"]), **fetch_chlorophyll(c["lat"], c["lon"])} , c): c
            for c in nearby
        }
        for job in as_completed(jobs):
            c = jobs[job]
            try:
                live = job.result()
                enriched.append({**c, **live, "satellite_status": "live"})
            except Exception as exc:
                enriched.append({
                    **c,
                    "satellite_status": "unavailable",
                    "satellite_error": str(exc)[:160],
                })

    live = [x for x in enriched if x.get("satellite_status") == "live"]
    if not live:
        # Still return the nearest official advisory candidate rather than leaving the UI blank.
        fallback = sorted(enriched, key=lambda x: x["distance_to_vessel_km"])[:limit]
        for i, c in enumerate(fallback, 1):
            c["rank"] = i
            c["recommendation_mode"] = "advisory_fallback"
            c["distance_to_vessel_km"] = round(c["distance_to_vessel_km"], 1)
        return {
            "vessel_location": {"lat": lat, "lon": lon},
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "degraded",
            "recommendation_mode": "nearest_advisory_fallback",
            "data_sources": {"candidate_advisories": "ORCA/INCOIS PFZ advisory nodes"},
            "results": fallback,
            "caution": "Live satellite SST/chlorophyll feeds did not return usable values. Showing the nearest advisory nodes instead; retry for live ranking.",
        }

    chl_lo, chl_hi = _minmax([x["chlorophyll_mg_m3"] for x in live])
    grad_lo, grad_hi = _minmax([x["sst_gradient_c"] for x in live])

    for c in live:
        chl = c["chlorophyll_mg_m3"]
        grad = c["sst_gradient_c"]
        chl_score = 0.5 if abs(chl_hi - chl_lo) < 1e-9 else (chl - chl_lo) / (chl_hi - chl_lo)
        grad_score = 0.5 if abs(grad_hi - grad_lo) < 1e-9 else (grad - grad_lo) / (grad_hi - grad_lo)
        distance_score = 1.0 / (1.0 + c["distance_to_vessel_km"] / 100.0)
        # Productivity signals dominate; distance keeps the recommendation practical.
        score = 0.45 * chl_score + 0.35 * grad_score + 0.20 * distance_score
        c["pfz_score"] = round(score * 100, 1)
        c["rank_reason"] = "High chlorophyll + strong SST gradient" if grad_score >= 0.5 else "Good chlorophyll + SST conditions"

    ranked = sorted(live, key=lambda x: (-x["pfz_score"], x["distance_to_vessel_km"]))[:limit]
    for i, c in enumerate(ranked, 1):
        c["rank"] = i
        c["recommendation_mode"] = "live_satellite"
        c["distance_to_vessel_km"] = round(c["distance_to_vessel_km"], 1)
        c["lat"] = round(c["lat"], 5)
        c["lon"] = round(c["lon"], 5)
        c["bearing_deg"] = round(c["bearing_deg"], 0)
        c["sst_c"] = round(c["sst_c"], 2)
        c["sst_gradient_c"] = round(c["sst_gradient_c"], 3)
        c["chlorophyll_mg_m3"] = round(c["chlorophyll_mg_m3"], 3)

    return {
        "vessel_location": {"lat": lat, "lon": lon},
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "live",
        "recommendation_mode": "live_satellite",
        "data_sources": {
            "sst": "NOAA CoastWatch S-NPP VIIRS ACSPO near-real-time SST",
            "chlorophyll": "NOAA CoastWatch S-NPP VIIRS near-real-time chlorophyll-a",
            "candidate_advisories": "ORCA/INCOIS PFZ advisory nodes",
        },
        "method": "Nearby PFZ nodes are ranked from live chlorophyll-a, local SST-gradient/front strength and vessel distance.",
        "results": ranked,
        "caution": "ORCA ranks advisory candidates for decision support; it is not an official replacement for current government fishing advisories or local safety guidance.",
    }


def pfz_recommendation(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    limit: int = Query(5, ge=1, le=10),
) -> dict[str, Any]:
    key = f"{lat:.4f}:{lon:.4f}:{limit}"
    now = time.time()
    cached = CACHE.get(key)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]
    result = rank_pfz(lat, lon, limit)
    CACHE[key] = (now, result)
    return result
