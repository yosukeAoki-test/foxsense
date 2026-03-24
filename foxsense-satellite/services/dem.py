"""DEM（数値標高モデル）読み込み・傾斜計算"""
import logging
import math
import numpy as np
from services import raster

logger = logging.getLogger(__name__)


def read_dem(bbox: list[float]) -> np.ndarray | None:
    """Copernicus DEM GLO-30 から標高データを読み込む。"""
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

        # タイルが複数ある場合は最初のもの（bbox が小さければ1枚で十分）
        item = items[0]
        href = item.assets["data"].href
        arr = raster.read_band(href, bbox)
        return arr
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
