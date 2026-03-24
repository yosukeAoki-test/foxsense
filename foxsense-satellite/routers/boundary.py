"""POST /boundary/detect — 圃場境界線自動検出"""
import logging
import numpy as np

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import stac, raster, indices, colormap

logger = logging.getLogger(__name__)
router = APIRouter()


class BoundaryRequest(BaseModel):
    bbox: list[float]
    polygon: list | None = None
    min_area_ha: float = 0.01


def _arr_to_transform(arr: np.ndarray, bbox: list[float]):
    """array shape と bbox から簡易アフィン変換を作成する。"""
    from rasterio.transform import from_bounds
    h, w = arr.shape
    return from_bounds(*bbox, w, h)


def _classify_crop(ndvi_mean: float) -> str:
    if ndvi_mean > 0.65:
        return "水稲"
    if ndvi_mean > 0.45:
        return "大豆"
    if ndvi_mean > 0.25:
        return "野菜/小麦"
    return "裸地/休耕"


@router.post("/boundary/detect")
def boundary_detect(req: BoundaryRequest):
    from datetime import date
    # 最新の Sentinel-2 シーンを取得（過去 60 日）
    today = str(date.today())
    item = stac.search_s2_best(req.bbox, today, days=60, cloud_max=40)
    if item is None:
        raise HTTPException(
            status_code=404,
            detail="境界検出に使用できる Sentinel-2 シーンが見つかりませんでした（雲量が多い可能性があります）。",
        )

    bm = indices.S2_L2A
    try:
        red_raw = raster.read_band(item.assets[bm["red"]].href, req.bbox)
        nir_raw = raster.read_band(item.assets[bm["nir"]].href, req.bbox)
        if red_raw is None or nir_raw is None:
            raise HTTPException(status_code=422, detail="バンドデータの読み込みに失敗しました。")

        red = raster.scale_reflectance(red_raw)
        nir = raster.scale_reflectance(nir_raw)
        ndvi_arr = indices.ndvi(nir, red)
        if ndvi_arr is None:
            raise HTTPException(status_code=422, detail="NDVI 計算に失敗しました。")

        h, w = ndvi_arr.shape
        if h < 3 or w < 3:
            raise HTTPException(status_code=422, detail="選択エリアが小さすぎます。より広い範囲を選択してください。")

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("boundary raster read failed")
        raise HTTPException(status_code=500, detail=f"ラスタ読み込みエラー: {e}")

    # ===== セグメンテーション（距離変換 + watershed） =====
    try:
        from skimage.filters import gaussian
        from skimage.segmentation import watershed
        from scipy import ndimage as ndi
        from skimage.feature import peak_local_max
        import rasterio.features
        from shapely.geometry import shape, mapping
        from rasterio.transform import from_bounds
        import math

        # NaN を 0 に置換してスムージング
        valid_mask = np.isfinite(ndvi_arr)
        arr_filled = np.where(valid_mask, ndvi_arr, 0.0)
        smoothed = gaussian(arr_filled, sigma=2.0)

        # px → ha 換算（WGS84 で概算）
        lat_c = (req.bbox[1] + req.bbox[3]) / 2
        m_per_px_lon = abs(req.bbox[2] - req.bbox[0]) / w * 111320 * math.cos(math.radians(lat_c))
        m_per_px_lat = abs(req.bbox[3] - req.bbox[1]) / h * 111320
        px_area_ha = m_per_px_lon * m_per_px_lat / 10000
        min_px = max(1, int(req.min_area_ha / px_area_ha))

        # 農地マスク：NDVI > 0.10 を農地候補とする（冬季・休耕地も含める）
        field_mask = (smoothed > 0.10) & valid_mask

        # 距離変換で各連結領域の「中心」を求める
        distance = ndi.distance_transform_edt(field_mask)

        # ピーク検出（min_distance で過検出を抑制）
        min_dist = max(2, int(min_px ** 0.5))
        coords = peak_local_max(distance, min_distance=min_dist, labels=field_mask)

        if len(coords) == 0:
            # ピークが見つからない場合は連結成分ラベリングにフォールバック
            labeled_arr, _ = ndi.label(field_mask)
        else:
            peak_mask = np.zeros(distance.shape, dtype=bool)
            peak_mask[tuple(coords.T)] = True
            markers, _ = ndi.label(peak_mask)
            labeled_arr = watershed(-distance, markers, mask=field_mask)

        transform = from_bounds(*req.bbox, w, h)
        features = []
        for region_val in np.unique(labeled_arr):
            if region_val == 0:
                continue
            mask = (labeled_arr == region_val).astype(np.uint8)
            if mask.sum() < min_px:
                continue
            shapes = list(rasterio.features.shapes(mask, mask=mask, transform=transform))
            if not shapes:
                continue
            geom = shape(shapes[0][0])
            area_ha = round(mask.sum() * px_area_ha, 3)
            ndvi_in = float(np.nanmean(ndvi_arr[mask == 1]))
            features.append({
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "field_id": f"F{len(features)+1:03d}",
                    "area_ha": area_ha,
                    "ndvi_mean": round(ndvi_in, 3),
                    "crop": _classify_crop(ndvi_in),
                },
            })

        features.sort(key=lambda f: f["properties"]["area_ha"], reverse=True)

    except Exception as e:
        logger.exception("watershed failed")
        raise HTTPException(status_code=500, detail=f"境界検出エラー: {e}")

    # プレビュー画像（NDVI カラーマップ）
    preview_b64, _ = colormap.to_base64_png(ndvi_arr, "ndvi")

    dt_val = item.datetime
    scene_date = dt_val.strftime("%Y-%m-%d") if hasattr(dt_val, "strftime") else str(dt_val)[:10]

    return {
        "type": "FeatureCollection",
        "features": features,
        "scene_date": scene_date,
        "cloud_cover": round(item.properties.get("eo:cloud_cover", 0), 1),
        "preview_image": preview_b64,
        "meta": {"total_fields": len(features)},
    }
