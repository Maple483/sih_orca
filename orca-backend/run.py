"""Primary ORCA backend entry point.

Starts the existing FastAPI gateway and mounts the Marine Productivity API.
The PFZ recommendation endpoint is served by the dedicated robust satellite
service in pfz_recommender.py.
"""
from fastapi import Query
from main import app
from marine_productivity import router as marine_productivity_router
from pfz_recommender import pfz_recommendation

app.include_router(marine_productivity_router)

# Stable compatibility endpoint used by the frontend and useful for direct testing.
@app.get("/api/pfz-recommendation", tags=["Marine Productivity"])
def pfz_recommendation_compat(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    limit: int = Query(5, ge=1, le=10),
):
    return pfz_recommendation(lat=lat, lon=lon, limit=limit)

@app.get("/health", tags=["Health"])
def health():
    return {
        "status": "ok",
        "marine_productivity": "enabled",
        "pfz_recommendation": "enabled"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
