from __future__ import annotations
from fastapi import APIRouter, Query
from marine_productivity import build_analysis

router = APIRouter(prefix="/api/marine-productivity", tags=["Marine Productivity Research"])

@router.get("/research")
def research(state: str = Query(...), species: str | None = Query(None), start_year: int = 2007, end_year: int = 2012):
    analysis = build_analysis(state, species, start_year, end_year)
    return {
        "state": analysis["state"],
        "species_filter": analysis["species_filter"],
        "correlation": analysis["correlation"],
        "strongest_relationship": analysis.get("strongest_relationship"),
        "explanation": analysis["explanation"],
        "lag_analysis": analysis.get("lag_analysis"),
        "data_coverage": {
            "requested_start_year": start_year,
            "requested_end_year": end_year,
            "monthly_catch_available": False,
            "note": "Monthly 0–3 month lag analysis requires monthly catch observations; the current landings file is annual and is not artificially disaggregated."
        }
    }
