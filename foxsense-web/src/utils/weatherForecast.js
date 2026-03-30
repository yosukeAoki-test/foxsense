/**
 * weatherForecast.js
 * Open-Meteo API を使った気象データ取得ユーティリティ
 *
 * - fetchForecast: 今日から14日間の予報気温（日平均）
 * - fetchSeasonalBaseline: 過去3年の同時期日別平均気温（季節成分）
 * - fetchWeatherForHarvest: 上記2つを結合して収穫予想用データを返す
 *
 * Open-Meteo: https://open-meteo.com/ (無料・APIキー不要)
 */

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_API  = 'https://archive-api.open-meteo.com/v1/archive';

/**
 * 日付を 'YYYY-MM-DD' 文字列に変換
 */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 年を加算した日付を返す（簡易実装）
 */
function subYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - years);
  return d;
}

/**
 * 日数を加算した日付を返す
 */
function addDaysToDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 今日から14日間の予報を取得
 * @returns {Array<{date: string, avg: number}>}  date='YYYY-MM-DD', avg=日平均気温(℃)
 */
export async function fetchForecast(latitude, longitude) {
  const url = `${FORECAST_API}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=14&timezone=Asia%2FTokyo`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`);
  const data = await res.json();

  return data.daily.time.map((date, i) => ({
    date,
    avg: (data.daily.temperature_2m_max[i] + data.daily.temperature_2m_min[i]) / 2,
  }));
}

/**
 * 過去3年の同時期（startDate から numDays 日間）の日別平均気温を取得し、
 * 日付オフセット（startDateからの経過日数）→ 平均気温 のマップを返す
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {Date}   startDate  - 季節ベースライン開始日（通常: 今日+14日）
 * @param {number} numDays    - 取得日数（最大180日程度）
 * @returns {Object}  { [offsetDays: number]: avgTemp }
 */
export async function fetchSeasonalBaseline(latitude, longitude, startDate, numDays) {
  const requests = [1, 2, 3].map(yearsAgo => {
    const start = subYears(startDate, yearsAgo);
    const end   = addDaysToDate(start, numDays - 1);
    const url = `${ARCHIVE_API}?latitude=${latitude}&longitude=${longitude}` +
      `&start_date=${toDateStr(start)}&end_date=${toDateStr(end)}` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo`;
    return fetch(url).then(r => {
      if (!r.ok) throw new Error(`Archive API error: ${r.status}`);
      return r.json();
    });
  });

  const results = await Promise.allSettled(requests);

  // offset (経過日数) ごとに複数年の気温を集計
  const offsetMap = {}; // { offset: [temp, ...] }

  results.forEach(result => {
    if (result.status !== 'fulfilled' || !result.value?.daily?.time) return;
    const { time, temperature_2m_max, temperature_2m_min } = result.value.daily;
    time.forEach((_, i) => {
      const avg = (temperature_2m_max[i] + temperature_2m_min[i]) / 2;
      if (!offsetMap[i]) offsetMap[i] = [];
      offsetMap[i].push(avg);
    });
  });

  // 各オフセットの平均を計算
  const baseline = {};
  Object.entries(offsetMap).forEach(([offset, temps]) => {
    baseline[Number(offset)] = temps.reduce((a, b) => a + b, 0) / temps.length;
  });

  return baseline;
}

/**
 * 収穫予想用の気象データを一括取得
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} estimatedDaysToHarvest - 収穫までの概算日数（季節ベースラインの取得範囲に使用）
 * @returns {{ forecast: Array, seasonal: Object }}
 *   forecast[i] = { date, avg }           (今日〜14日後)
 *   seasonal[offset] = avgTemp            (15日後〜収穫予想日)
 */
export async function fetchWeatherForHarvest(latitude, longitude, estimatedDaysToHarvest = 90) {
  const forecastDays = 14;
  const seasonalStart = addDaysToDate(new Date(), forecastDays);
  // 季節ベースラインは収穫予想日+30日まで取得（余裕を持たせる）
  const seasonalDays = Math.max(estimatedDaysToHarvest - forecastDays + 30, 60);

  const [forecast, seasonal] = await Promise.all([
    fetchForecast(latitude, longitude),
    fetchSeasonalBaseline(latitude, longitude, seasonalStart, seasonalDays),
  ]);

  return { forecast, seasonal, forecastDays };
}

/**
 * 気象データを使って収穫予想日をシミュレーション
 *
 * @param {number} currentGDD      - 現在の積算GDD
 * @param {number} targetGDD       - 目標積算GDD
 * @param {number} baseTemp        - 基準温度
 * @param {Object} weatherData     - fetchWeatherForHarvest の返り値
 * @returns {Date | null}          - 予想収穫日（nullなら計算不能）
 */
export function simulateHarvestDate(currentGDD, targetGDD, baseTemp, weatherData) {
  if (currentGDD >= targetGDD) return null; // すでに到達済み

  const { forecast, seasonal, forecastDays } = weatherData;
  let gdd = currentGDD;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // フェーズ1: 予報気温（今日〜14日後）
  for (let i = 0; i < forecast.length; i++) {
    const dayGDD = Math.max(0, forecast[i].avg - baseTemp);
    gdd += dayGDD;
    if (gdd >= targetGDD) {
      const harvestDate = new Date(today);
      harvestDate.setDate(today.getDate() + i + 1);
      return harvestDate;
    }
  }

  // フェーズ2: 季節ベースライン（15日後〜）
  const maxDays = 365; // 最大1年先まで
  for (let offset = 0; offset < maxDays; offset++) {
    const temp = seasonal[offset];
    if (temp === undefined) {
      // ベースラインデータが尽きた → 直近ベースラインの平均で外挿
      const recentTemps = Object.values(seasonal).slice(-14);
      if (recentTemps.length === 0) return null;
      const fallbackTemp = recentTemps.reduce((a, b) => a + b, 0) / recentTemps.length;
      const dayGDD = Math.max(0, fallbackTemp - baseTemp);
      if (dayGDD <= 0) return null; // 気温が低すぎて永久に到達しない
      const daysNeeded = Math.ceil((targetGDD - gdd) / dayGDD);
      const harvestDate = new Date(today);
      harvestDate.setDate(today.getDate() + forecastDays + offset + daysNeeded);
      return harvestDate;
    }
    const dayGDD = Math.max(0, temp - baseTemp);
    gdd += dayGDD;
    if (gdd >= targetGDD) {
      const harvestDate = new Date(today);
      harvestDate.setDate(today.getDate() + forecastDays + offset + 1);
      return harvestDate;
    }
  }

  return null; // 1年以内に到達しない
}
