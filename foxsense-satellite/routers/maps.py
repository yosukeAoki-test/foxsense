"""POST /map/layer — マップレイヤー生成  POST /weather/spray — 散布天気予報"""
import logging
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import stac, raster, indices, colormap, weather
from services import dem as dem_service

logger = logging.getLogger(__name__)
router = APIRouter()


class MapLayerRequest(BaseModel):
    bbox: list[float]
    layer_type: str   # growth | fertility | weed | elevation | slope
    date: str | None = None
    polygon: list | None = None


class SprayWeatherRequest(BaseModel):
    bbox: list[float]


@router.post("/map/layer")
def map_layer(req: MapLayerRequest):
    """指定したレイヤータイプのカラーマップ画像を生成して返す。"""
    target_date = req.date or str(date.today())

    # ===== 標高・傾斜は DEM から =====
    if req.layer_type in ("elevation", "slope"):
        dem_arr = dem_service.read_dem(req.bbox)
        if dem_arr is None:
            raise HTTPException(status_code=404, detail="標高データが見つかりませんでした。")

        import numpy as np
        if req.layer_type == "elevation":
            arr = raster.apply_polygon_mask(dem_arr, req.polygon, req.bbox)
            vmin = float(np.nanpercentile(arr, 2))
            vmax = float(np.nanpercentile(arr, 98))
        else:
            slope = dem_service.compute_slope(dem_arr, req.bbox)
            arr = raster.apply_polygon_mask(slope, req.polygon, req.bbox)
            vmin, vmax = None, None

        b64, legend = colormap.to_base64_png(arr, req.layer_type, vmin, vmax)
        valid = arr[np.isfinite(arr)]
        stats = {
            "mean": round(float(valid.mean()), 1) if len(valid) else None,
            "min":  round(float(valid.min()),  1) if len(valid) else None,
            "max":  round(float(valid.max()),  1) if len(valid) else None,
        }
        return {
            "image_base64": b64,
            "legend": legend,
            "scene_date": None,
            "layer_type": req.layer_type,
            "stats": stats,
        }

    # ===== 衛星ベースのレイヤー =====
    import numpy as np

    item = stac.search_s2_best(req.bbox, target_date, days=60, cloud_max=50)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail="利用可能な Sentinel-2 シーンが見つかりませんでした（雲量または期間を確認してください）。"
        )

    bm = indices.S2_L2A
    cid = "sentinel-2-l2a"

    try:
        fmask_raw = raster.read_fmask(item.assets[bm["fmask"]].href, req.bbox)
        red_raw = raster.read_band(item.assets[bm["red"]].href, req.bbox)
        nir_raw = raster.read_band(item.assets[bm["nir"]].href, req.bbox)

        if red_raw is None or nir_raw is None:
            raise HTTPException(status_code=422, detail="バンドデータの読み込みに失敗しました。")

        red = raster.apply_fmask(raster.scale_band(red_raw, cid), fmask_raw, cid)
        nir = raster.apply_fmask(raster.scale_band(nir_raw, cid), fmask_raw, cid)
        ndvi_arr = indices.ndvi(nir, red)

        if req.layer_type == "growth":
            arr = ndvi_arr
            index_key = "growth"

        elif req.layer_type == "fertility":
            # B8A (narrow NIR, 20m) と B05 (RedEdge, 20m) で解像度を揃える
            nir8a_raw = raster.read_band(item.assets["B8A"].href, req.bbox)
            re_raw    = raster.read_band(item.assets["B05"].href, req.bbox)
            if nir8a_raw is None or re_raw is None:
                raise HTTPException(status_code=422, detail="B8A/B05 バンドの読み込みに失敗しました。")
            nir8a = raster.apply_fmask(raster.scale_band(nir8a_raw, cid), fmask_raw, cid)
            re    = raster.apply_fmask(raster.scale_band(re_raw,    cid), fmask_raw, cid)
            arr = indices.ndre(nir8a, re)
            index_key = "fertility"

        elif req.layer_type == "weed":
            # 雑草リスク = フィールド中央値との差異（低NDVI = 雑草/裸地リスク）
            if ndvi_arr is None:
                raise HTTPException(status_code=422, detail="NDVI 計算に失敗しました。")
            valid_ndvi = ndvi_arr[np.isfinite(ndvi_arr)]
            if len(valid_ndvi) == 0:
                raise HTTPException(status_code=422, detail="有効な NDVI データがありません。")
            field_median = float(np.median(valid_ndvi))
            # リスク = max(0, (median - ndvi) / max(median, 0.1))
            risk = np.where(
                np.isfinite(ndvi_arr),
                np.clip((field_median - ndvi_arr) / max(field_median, 0.1), 0.0, 1.0),
                np.nan,
            ).astype(np.float32)
            arr = risk
            index_key = "weed"

        else:
            raise HTTPException(status_code=400, detail=f"不明なレイヤータイプ: {req.layer_type}")

        if arr is None:
            raise HTTPException(status_code=422, detail="データ計算に失敗しました。")

        # ポリゴン外を透明化
        arr = raster.apply_polygon_mask(arr, req.polygon, req.bbox)

        b64, legend = colormap.to_base64_png(arr, index_key)

        valid = arr[np.isfinite(arr)]
        stats = {
            "mean": round(float(valid.mean()), 3) if len(valid) else None,
            "min":  round(float(valid.min()),  3) if len(valid) else None,
            "max":  round(float(valid.max()),  3) if len(valid) else None,
        }

        dt_val = item.datetime
        scene_date = dt_val.strftime("%Y-%m-%d") if hasattr(dt_val, "strftime") else str(dt_val)[:10]

        return {
            "image_base64": b64,
            "legend": legend,
            "scene_date": scene_date,
            "layer_type": req.layer_type,
            "stats": stats,
            "cloud_cover": round(item.properties.get("eo:cloud_cover", 0), 1),
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("map_layer failed")
        raise HTTPException(status_code=500, detail="レイヤーの生成に失敗しました。時間をおいて再試行してください。")


@router.post("/weather/spray")
async def spray_weather(req: SprayWeatherRequest):
    """散布天気予報（7日間）を返す。"""
    lat = (req.bbox[1] + req.bbox[3]) / 2
    lon = (req.bbox[0] + req.bbox[2]) / 2
    data = await weather.fetch_spray_forecast(lat, lon)
    if data is None:
        raise HTTPException(status_code=503, detail="天気データの取得に失敗しました。")
    forecast = weather.build_spray_forecast(data)
    return {
        "forecast": forecast,
        "lat": round(lat, 4),
        "lon": round(lon, 4),
    }
