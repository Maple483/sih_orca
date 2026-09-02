# Marine Productivity feature

The separate `FishProductivityPanel` uses:

- `data/Combined_Marine_Landings.csv` — annual species × coastal-state landings.
- `data/synthetic_indian_coastal_sst_chlorophyll_2007_2012.csv` — monthly 2007–2012 SST/chlorophyll prototype series.

## Start the backend

From `orca-backend`:

```bash
pip install -r requirements.txt
python run.py
```

`run.py` preserves the existing `main.py` API and additionally mounts:

- `GET /api/marine-productivity/regions`
- `GET /api/marine-productivity/analysis?state=Kerala`
- `GET /api/marine-productivity/analysis?state=Kerala&species=Sardinella%20Indian%20Oil%20Sardine`
- `GET /api/marine-productivity/compare?region_a=Kerala&region_b=Goa`

The frontend panel is already mounted by `src/main.tsx` and opens independently from the main Leaflet map.

## Analytics included

- Annual fish-catch trend
- Fish-type filtering and dominant species
- Mean SST and chlorophyll context
- Seasonal summaries
- Catch–SST and catch–chlorophyll Pearson correlation
- Catch anomaly detection using `|z-score| >= 2`
- Region-vs-region comparison
- Plain-language productivity explanation

**Important:** the SST/chlorophyll file is synthetic. The UI/API explicitly treats it as exploratory evidence and warns that it should be replaced by observed satellite/oceanographic data before scientific publication.
