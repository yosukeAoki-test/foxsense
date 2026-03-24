import os
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from routers import ndvi, analysis, disease, boundary, maps

load_dotenv()

_API_KEY = os.getenv("SATELLITE_API_KEY", "")
_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "SATELLITE_ALLOWED_ORIGINS",
    "https://foxsense.smart-agri-vision.net"
).split(",") if o.strip()]

app = FastAPI(title="FoxSense Satellite API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
    allow_credentials=False,
)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def verify_api_key(key: str = Security(_api_key_header)):
    if not _API_KEY:
        raise HTTPException(status_code=503, detail="サーバー設定エラー: APIキーが未設定です")
    if key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


_auth = [Depends(verify_api_key)]

app.include_router(ndvi.router, dependencies=_auth)
app.include_router(analysis.router, dependencies=_auth)
app.include_router(disease.router, dependencies=_auth)
app.include_router(boundary.router, dependencies=_auth)
app.include_router(maps.router, dependencies=_auth)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/fields/parcels", dependencies=_auth)
def fields_parcels(
    lon_min: float = 0, lat_min: float = 0,
    lon_max: float = 0, lat_max: float = 0
):
    """農地区画データ（将来的に農地ナビAPIと接続予定）"""
    return {"type": "FeatureCollection", "features": []}
