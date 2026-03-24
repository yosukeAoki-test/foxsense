"""Planetary Computer STAC クライアント"""
import logging
import planetary_computer
import pystac_client

logger = logging.getLogger(__name__)

CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

_client: pystac_client.Client | None = None


def get_client() -> pystac_client.Client:
    global _client
    if _client is None:
        _client = pystac_client.Client.open(
            CATALOG_URL,
            modifier=planetary_computer.sign_inplace,
        )
    return _client


def search_hls(bbox: list[float], start_date: str, end_date: str,
               cloud_max: float = 30, max_items: int = 50) -> list:
    """Sentinel-2 L2A + Landsat C2 L2 を組み合わせて高頻度時系列を構築する。"""
    try:
        items = get_client().search(
            collections=["sentinel-2-l2a", "landsat-c2-l2"],
            bbox=bbox,
            datetime=f"{start_date}/{end_date}",
            query={"eo:cloud_cover": {"lt": cloud_max}},
            sortby="datetime",
            max_items=max_items,
        ).item_collection()
        return list(items)
    except Exception as e:
        logger.error(f"Multi-source search failed: {e}")
        return []


def search_s2(bbox: list[float], start_date: str, end_date: str,
              cloud_max: float = 30, max_items: int = 10) -> list:
    """Sentinel-2 L2A シーンを検索する（雲量昇順）。"""
    try:
        items = get_client().search(
            collections=["sentinel-2-l2a"],
            bbox=bbox,
            datetime=f"{start_date}/{end_date}",
            query={"eo:cloud_cover": {"lt": cloud_max}},
            sortby="eo:cloud_cover",
            max_items=max_items,
        ).item_collection()
        return list(items)
    except Exception as e:
        logger.error(f"Sentinel-2 search failed: {e}")
        return []


def search_s2_best(bbox: list[float], end_date: str, days: int = 30,
                   cloud_max: float = 40) -> object | None:
    """指定日から過去 days 日で最も雲の少ない Sentinel-2 シーンを返す。"""
    from datetime import date, timedelta
    end = date.fromisoformat(end_date)
    start = end - timedelta(days=days)
    items = search_s2(bbox, str(start), str(end), cloud_max=cloud_max, max_items=5)
    return items[0] if items else None
