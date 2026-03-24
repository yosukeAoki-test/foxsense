"""COG ウィンドウ読み込みユーティリティ"""
import logging
import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

logger = logging.getLogger(__name__)


def read_band(href: str, bbox_wgs84: list[float]) -> np.ndarray | None:
    """
    COG から 1 バンドを bbox 範囲だけ読み込む（HTTP range request）。
    戻り値: float32 の 2D ndarray（NaN = 無効画素）。失敗時は None。
    """
    try:
        with rasterio.open(href) as src:
            if src.crs and src.crs.to_epsg() != 4326:
                native = transform_bounds("EPSG:4326", src.crs, *bbox_wgs84)
            else:
                native = bbox_wgs84

            window = from_bounds(*native, src.transform)
            if window.width < 1 or window.height < 1:
                return None

            data = src.read(1, window=window).astype(np.float32)

            if src.nodata is not None:
                data[data == src.nodata] = np.nan

            data[data < -9000] = np.nan

            return data
    except Exception as e:
        logger.warning(f"read_band failed ({href[:60]}…): {e}")
        return None


def read_fmask(href: str, bbox_wgs84: list[float]) -> np.ndarray | None:
    """クラウドマスクバンド（S2 SCL / Landsat qa_pixel）を読み込む。"""
    try:
        with rasterio.open(href) as src:
            if src.crs and src.crs.to_epsg() != 4326:
                native = transform_bounds("EPSG:4326", src.crs, *bbox_wgs84)
            else:
                native = bbox_wgs84
            window = from_bounds(*native, src.transform)
            if window.width < 1 or window.height < 1:
                return None
            # uint16 で読む（Landsat qa_pixel は 16bit）
            return src.read(1, window=window).astype(np.uint16)
    except Exception as e:
        logger.warning(f"read_fmask failed: {e}")
        return None


def make_cloud_mask(fmask: np.ndarray | None, collection_id: str) -> np.ndarray | None:
    """
    有効画素マスクを返す（True = 有効）。
    - Sentinel-2 SCL: 4=植生, 5=裸地, 6=水, 7=未分類 のみ有効
    - Landsat qa_pixel: fill/dilated_cloud/cloud/cloud_shadow ビットが立っていれば無効
    """
    if fmask is None:
        return None
    cid = (collection_id or "").lower()
    if "sentinel-2" in cid or "hlss30" in cid:
        scl = fmask.astype(np.uint8)
        return (scl >= 4) & (scl <= 7)
    else:
        # Landsat qa_pixel: bit0=fill, bit1=dilated_cloud, bit3=cloud, bit4=cloud_shadow
        qa = fmask.astype(np.uint16)
        bad = (qa & np.uint16(0b00011011)) > 0
        return ~bad


def apply_fmask(data: np.ndarray | None, fmask: np.ndarray | None,
                collection_id: str = "") -> np.ndarray | None:
    """クラウドマスクで無効画素を NaN に置換する。解像度が異なる場合はリサイズ。"""
    if data is None:
        return data
    if fmask is None:
        return data
    try:
        if data.shape != fmask.shape:
            from scipy.ndimage import zoom
            zy = data.shape[0] / fmask.shape[0]
            zx = data.shape[1] / fmask.shape[1]
            fmask = zoom(fmask.astype(np.float32), (zy, zx), order=0).astype(np.uint16)
        valid = make_cloud_mask(fmask, collection_id)
        if valid is None:
            return data
        result = data.copy()
        result[~valid] = np.nan
        return result
    except Exception:
        return data


def scale_band(data: np.ndarray | None, collection_id: str = "") -> np.ndarray | None:
    """
    DN を反射率（0〜1）に変換。
    - Sentinel-2: DN / 10000
    - Landsat C2 L2: DN * 0.0000275 - 0.2
    """
    if data is None:
        return None
    cid = (collection_id or "").lower()
    if "landsat" in cid or "hlsl30" in cid:
        scaled = data * np.float32(0.0000275) - np.float32(0.2)
    else:
        scaled = data / np.float32(10000.0)
    scaled[scaled < -0.1] = np.nan
    scaled[scaled > 2.0] = np.nan
    return scaled


def scale_reflectance(data: np.ndarray | None) -> np.ndarray | None:
    """Sentinel-2 DN（0〜10000）を反射率（0〜1）に変換（後方互換）。"""
    return scale_band(data, "sentinel-2-l2a")


def apply_polygon_mask(arr: np.ndarray, polygon: list | None, bbox: list[float]) -> np.ndarray:
    """ポリゴン外の画素を NaN にする。polygon は [[lon,lat],...] 形式。"""
    if polygon is None or len(polygon) < 3:
        return arr
    try:
        from rasterio.transform import from_bounds
        from rasterio.features import geometry_mask
        h, w = arr.shape
        transform = from_bounds(*bbox, w, h)
        geom = {"type": "Polygon", "coordinates": [polygon]}
        mask = geometry_mask([geom], out_shape=(h, w), transform=transform, invert=True)
        result = arr.copy()
        result[~mask] = np.nan
        return result
    except Exception as e:
        logger.warning(f"polygon mask failed: {e}")
        return arr
