"""Marine productivity analytics for ORCA.

Uses the annual species/state marine-landings dataset together with the
synthetic monthly coastal SST/chlorophyll dataset in data/.

The environmental dataset is explicitly marked synthetic; analytics should
therefore be presented as exploratory/decision-support evidence, not as
observed satellite measurements.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional
import re

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/marine-productivity", tags=["Marine Productivity"])

BASE = Path(__file__).resolve().parent / "data"
LANDINGS = BASE / "Combined_Marine_Landings.csv"
ENVIRONMENT = BASE / "synthetic_indian_coastal_sst_chlorophyll_2007_2012.csv"


def _state_columns(df: pd.DataFrame) -> dict[str, str]:
    """Map normalized state names to the state-specific landing columns."""
    result: dict[str, str] = {}
    for col in df.columns:
        if "REGION NO." not in col or "Total" in col:
            continue
        tail = col.rsplit(" - ", 1)[-1].strip()
        tail = tail.replace("Pondi- cherry", "Puducherry").replace("A.P.", "Andhra Pradesh")
        tail = tail.replace("T.N.", "Tamil Nadu").replace("W.B.", "West Bengal")
        tail = tail.replace("A & N Islands", "Andaman & Nicobar")
        result[tail] = col
    return result


def _load() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, str]]:
    if not LANDINGS.exists() or not ENVIRONMENT.exists():
        raise FileNotFoundError("Marine productivity data files are missing from orca-backend/data")
    land = pd.read_csv(LANDINGS)
    env = pd.read_csv(ENVIRONMENT)
    land["Year"] = pd.to_numeric(land["Year"], errors="coerce").astype("Int64")
    env["Year"] = pd.to_numeric(env["Year"], errors="coerce").astype(int)
    env["Month"] = pd.to_numeric(env["Month"], errors="coerce").astype(int)
    env["State"] = env["State"].astype(str).str.strip()
    return land, env, _state_columns(land)


def _clean_state(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip())


def _landing_year_species(land: pd.DataFrame, state_col: str) -> pd.DataFrame:
    x = land[["Year", "Species", state_col]].copy()
    x[state_col] = pd.to_numeric(x[state_col], errors="coerce").fillna(0)
    x = x.rename(columns={state_col: "catch_tonnes"})
    x = x[x["Species"].astype(str).str.strip().str.lower() != "total"]
    x["Species"] = x["Species"].astype(str).str.strip()
    return x.groupby(["Year", "Species"], as_index=False)["catch_tonnes"].sum()


def _pearson(a: pd.Series, b: pd.Series) -> Optional[float]:
    z = pd.concat([a, b], axis=1).dropna()
    if len(z) < 3 or z.iloc[:, 0].nunique() < 2 or z.iloc[:, 1].nunique() < 2:
        return None
    return float(z.iloc[:, 0].corr(z.iloc[:, 1]))


def _anomalies(series: pd.DataFrame, value_col: str) -> pd.DataFrame:
    s = series[value_col].astype(float)
    mean, std = s.mean(), s.std(ddof=0)
    series = series.copy()
    series["z_score"] = 0.0 if std == 0 else (s - mean) / std
    series["anomaly"] = series["z_score"].abs() >= 2.0
    return series


def build_analysis(state: str, species: Optional[str] = None, start_year: int = 2007, end_year: int = 2012):
    land, env, states = _load()
    state = _clean_state(state)
    if state not in states:
        # Environment file is authoritative for the supported coastal-state labels.
        supported = sorted(set(env["State"]))
        raise HTTPException(status_code=404, detail={"message": "Unknown coastal region", "supported_states": supported})

    x = _landing_year_species(land, states[state])
    x = x[x["Year"].between(start_year, end_year)]
    if species:
        x = x[x["Species"].str.lower() == species.strip().lower()]

    annual = x.groupby("Year", as_index=False)["catch_tonnes"].sum()
    annual = annual.rename(columns={"catch_tonnes": "catch"})
    annual_anom = _anomalies(annual, "catch")

    e = env[(env["State"] == state) & env["Year"].between(start_year, end_year)].copy()
    if e.empty:
        raise HTTPException(status_code=404, detail="No environmental observations for selected region")
    e["catch"] = e["Year"].map(dict(zip(annual["Year"], annual["catch"])))

    env_annual = e.groupby("Year", as_index=False).agg(
        sst=("SST_C", "mean"),
        chlorophyll=("Chlorophyll_mg_m3", "mean"),
        sst_anomaly=("SST_anomaly_C", "mean"),
        chlorophyll_anomaly=("Chlorophyll_anomaly_mg_m3", "mean"),
    )
    merged = annual.merge(env_annual, on="Year", how="left")
    merged["catch_growth_pct"] = merged["catch"].pct_change() * 100
    merged["catch_z"] = annual_anom["z_score"].values
    merged["catch_anomaly"] = annual_anom["anomaly"].values

    seasonal = e.groupby("Season", as_index=False).agg(
        mean_catch=("catch", "mean"),
        mean_sst=("SST_C", "mean"),
        mean_chlorophyll=("Chlorophyll_mg_m3", "mean"),
        months=("Month", "count"),
    )
    seasonal["catch_per_environment"] = seasonal["mean_catch"] / seasonal["mean_chlorophyll"].replace(0, np.nan)

    species_year = x.groupby(["Year", "Species"], as_index=False)["catch_tonnes"].sum()
    top_species = (species_year.groupby("Species", as_index=False)["catch_tonnes"].sum()
                   .sort_values("catch_tonnes", ascending=False).head(8))

    return {
        "state": state,
        "species_filter": species,
        "years": list(range(start_year, end_year + 1)),
        "environment_is_synthetic": True,
        "annual": merged.fillna(0).round(4).to_dict("records"),
        "seasonal": seasonal.fillna(0).round(4).to_dict("records"),
        "top_species": top_species.round(2).to_dict("records"),
        "correlation": {
            "catch_vs_sst": _pearson(merged["catch"], merged["sst"]),
            "catch_vs_chlorophyll": _pearson(merged["catch"], merged["chlorophyll"]),
        },
        "species": sorted(species_year["Species"].unique().tolist()),
        "anomaly_rule": "|z-score| >= 2",
        "anomalies": merged.loc[merged["catch_anomaly"], ["Year", "catch", "catch_z"]].to_dict("records"),
        "explanation": _explain(merged, seasonal, species),
    }


def _explain(annual: pd.DataFrame, seasonal: pd.DataFrame, species: Optional[str]) -> dict:
    if len(annual) < 2:
        return {"direction": "insufficient_data", "text": "Not enough annual observations for a trend explanation."}
    catch_delta = float(annual.iloc[-1]["catch"] - annual.iloc[0]["catch"])
    chl_corr = annual["catch"].corr(annual["chlorophyll"])
    sst_corr = annual["catch"].corr(annual["sst"])
    if catch_delta > 0:
        direction = "increasing"
        text = "Landings increased across the selected period."
    elif catch_delta < 0:
        direction = "decreasing"
        text = "Landings decreased across the selected period."
    else:
        direction = "stable"
        text = "Landings were broadly stable across the selected period."
    factors = []
    if pd.notna(chl_corr):
        factors.append(f"catch–chlorophyll correlation is {chl_corr:.2f}")
    if pd.notna(sst_corr):
        factors.append(f"catch–SST correlation is {sst_corr:.2f}")
    peak = seasonal.loc[seasonal["mean_catch"].idxmax(), "Season"] if not seasonal.empty else None
    if peak:
        factors.append(f"highest mean seasonal catch occurs in {peak}")
    label = f" for {species}" if species else ""
    return {
        "direction": direction,
        "text": f"{text}{label} Environmental variables provide supporting correlation evidence, not proof of causation. " + "; ".join(factors) + ".",
        "caution": "The SST/chlorophyll series in this prototype is synthetic and should be replaced by observed satellite/oceanographic data before scientific publication.",
        "peak_season": peak,
    }


@router.get("/regions")
def regions():
    _, env, _ = _load()
    return {"regions": sorted(env["State"].dropna().unique().tolist()), "years": [2007, 2008, 2009, 2010, 2011, 2012]}


@router.get("/analysis")
def analysis(state: str = Query(...), species: Optional[str] = Query(None), start_year: int = 2007, end_year: int = 2012):
    return build_analysis(state, species, start_year, end_year)


@router.get("/compare")
def compare(region_a: str = Query(...), region_b: str = Query(...), species: Optional[str] = Query(None)):
    a = build_analysis(region_a, species)
    b = build_analysis(region_b, species)
    def avg(x, key):
        vals = [r[key] for r in x["annual"] if r.get(key) is not None]
        return float(np.mean(vals)) if vals else 0.0
    return {
        "region_a": {"state": a["state"], "mean_catch": avg(a, "catch"), "mean_sst": avg(a, "sst"), "mean_chlorophyll": avg(a, "chlorophyll"), "correlation": a["correlation"]},
        "region_b": {"state": b["state"], "mean_catch": avg(b, "catch"), "mean_sst": avg(b, "sst"), "mean_chlorophyll": avg(b, "chlorophyll"), "correlation": b["correlation"]},
    }
