"""DEM（数値標高モデル）読み込み・傾斜計算"""
import logging
import math
import numpy as np
from services import raster

logger = logging.getLogger(__name__)


def read_dem(bbox: list[float]) -> np.ndarray | None:
    """Copernicus DEM GLO-30 から標高データを読み込む。複数タイルはマージする。"""
    try:
        from services.stac import get_client
        items = get_client().search(
            collections=["cop-dem-glo-30"],
            bbox=bbox,
            max_items=4,
        ).item_collection()

        if not items:
            logger.warning("No DEM tiles found")
            return None

        if len(items) == 1:
            href = items[0].assets["data"].href
            return raster.read_band(href, bbox)

        # 複数タイルを読み込んで NaN 以外の値をマージ
        arrays = []
        for item in items:
            arr = raster.read_band(item.assets["data"].href, bbox)
            if arr is not None:
                arrays.append(arr)

        if not arrays:
            return None
        if len(arrays) == 1:
            return arrays[0]

        # 同一 shape にする（最初のタイルを基準）
        base_shape = arrays[0].shape
        result = np.full(base_shape, np.nan, dtype=np.float32)
        for arr in arrays:
            if arr.shape != base_shape:
                continue
            mask = np.isfinite(arr) & ~np.isfinite(result)
            result[mask] = arr[mask]
        return result

    except Exception as e:
        logger.error(f"DEM read failed: {e}")
        return None


def compute_slope(dem_arr: np.ndarray, bbox: list[float]) -> np.ndarray:
    """DEM から傾斜角（度）を計算する。"""
    h, w = dem_arr.shape
    lat_c = (bbox[1] + bbox[3]) / 2
    m_per_px_lon = abs(bbox[2] - bbox[0]) / w * 111320 * math.cos(math.radians(lat_c))
    m_per_px_lat = abs(bbox[3] - bbox[1]) / h * 111320

    filled = np.where(np.isfinite(dem_arr), dem_arr, 0.0)
    dy, dx = np.gradient(filled, m_per_px_lat, m_per_px_lon)
    slope = np.degrees(np.arctan(np.sqrt(dx ** 2 + dy ** 2)))
    slope[~np.isfinite(dem_arr)] = np.nan
    return slope.astype(np.float32)
