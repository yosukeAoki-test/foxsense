"""POST /analysis/field  POST /analysis/colormap"""
import logging
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import stac, raster, indices, colormap  # noqa: F401 raster used for polygon mask
from routers.ndvi import _read_hls_scene, MAX_WORKERS

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalysisFieldRequest(BaseModel):
    bbox: list[float]
    polygon: list | None = None
    start_date: str
    end_date: str
    cloud_max: float = 30


class ColormapRequest(BaseModel):
    bbox: list[float]
    date: str
    index: str = "ndvi"
    polygon: list | None = None


# ===== 収量予測 =====

YIELD_COMMENTS = {
    "S": "例年を大きく上回る豊作が期待できます。",
    "A": "平年並み以上の収量が見込まれます。",
    "B": "平年並みの収量が見込まれます。",
    "C": "やや不作の可能性があります。施肥・水管理を確認してください。",
    "D": "不作の恐れがあります。圃場巡回と対策を検討してください。",
}


def _predict_yield(scenes: list) -> dict:
    aug = [s for s in scenes if "-08-" in s["datetime"] or "-07-" in s["datetime"]]
    if not aug:
        return {"available": False}
    peak = max(s["ndvi"]["mean"] for s in aug)
    kg = max(200, min(800, round(550 + (peak - 0.75) * 600)))
    rank = "S" if peak >= 0.78 else "A" if peak >= 0.70 else "B" if peak >= 0.60 else "C" if peak >= 0.45 else "D"
    return {
        "available": True,
        "rank": rank,
        "yield_kg_per_10a": kg,
        "peak_ndvi": round(peak, 4),
        "comment": YIELD_COMMENTS[rank],
    }


# ===== 施肥診断（NDRE） =====

def _diagnose_fertilizer(ndre_peak: float | None) -> dict:
    if ndre_peak is None:
        return {"available": False}
    if ndre_peak >= 0.45:
        status, label = "excess", "窒素過剰"
        rec = "追肥は控えてください。倒伏リスクに注意してください。"
    elif ndre_peak >= 0.30:
        status, label = "optimal", "適正"
        rec = "現在の施肥量を維持してください。"
    elif ndre_peak >= 0.15:
        status, label = "low", "やや不足"
        rec = "追肥を検討してください（目安：窒素 2〜3 kg/10a）。"
    else:
        status, label = "deficient", "窒素不足"
        rec = "土壌診断と速効性追肥をおすすめします。"
    return {
        "available": True,
        "status": status,
        "label": label,
        "ndre_peak": round(ndre_peak, 4),
        "recommendation": rec,
    }


def _get_s2_ndre(bbox: list[float], end_date: str) -> float | None:
    """最新の Sentinel-2 シーンから NDRE ピーク値を取得する。
    B8A (narrow NIR, 20m) と B05 (RedEdge, 20m) を使用して解像度を揃える。"""
    item = stac.search_s2_best(bbox, end_date, days=60, cloud_max=50)
    if item is None:
        return None
    try:
        # B8A (20m) と B05 (20m) で解像度を揃える
        re_raw  = raster.read_band(item.assets["B05"].href, bbox)
        nir_raw = raster.read_band(item.assets["B8A"].href, bbox)
        if re_raw is None or nir_raw is None:
            return None
        fmask_raw = raster.read_fmask(item.assets["SCL"].href, bbox)
        cid = "sentinel-2-l2a"
        re  = raster.apply_fmask(raster.scale_band(re_raw,  cid), fmask_raw, cid)
        nir = raster.apply_fmask(raster.scale_band(nir_raw, cid), fmask_raw, cid)
        return indices.nanmean(indices.ndre(nir, re))
    except Exception as e:
        logger.warning(f"S2 NDRE failed: {e}")
        return None


@router.post("/analysis/field")
def analysis_field(req: AnalysisFieldRequest):
    # HLS NDVI 時系列
    items = stac.search_hls(req.bbox, req.start_date, req.end_date, req.cloud_max)
    if not items:
        raise HTTPException(status_code=404, detail="衛星シーンが見つかりませんでした。")

    scenes = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_read_hls_scene, item, req.bbox): item for item in items}
        for f in as_completed(futures):
            try:
                r = f.result(timeout=45)
                if r:
                    scenes.append(r)
            except Exception:
                pass

    if not scenes:
        raise HTTPException(status_code=422, detail="有効なシーンがありませんでした。")

    scenes.sort(key=lambda s: s["datetime"])

    # Sentinel-2 NDRE（並行取得）
    with ThreadPoolExecutor(max_workers=1) as pool:
        ndre_future = pool.submit(_get_s2_ndre, req.bbox, req.end_date)
        ndre_peak = ndre_future.result(timeout=60)

    return {
        "scenes": scenes,
        "scene_count": len(scenes),
        "fertilizer": _diagnose_fertilizer(ndre_peak),
        "yield_prediction": _predict_yield(scenes),
    }


@router.post("/analysis/colormap")
def analysis_colormap(req: ColormapRequest):
    # 指定日付付近で最良シーンを探す
    dt = date.fromisoformat(req.date)
    start = str(dt - timedelta(days=10))
    end   = str(dt + timedelta(days=10))

    # カラーマップは常に Sentinel-2（高解像度・全バンド対応）
    items = stac.search_s2(req.bbox, start, end, cloud_max=50, max_items=5)

    if not items:
        raise HTTPException(status_code=404, detail="指定日付付近にシーンが見つかりませんでした。")

    item = items[0]
    bm = indices.band_map(item)

    try:
        from scipy.ndimage import zoom as _zoom

        def _read_scaled(asset_key):
            return raster.scale_reflectance(raster.read_band(item.assets[asset_key].href, req.bbox))

        def _match_shape(a, b):
            """b を a の形状にリサイズして返す（解像度差の吸収）"""
            if a is None or b is None or a.shape == b.shape:
                return b
            import numpy as np
            zy = a.shape[0] / b.shape[0]
            zx = a.shape[1] / b.shape[1]
            return _zoom(b, (zy, zx), order=1).astype(np.float32)

        if req.index == "ndvi":
            a = _read_scaled(bm["nir"])
            b = _read_scaled(bm["red"])
            arr = indices.ndvi(a, b)
        elif req.index == "ndre":
            # B8A (narrow NIR, 20m) + B05 (RedEdge, 20m) — 解像度を揃える
            a = _read_scaled(indices.S2_L2A["nir8a"])
            b = _read_scaled(indices.S2_L2A["rededge"])
            arr = indices.ndre(a, b)
        elif req.index == "ndwi":
            a = _read_scaled(bm["green"])
            b = _read_scaled(bm["nir"])
            arr = indices.ndwi(a, b)
        else:  # ndmi — NIR(B08,10m) + SWIR1(B11,20m) → リサイズ必要
            a = _read_scaled(bm["nir"])
            b_raw = _read_scaled(bm["swir1"])
            b = _match_shape(a, b_raw)
            arr = indices.ndmi(a, b)

        if arr is None:
            raise HTTPException(status_code=422, detail="バンドデータの読み込みに失敗しました。")

        arr = raster.apply_polygon_mask(arr, req.polygon, req.bbox)
        b64, legend = colormap.to_base64_png(arr, req.index)
        dt_val = item.datetime
        scene_date = dt_val.strftime("%Y-%m-%d") if hasattr(dt_val, "strftime") else str(dt_val)[:10]

        return {"image_base64": b64, "legend": legend, "scene_date": scene_date, "index": req.index}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("colormap failed")
        raise HTTPException(status_code=500, detail=f"カラーマップ生成エラー: {e}")
