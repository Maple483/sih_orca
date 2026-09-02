from __future__ import annotations
from typing import Optional
import pandas as pd

def _corr(a: pd.Series, b: pd.Series) -> Optional[float]:
    z = pd.concat([a, b], axis=1).dropna()
    if len(z) < 3 or z.iloc[:, 0].nunique() < 2 or z.iloc[:, 1].nunique() < 2:
        return None
    return float(z.iloc[:, 0].corr(z.iloc[:, 1]))

def lag_correlations(monthly: pd.DataFrame) -> list[dict]:
    rows = []
    for lag in range(4):
        x = monthly[["catch", "sst", "chlorophyll"]].copy()
        x["catch_lagged"] = x["catch"].shift(-lag)
        rows.append({"lag_months": lag, "catch_vs_sst": _corr(x["catch_lagged"], x["sst"]), "catch_vs_chlorophyll": _corr(x["catch_lagged"], x["chlorophyll"])})
    return rows

def strongest_relationship(lags: list[dict]) -> dict:
    candidates = []
    for row in lags:
        for variable, key in (("SST", "catch_vs_sst"), ("Chlorophyll", "catch_vs_chlorophyll")):
            value = row.get(key)
            if value is not None:
                candidates.append((abs(value), value, variable, row["lag_months"]))
    if not candidates:
        return {"variable": None, "lag_months": None, "r": None}
    _, value, variable, lag = max(candidates, key=lambda x: x[0])
    return {"variable": variable, "lag_months": lag, "r": value}

def build_research_extension(monthly: pd.DataFrame) -> dict:
    lags = lag_correlations(monthly)
    strongest = strongest_relationship(lags)
    if strongest["variable"]:
        lag_text = "same month" if strongest["lag_months"] == 0 else f"{strongest['lag_months']}-month lag"
        strongest_text = f"{strongest['variable']} has the strongest observed relationship with catch at a {lag_text} (r = {strongest['r']:.2f})."
    else:
        strongest_text = "There is insufficient variation to identify a strongest relationship."
    return {"lag_correlations": lags, "strongest_relationship": strongest, "strongest_relationship_text": strongest_text, "interpretation_note": "Correlation does not prove causation. Lagged correlations indicate temporal association, not a causal effect."}
