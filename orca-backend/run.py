"""Primary ORCA backend entry point.

Starts the existing FastAPI gateway and mounts the Marine Productivity API.
Run with: python run.py
"""
from fastapi import Query
from main import app
from marine_productivity import router as marine_productivity_router, pfz_recommendation

# Mount all Marine Productivity routes, including the live PFZ recommender.
app.include_router(marine_productivity_router)

# Short compatibility alias. This also makes it easy to test the PFZ service
# directly in a browser without depending on the frontend route construction.
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
