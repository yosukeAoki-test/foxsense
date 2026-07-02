/**
 * utils/gdd.js — 積算温度(GDD/Growing Degree Days) 共通エンジン
 *
 * 分析で挙がった問題への対応:
 *  1. 平均法の統一 … 日次気温は (日最高+日最低)/2 に統一（予報/季節ベースラインと同じ算出法）
 *  2. 上限カットオフ … upperTemp を超える分は成長に寄与しないとして頭打ち
 *  3. 欠測日の穴埋め … センサ欠測日は fillFn（過去アーカイブ気温等）で補完
 *  4. 予測経路の一本化 … 収穫予想は predictHarvest() 単一エンジン（気象sim or 平均外挿）
 *
 * App.jsx / CropManagement.jsx の両方がこのモジュールを使う。
 */

import { simulateHarvestDate } from './weatherForecast';

/** 'YYYY-MM-DD' 文字列 */
export function dayKey(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dt, n) {
  const x = new Date(dt);
  x.setDate(x.getDate() + n);
  return x;
}

/** 1日分のGDD寄与。上限温度(任意)で頭打ち、baseTempで下限0。 */
export function dailyGDD(avgTemp, baseTemp, upperTemp = 0) {
  const capped = upperTemp && upperTemp > baseTemp ? Math.min(avgTemp, upperTemp) : avgTemp;
  return Math.max(0, capped - baseTemp);
}

/**
 * センサ履歴 → 日別統計 { [dayKey]: {max, min, mid, count} }
 * mid = (日最高 + 日最低)/2 … 予報/ベースラインと同じ算出法に統一（サンプル単純平均のバイアスを排除）
 */
export function computeDailyStats(historyData) {
  const byDay = {};
  for (const d of historyData || []) {
    if (typeof d.temperature !== 'number' || Number.isNaN(d.temperature)) continue;
    const key = dayKey(new Date(d.timestamp));
    const s = byDay[key] || (byDay[key] = { max: -Infinity, min: Infinity, count: 0 });
    if (d.temperature > s.max) s.max = d.temperature;
    if (d.temperature < s.min) s.min = d.temperature;
    s.count++;
  }
  for (const k of Object.keys(byDay)) byDay[k].mid = (byDay[k].max + byDay[k].min) / 2;
  return byDay;
}

/**
 * fromDate 〜 今日 の積算GDDを計算。
 * センサ欠測日は fillFn(dayKey, Date)->avgTemp で補完（無ければ 0 計上し missingDays に加算）。
 *
 * @returns { totalGDD, daysElapsed, observedDays, filledDays, missingDays, avgDailyGDD }
 *   avgDailyGDD は「実測+補完で寄与のあった日」平均（線形外挿の基準）
 */
export function accumulateGDD({ dailyStats, fromDate, baseTemp, upperTemp = 0, fillFn = null }) {
  const start = new Date(fromDate); start.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let total = 0, observed = 0, filled = 0, missing = 0, days = 0;
  for (let dt = new Date(start); dt <= today; dt = addDays(dt, 1)) {
    days++;
    const s = dailyStats[dayKey(dt)];
    if (s && s.count > 0) {
      total += dailyGDD(s.mid, baseTemp, upperTemp);
      observed++;
    } else if (fillFn) {
      const t = fillFn(dayKey(dt), dt);
      if (typeof t === 'number' && !Number.isNaN(t)) {
        total += dailyGDD(t, baseTemp, upperTemp);
        filled++;
      } else {
        missing++;
      }
    } else {
      missing++; // 穴埋め無し → その日はGDD 0（過小評価に注意）
    }
  }

  const contributing = observed + filled;
  const avgDailyGDD = contributing > 0 ? total / contributing : 0;
  return { totalGDD: total, daysElapsed: days, observedDays: observed, filledDays: filled, missingDays: missing, avgDailyGDD };
}

/**
 * 収穫予想（単一エンジン）
 *  - weatherData あり → 気象シミュレーション（14日予報＋季節ベースライン, 上限カットオフ反映）
 *  - 無し → 平均日GDDで線形外挿
 *
 * @returns { date: Date|null, days: number|null, method: 'done'|'forecast'|'linear'|null }
 */
export function predictHarvest({ currentGDD, targetGDD, baseTemp, upperTemp = 0, avgDailyGDD, weatherData }) {
  if (currentGDD >= targetGDD) return { date: null, days: 0, method: 'done' };

  if (weatherData) {
    const d = simulateHarvestDate(currentGDD, targetGDD, baseTemp, weatherData, upperTemp);
    if (d) {
      const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
      return { date: d, days, method: 'forecast' };
    }
  }
  if (avgDailyGDD > 0) {
    const days = Math.ceil((targetGDD - currentGDD) / avgDailyGDD);
    return { date: addDays(new Date(), days), days, method: 'linear' };
  }
  return { date: null, days: null, method: null };
}
