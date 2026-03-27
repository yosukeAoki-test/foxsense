"""Open-Meteo 天気データ取得"""
import logging
from datetime import date, timedelta

import httpx

logger = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"

_DAILY_VARS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "relative_humidity_2m_max",
    "relative_humidity_2m_mean",
]


async def fetch(lat: float, lon: float, past_days: int = 14) -> dict | None:
    """今日から過去 past_days 日の日別気象データを取得する（現在日付ベース）。"""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": _DAILY_VARS,
        "past_days": past_days,
        "forecast_days": 1,
        "timezone": "Asia/Tokyo",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(FORECAST_URL, params=params)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning(f"Open-Meteo fetch failed: {e}")
        return None


async def fetch_for_period(lat: float, lon: float, end_date_str: str, days: int = 14) -> dict | None:
    """
    指定した end_date の前後 days 日間の気象データを取得する。
    end_date が 5 日以上前の場合はアーカイブ API を使用する。
    """
    end = date.fromisoformat(end_date_str)
    start = end - timedelta(days=days - 1)
    today = date.today()
    use_archive = (today - end).days >= 5

    if use_archive:
        # アーカイブ API: start_date / end_date で指定
        params = {
            "latitude": lat,
            "longitude": lon,
            "daily": _DAILY_VARS,
            "start_date": str(start),
            "end_date": str(min(end, today - timedelta(days=1))),
            "timezone": "Asia/Tokyo",
        }
        url = ARCHIVE_URL
    else:
        # フォアキャスト API: past_days で指定
        params = {
            "latitude": lat,
            "longitude": lon,
            "daily": _DAILY_VARS,
            "past_days": days,
            "forecast_days": 1,
            "timezone": "Asia/Tokyo",
        }
        url = FORECAST_URL

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning(f"Open-Meteo fetch_for_period failed (archive={use_archive}): {e}")
        return None


async def fetch_spray_forecast(lat: float, lon: float) -> dict | None:
    """散布天気予報（7日間）を取得する。"""
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": [
            "wind_speed_10m",
            "precipitation",
            "temperature_2m",
            "relative_humidity_2m",
        ],
        "daily": [
            "precipitation_sum",
            "wind_speed_10m_max",
            "temperature_2m_max",
            "temperature_2m_min",
            "relative_humidity_2m_max",
            "sunrise",
            "sunset",
        ],
        "forecast_days": 7,
        "timezone": "Asia/Tokyo",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(FORECAST_URL, params=params)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning(f"Open-Meteo spray forecast failed: {e}")
        return None


def _spray_rating(wind_max: float, precip: float, temp_max: float,
                  temp_min: float, humid_max: float) -> dict:
    """散布適性を評価する。"""
    issues = []
    score = 0

    if wind_max >= 5:
        score += 3
        issues.append(f"強風 {wind_max:.1f}m/s")
    elif wind_max >= 3:
        score += 1
        issues.append(f"風 {wind_max:.1f}m/s")

    if precip >= 1.0:
        score += 3
        issues.append(f"降水 {precip:.0f}mm")
    elif precip >= 0.2:
        score += 1
        issues.append(f"小雨 {precip:.1f}mm")

    if temp_max is not None and temp_max > 35:
        score += 2
        issues.append(f"高温 {temp_max:.0f}°C")
    elif temp_min is not None and temp_min < 5:
        score += 1
        issues.append(f"低温 {temp_min:.0f}°C")

    if humid_max is not None and humid_max >= 90:
        score += 1
        issues.append(f"多湿 {humid_max:.0f}%")

    if score == 0:
        rating, label = "S", "◎ 最適"
    elif score <= 1:
        rating, label = "A", "○ 良好"
    elif score <= 2:
        rating, label = "B", "△ 注意"
    else:
        rating, label = "C", "× NG"

    return {
        "rating": rating,
        "label": label,
        "issues": issues,
        "wind_max": round(wind_max, 1),
        "precip": round(precip, 1),
        "temp_max": round(temp_max, 0) if temp_max is not None else None,
        "temp_min": round(temp_min, 0) if temp_min is not None else None,
        "humid_max": round(humid_max, 0) if humid_max is not None else None,
    }


def build_spray_forecast(data: dict | None) -> list[dict]:
    """天気データから7日間の散布予報リストを生成する。"""
    if not data:
        return []
    daily = data.get("daily", {})
    dates    = daily.get("time", [])
    wind_max = daily.get("wind_speed_10m_max", [])
    precip   = daily.get("precipitation_sum", [])
    t_max    = daily.get("temperature_2m_max", [])
    t_min    = daily.get("temperature_2m_min", [])
    h_max    = daily.get("relative_humidity_2m_max", [])
    sunrise  = daily.get("sunrise", [])
    sunset   = daily.get("sunset", [])

    result = []
    for i, d in enumerate(dates):
        r = _spray_rating(
            wind_max[i] if i < len(wind_max) and wind_max[i] is not None else 0,
            precip[i]   if i < len(precip)   and precip[i]   is not None else 0,
            t_max[i]    if i < len(t_max)     else None,
            t_min[i]    if i < len(t_min)     else None,
            h_max[i]    if i < len(h_max)     else None,
        )
        r["date"] = d
        r["sunrise"] = sunrise[i][11:16] if i < len(sunrise) else None
        r["sunset"]  = sunset[i][11:16]  if i < len(sunset)  else None
        result.append(r)

    return result


def summarize(data: dict | None) -> dict:
    """14日間の平均気温・平均湿度・合計降水量を集計する。"""
    if not data:
        return {"temp_avg_14d": None, "humidity_avg_14d": None, "precip_sum_14d": None}

    daily = data.get("daily", {})
    temps_max = [v for v in daily.get("temperature_2m_max", []) if v is not None]
    temps_min = [v for v in daily.get("temperature_2m_min", []) if v is not None]
    humids    = [v for v in daily.get("relative_humidity_2m_mean", []) if v is not None]
    precips   = [v for v in daily.get("precipitation_sum", []) if v is not None]

    pairs = list(zip(temps_max, temps_min))
    avg_temp  = sum((h + l) / 2 for h, l in pairs) / len(pairs) if pairs else None
    avg_humid = sum(humids) / len(humids) if humids else None
    sum_precip = sum(precips) if precips else None

    return {
        "temp_avg_14d":    round(avg_temp,   1) if avg_temp   is not None else None,
        "humidity_avg_14d": round(avg_humid, 1) if avg_humid  is not None else None,
        "precip_sum_14d":  round(sum_precip, 1) if sum_precip is not None else None,
    }


def daily_series(data: dict | None) -> list[dict]:
    """日別天気データをフロントエンド向けリストに変換する。"""
    if not data:
        return []
    daily  = data.get("daily", {})
    dates  = daily.get("time", [])
    t_max  = daily.get("temperature_2m_max", [])
    humids = daily.get("relative_humidity_2m_mean", [])
    precips = daily.get("precipitation_sum", [])
    result = []
    for i, d in enumerate(dates):
        result.append({
            "date":    d,
            "temp_max": t_max[i]  if i < len(t_max)   else None,
            "humidity": humids[i] if i < len(humids)   else None,
            "precip":   precips[i] if i < len(precips) else None,
        })
    return result
