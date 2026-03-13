"""衛星バンド指数の計算"""
import numpy as np

# ===== バンド名マッピング =====

S2_L2A = {
    "green": "B03", "red": "B04", "blue": "B02",
    "nir": "B08", "nir8a": "B8A", "rededge": "B05",
    "swir1": "B11", "swir2": "B12",
    "fmask": "SCL",
}

LANDSAT_C2_L2 = {
    "green": "green", "red": "red", "blue": "blue",
    "nir": "nir08", "rededge": None,
    "swir1": "swir16", "swir2": "swir22",
    "fmask": "qa_pixel",
}


def band_map(item) -> dict:
    cid = (item.collection_id or "").lower()
    if "sentinel-2" in cid or "hlss30" in cid:
        return S2_L2A
    return LANDSAT_C2_L2


# ===== 正規化差分指数 =====

def _nd(a: np.ndarray | None, b: np.ndarray | None) -> np.ndarray | None:
    """(a - b) / (a + b). a, b どちらかが None なら None を返す。"""
    if a is None or b is None:
        return None
    with np.errstate(divide="ignore", invalid="ignore"):
        denom = a + b
        result = np.where(denom != 0, (a - b) / denom, np.nan).astype(np.float32)
    result[~np.isfinite(result)] = np.nan
    return result


def ndvi(nir, red):
    """植生指数 (NIR - Red) / (NIR + Red)"""
    return _nd(nir, red)


def ndre(nir, rededge):
    """赤端植生指数 (NIR - RedEdge) / (NIR + RedEdge) ※ Sentinel-2 のみ"""
    return _nd(nir, rededge)


def ndwi(green, nir):
    """水指数 (Green - NIR) / (Green + NIR)"""
    return _nd(green, nir)


def ndmi(nir, swir1):
    """水分指数 (NIR - SWIR1) / (NIR + SWIR1)"""
    return _nd(nir, swir1)


# ===== 統計ヘルパー =====

def nanmean(arr: np.ndarray | None, min_fraction: float = 0.05) -> float | None:
    """有効画素の平均。有効画素が少なすぎる場合は None。"""
    if arr is None:
        return None
    valid = arr[np.isfinite(arr)]
    if len(valid) < arr.size * min_fraction:
        return None
    return float(np.mean(valid))


def vegetation_ratio(ndvi_arr: np.ndarray | None, threshold: float = 0.3) -> float | None:
    """NDVI > threshold の画素割合（植生被覆率）。"""
    if ndvi_arr is None:
        return None
    finite = ndvi_arr[np.isfinite(ndvi_arr)]
    if len(finite) == 0:
        return None
    return float(np.sum(finite > threshold) / len(finite))


def ndvi_status(mean: float | None) -> str:
    """NDVI 平均値から生育状態ラベルを返す。"""
    if mean is None:
        return "データなし"
    if mean >= 0.7:
        return "良好"
    if mean >= 0.55:
        return "普通"
    if mean >= 0.4:
        return "やや不良"
    return "不良"
