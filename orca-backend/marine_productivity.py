"""Marine productivity analytics for ORCA."""
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

def _state_columns(df: pd.DataFrame) -> dict[str,str]:
    result={}
    for col in df.columns:
        if "REGION NO." not in col or "Total" in col: continue
        tail=col.rsplit(" - ",1)[-1].strip()
        aliases={"Pondi- cherry":"Puducherry","A.P.":"Andhra Pradesh","T.N.":"Tamil Nadu","W.B.":"West Bengal","A & N Islands":"Andaman & Nicobar","Orissa":"Odisha"}
        tail=aliases.get(tail,tail)
        result[tail]=col
    return result

def _load():
    if not LANDINGS.exists() or not ENVIRONMENT.exists(): raise FileNotFoundError("Marine productivity data files are missing")
    land=pd.read_csv(LANDINGS); env=pd.read_csv(ENVIRONMENT)
    land["Year"]=pd.to_numeric(land["Year"],errors="coerce"); env["Year"]=pd.to_numeric(env["Year"],errors="coerce").astype(int); env["Month"]=pd.to_numeric(env["Month"],errors="coerce").astype(int)
    env["State"]=env["State"].astype(str).str.strip(); return land,env,_state_columns(land)

def _clean(s): return re.sub(r"\s+"," ",str(s).strip())
def _landing_year_species(land,col):
    x=land[["Year","Species",col]].copy(); x[col]=pd.to_numeric(x[col],errors="coerce").fillna(0); x=x.rename(columns={col:"catch_tonnes"}); x=x[x["Species"].astype(str).str.strip().str.lower()!="total"]; x["Species"]=x["Species"].astype(str).str.strip(); return x.groupby(["Year","Species"],as_index=False)["catch_tonnes"].sum()
def _corr(a,b):
    z=pd.concat([a,b],axis=1).dropna(); return None if len(z)<3 or z.iloc[:,0].nunique()<2 or z.iloc[:,1].nunique()<2 else float(z.iloc[:,0].corr(z.iloc[:,1]))
def _anomaly(df,col):
    s=df[col].astype(float); sd=s.std(ddof=0); df=df.copy(); df["z_score"]=0 if sd==0 else (s-s.mean())/sd; df["anomaly"]=df["z_score"].abs()>=2; return df
def _records(df):
    """Convert a DataFrame to JSON-safe records, casting any lingering
    numpy scalar types (int64, float64, bool_) to native Python types.
    Without this, FastAPI's default JSON encoder raises a 500 error on
    columns like int64 counts, even though the DataFrame itself is fine."""
    return [
        {k: (v.item() if hasattr(v, "item") else v) for k, v in row.items()}
        for row in df.to_dict("records")
    ]

def build_analysis(state:str,species:Optional[str]=None,start_year:int=2007,end_year:int=2012):
    land,env,states=_load(); state=_clean(state)
    if state not in states: raise HTTPException(404,detail={"message":"Unknown coastal region","supported_states":sorted(env["State"].unique().tolist())})
    x=_landing_year_species(land,states[state]); x=x[x["Year"].between(start_year,end_year)]
    if species: x=x[x["Species"].str.lower()==species.strip().lower()]
    annual=x.groupby("Year",as_index=False)["catch_tonnes"].sum().rename(columns={"catch_tonnes":"catch"}); aa=_anomaly(annual,"catch")
    e=env[(env["State"]==state)&env["Year"].between(start_year,end_year)].copy(); e["catch"]=e["Year"].map(dict(zip(annual["Year"],annual["catch"])))
    ea=e.groupby("Year",as_index=False).agg(sst=("SST_C","mean"),chlorophyll=("Chlorophyll_mg_m3","mean"),sst_anomaly=("SST_anomaly_C","mean"),chlorophyll_anomaly=("Chlorophyll_anomaly_mg_m3","mean")); m=annual.merge(ea,on="Year",how="left"); m["catch_z"]=aa["z_score"].values; m["catch_anomaly"]=aa["anomaly"].values; m["catch_growth_pct"]=(m["catch"].pct_change()*100).replace([np.inf,-np.inf],None)
    seasonal=e.groupby("Season",as_index=False).agg(mean_catch=("catch","mean"),mean_sst=("SST_C","mean"),mean_chlorophyll=("Chlorophyll_mg_m3","mean"),months=("Month","count"))
    sy=x.groupby(["Year","Species"],as_index=False)["catch_tonnes"].sum(); top=sy.groupby("Species",as_index=False)["catch_tonnes"].sum().sort_values("catch_tonnes",ascending=False).head(8)
    return {"state":state,"species_filter":species,"environment_is_synthetic":True,"annual":_records(m.fillna(0).round(4)),"seasonal":_records(seasonal.fillna(0).round(4)),"top_species":_records(top.round(2)),"species":sorted(sy["Species"].unique().tolist()),"correlation":{"catch_vs_sst":_corr(m["catch"],m["sst"]),"catch_vs_chlorophyll":_corr(m["catch"],m["chlorophyll"])},"anomaly_rule":"|z-score| >= 2","anomalies":_records(m.loc[m["catch_anomaly"],["Year","catch","catch_z"]]),"explanation":_explain(m,seasonal,species)}

def _explain(m,s,species):
    delta=float(m.iloc[-1].catch-m.iloc[0].catch) if len(m)>1 else 0; direction="increasing" if delta>0 else "decreasing" if delta<0 else "stable"; cr=_corr(m["catch"],m["chlorophyll"]); sr=_corr(m["catch"],m["sst"]); peak=s.loc[s["mean_catch"].idxmax(),"Season"] if not s.empty else None
    return {"direction":direction,"text":f"Landings are {direction} across the selected period. Catch–chlorophyll correlation is {cr:.2f} and catch–SST correlation is {sr:.2f}. Highest mean seasonal catch occurs in {peak}. Environmental variables are supporting correlation evidence, not proof of causation.","caution":"The SST/chlorophyll series is synthetic and should be replaced by observed satellite/oceanographic data before scientific publication.","peak_season":peak}

@router.get("/regions")
def regions():
    _,e,_=_load(); return {"regions":sorted(e["State"].unique().tolist()),"years":[2007,2008,2009,2010,2011,2012]}
@router.get("/analysis")
def analysis(state:str=Query(...),species:Optional[str]=Query(None),start_year:int=2007,end_year:int=2012): return build_analysis(state,species,start_year,end_year)
@router.get("/compare")
def compare(region_a:str=Query(...),region_b:str=Query(...),species:Optional[str]=Query(None)):
    a=build_analysis(region_a,species); b=build_analysis(region_b,species)
    def avg(x,k): return float(np.mean([r[k] for r in x["annual"]])) if x["annual"] else 0
    return {"region_a":{"state":a["state"],"mean_catch":avg(a,"catch"),"mean_sst":avg(a,"sst"),"mean_chlorophyll":avg(a,"chlorophyll"),"correlation":a["correlation"]},"region_b":{"state":b["state"],"mean_catch":avg(b,"catch"),"mean_sst":avg(b,"sst"),"mean_chlorophyll":avg(b,"chlorophyll"),"correlation":b["correlation"]}}
