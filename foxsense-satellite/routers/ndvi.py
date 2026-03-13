"""POST /ndvi/bbox — HLS NDVI 時系列"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import stac, raster, indices

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_WORKERS = 5


class NdviRequest(BaseModel):
    bbox: list[float]
    polygon: list | None = None
    start_date: str
    end_date: str
    cloud_max: float = 30


def _read_hls_scene(item, bbox: list[float]) -> dict | None:
    bm = indices.band_map(item)
    cid = item.collection_id or ""
    try:
        # クラウドマスク読み込み
        fmask_raw = raster.read_fmask(item.assets[bm["fmask"]].href, bbox)

        # Red / NIR
        red_raw = raster.read_band(item.assets[bm["red"]].href, bbox)
        nir_raw = raster.read_band(item.assets[bm["nir"]].href, bbox)

        if red_raw is None or nir_raw is None:
            return None

        red = raster.apply_fmask(raster.scale_band(red_raw, cid), fmask_raw, cid)
        nir = raster.apply_fmask(raster.scale_band(nir_raw, cid), fmask_raw, cid)

        ndvi_arr = indices.ndvi(nir, red)
        ndvi_mean = indices.nanmean(ndvi_arr)
        if ndvi_mean is None:
            return None

        # Green / SWIR1（オプション）
        green_raw = raster.read_band(item.assets[bm["green"]].href, bbox)
        swir_raw  = raster.read_band(item.assets[bm["swir1"]].href, bbox)

        # SWIR1 は 20m 解像度（B11）のため NIR（10m, B08）と形状が異なる → リサイズ
        if swir_raw is not None and nir_raw is not None and swir_raw.shape != nir_raw.shape:
            from scipy.ndimage import zoom
            zy = nir_raw.shape[0] / swir_raw.shape[0]
            zx = nir_raw.shape[1] / swir_raw.shape[1]
            swir_raw = zoom(swir_raw, (zy, zx), order=1).astype(swir_raw.dtype)

        green = raster.apply_fmask(raster.scale_band(green_raw, cid), fmask_raw, cid)
        swir  = raster.apply_fmask(raster.scale_band(swir_raw,  cid), fmask_raw, cid)

        ndwi_mean = indices.nanmean(indices.ndwi(green, nir))
        ndmi_mean = indices.nanmean(indices.ndmi(nir, swir))
        veg_ratio = indices.vegetation_ratio(ndvi_arr)

        dt = item.datetime or item.properties.get("datetime", "")
        if hasattr(dt, "strftime"):
            date_str = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            date_str = str(dt)

        # RedEdge は Sentinel-2 のみ（Landsat なし）
        has_rededge = bm.get("rededge") is not None

        return {
            "datetime": date_str,
            "collection": cid,
            "cloud_cover": round(item.properties.get("eo:cloud_cover", 0), 1),
            "ndvi": {
                "mean": round(ndvi_mean, 4),
                "vegetation_ratio": round(veg_ratio, 3) if veg_ratio is not None else None,
            },
            "ndwi_mean": round(ndwi_mean, 4) if ndwi_mean is not None else None,
            "ndre_mean": None,  # NDRE は別途 S2 専用エンドポイントで取得
            "ndmi_mean": round(ndmi_mean, 4) if ndmi_mean is not None else None,
            "status": indices.ndvi_status(ndvi_mean),
        }
    except Exception as e:
        logger.warning(f"scene {item.id} failed: {e}")
        return None


@router.post("/ndvi/bbox")
def ndvi_bbox(req: NdviRequest):
    items = stac.search_hls(req.bbox, req.start_date, req.end_date, req.cloud_max)
    if not items:
        raise HTTPException(
            status_code=404,
            detail="指定期間・エリアの衛星シーンが見つかりませんでした。期間を広げるか雲量制限を緩めてください。",
        )

    scenes = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_read_hls_scene, item, req.bbox): item for item in items}
        for future in as_completed(futures):
            try:
                result = future.result(timeout=45)
                if result:
                    scenes.append(result)
            except Exception as e:
                logger.warning(f"future failed: {e}")

    if not scenes:
        raise HTTPException(
            status_code=422,
            detail=f"全シーンが雲量 {req.cloud_max}% 超でした。cloud_max を上げるか期間を変更してください。",
        )

    scenes.sort(key=lambda s: s["datetime"])
    return {"scenes": scenes, "scene_count": len(scenes)}
