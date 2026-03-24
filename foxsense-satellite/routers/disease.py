"""POST /disease/risk — 病害リスク予測"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import stac, raster, indices, weather
from routers.ndvi import _read_hls_scene, MAX_WORKERS

logger = logging.getLogger(__name__)
router = APIRouter()


class DiseaseRequest(BaseModel):
    bbox: list[float]
    polygon: list | None = None
    start_date: str
    end_date: str
    cloud_max: float = 30


# ===== 生育ステージ推定 =====

def _estimate_growth_stage(scenes: list, end_date: str) -> str:
    month = int(end_date[5:7])
    latest = scenes[-1]["ndvi"]["mean"] if scenes else 0.0
    if month <= 5:
        return "移植・初期生育"
    if month == 6:
        return "分げつ期" if latest < 0.5 else "茎立ち期"
    if month == 7:
        return "幼穂形成期" if latest < 0.65 else "穂ばらみ期"
    if month == 8:
        return "出穂期" if latest >= 0.65 else "登熟初期"
    if month == 9:
        return "登熟期" if latest >= 0.5 else "成熟期"
    return "収穫後"


def _ndvi_decline_rate(scenes: list) -> float:
    """最新シーンと 14 日前シーンの NDVI 減少率（0 以上が減少）。"""
    if len(scenes) < 2:
        return 0.0
    recent = scenes[-1]["ndvi"]["mean"]
    older  = scenes[0]["ndvi"]["mean"]
    if older < 0.01:
        return 0.0
    return max(0.0, round((older - recent) / older, 4))


# ===== 病害スコアリング =====

def _score_rice_blast(ws: dict, decline: float, stage: str) -> dict:
    """いもち病リスク"""
    t = ws.get("temp_avg_14d") or 22
    h = ws.get("humidity_avg_14d") or 75
    p = ws.get("precip_sum_14d") or 20
    score = 0.0
    if 20 <= t <= 25:
        score += 0.35
    elif 18 <= t < 20 or 25 < t <= 28:
        score += 0.15
    if h >= 90:
        score += 0.30
    elif h >= 80:
        score += 0.15
    if p >= 60:
        score += 0.20
    elif p >= 30:
        score += 0.10
    if decline > 0.15:
        score += 0.20
    elif decline > 0.08:
        score += 0.10
    if stage in ("出穂期", "穂ばらみ期"):
        score = min(1.0, score * 1.3)
    score = min(1.0, score)
    label = "高" if score >= 0.7 else "中" if score >= 0.4 else "低"
    advice = (
        "殺菌剤（トリシクラゾール等）の予防散布を検討してください。" if score >= 0.7
        else "圃場を巡回し葉いもちの有無を確認してください。" if score >= 0.4
        else "現時点でリスクは低いです。天候を引き続き注意してください。"
    )
    return {"name": "いもち病", "score": round(score, 3), "label": label, "advice": advice}


def _score_sheath_blight(ws: dict, decline: float) -> dict:
    """紋枯病リスク"""
    t = ws.get("temp_avg_14d") or 22
    h = ws.get("humidity_avg_14d") or 75
    p = ws.get("precip_sum_14d") or 20
    score = 0.0
    if t >= 28:
        score += 0.35
    elif t >= 25:
        score += 0.20
    if h >= 85:
        score += 0.30
    elif h >= 75:
        score += 0.15
    if p >= 40:
        score += 0.15
    if decline > 0.12:
        score += 0.25
    elif decline > 0.06:
        score += 0.12
    score = min(1.0, score)
    label = "高" if score >= 0.7 else "中" if score >= 0.4 else "低"
    advice = (
        "密植・過剰窒素の圃場は特に注意。殺菌剤の茎葉散布を推奨します。" if score >= 0.7
        else "株元の葉鞘を確認し、病斑の有無をチェックしてください。" if score >= 0.4
        else "現時点でリスクは低いです。"
    )
    return {"name": "紋枯病", "score": round(score, 3), "label": label, "advice": advice}


def _score_brown_spot(ws: dict, decline: float) -> dict:
    """胡麻葉枯病リスク"""
    t = ws.get("temp_avg_14d") or 22
    h = ws.get("humidity_avg_14d") or 75
    score = 0.0
    if 25 <= t <= 30:
        score += 0.25
    if h >= 80:
        score += 0.25
    if decline > 0.10:
        score += 0.25
    score = min(1.0, score)
    label = "高" if score >= 0.7 else "中" if score >= 0.4 else "低"
    advice = (
        "窒素追肥と殺菌剤散布を検討してください。" if score >= 0.4
        else "リスクは低いです。"
    )
    return {"name": "胡麻葉枯病", "score": round(score, 3), "label": label, "advice": advice}


def _score_soybean_rust(ws: dict, decline: float) -> dict:
    """大豆さび病リスク"""
    t = ws.get("temp_avg_14d") or 22
    h = ws.get("humidity_avg_14d") or 75
    p = ws.get("precip_sum_14d") or 20
    score = 0.0
    if 15 <= t <= 28:
        score += 0.30
    if h >= 80:
        score += 0.30
    if p >= 50:
        score += 0.20
    if decline > 0.10:
        score += 0.25
    score = min(1.0, score)
    label = "高" if score >= 0.7 else "中" if score >= 0.4 else "低"
    advice = (
        "殺菌剤（テブコナゾール等）の葉面散布を推奨します。" if score >= 0.7
        else "葉裏のさび病病斑を定期的に確認してください。" if score >= 0.4
        else "現時点でリスクは低いです。"
    )
    return {"name": "大豆さび病", "score": round(score, 3), "label": label, "advice": advice}


@router.post("/disease/risk")
async def disease_risk(req: DiseaseRequest):
    # 過去 30 日の HLS シーンを取得
    end = date.fromisoformat(req.end_date)
    start = str(end - timedelta(days=30))
    items = stac.search_hls(req.bbox, start, req.end_date, cloud_max=50)

    scenes = []
    if items:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(_read_hls_scene, item, req.bbox): item for item in items}
            for f in as_completed(futures):
                try:
                    r = f.result(timeout=45)
                    if r:
                        scenes.append(r)
                except Exception:
                    pass
        scenes.sort(key=lambda s: s["datetime"])

    # 天気データ（非同期）
    lat = (req.bbox[1] + req.bbox[3]) / 2
    lon = (req.bbox[0] + req.bbox[2]) / 2
    wx_raw = await weather.fetch(lat, lon, past_days=14)
    ws = weather.summarize(wx_raw)
    wx_series = weather.daily_series(wx_raw)

    # NDVI 減少率・生育ステージ
    decline = _ndvi_decline_rate(scenes)
    stage = _estimate_growth_stage(scenes, req.end_date)

    # 病害スコア
    risks = {
        "rice_blast":    _score_rice_blast(ws, decline, stage),
        "sheath_blight": _score_sheath_blight(ws, decline),
        "brown_spot":    _score_brown_spot(ws, decline),
        "soybean_rust":  _score_soybean_rust(ws, decline),
    }

    scores = [r["score"] for r in risks.values()]
    overall_score = max(scores)
    overall_label = "高" if overall_score >= 0.7 else "中" if overall_score >= 0.4 else "低"

    return {
        "overall": {"label": overall_label, "score": round(overall_score, 3)},
        "growth_stage": stage,
        "ndvi_decline_rate": decline,
        "analysis_date": req.end_date,
        "weather_summary": ws,
        "risks": risks,
        "weather": wx_series,
    }
