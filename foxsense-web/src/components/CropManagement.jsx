import { useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { fetchWeatherForHarvest, fetchPastDaily, predictFrost } from '../utils/weatherForecast';
import { computeDailyStats, accumulateGDD, predictHarvest } from '../utils/gdd';
import {
  Snowflake,
  Flower2,
  Sun,
  Thermometer,
  TrendingUp,
  AlertTriangle,
  Plus,
  X,
  Check,
} from 'lucide-react';

// upperTemp: 上限温度カットオフ（これを超える分は成長に寄与しないとして頭打ち）
// 果菜類は概ね30℃、涼しい季節の葉根菜は25℃前後を目安（品種・地域で要調整）
const CROP_PRESETS = [
  { label: 'スイカ',     baseTemp: 10, targetGDD: 1050, upperTemp: 30 },
  { label: 'メロン',     baseTemp: 10, targetGDD: 1150, upperTemp: 30 },
  { label: 'トマト',     baseTemp: 10, targetGDD: 1150, upperTemp: 30 },
  { label: 'ミニトマト', baseTemp: 10, targetGDD: 850,  upperTemp: 30 },
  { label: 'キュウリ',   baseTemp: 12, targetGDD: 250,  upperTemp: 30 },
  { label: 'ナス',       baseTemp: 10, targetGDD: 350,  upperTemp: 30 },
  { label: 'ピーマン',   baseTemp: 10, targetGDD: 300,  upperTemp: 30 },
  { label: 'カボチャ',   baseTemp: 12, targetGDD: 950,  upperTemp: 30 },
  { label: 'キャベツ',   baseTemp:  5, targetGDD: 850,  upperTemp: 25 },
  { label: 'ブロッコリー', baseTemp: 5, targetGDD: 950, upperTemp: 25 },
  { label: 'ハクサイ',   baseTemp:  5, targetGDD: 950,  upperTemp: 25 },
  { label: 'ダイコン',   baseTemp:  5, targetGDD: 950,  upperTemp: 25 },
  { label: 'ニンジン',   baseTemp:  5, targetGDD: 1050, upperTemp: 25 },
  { label: 'イネ',       baseTemp: 10, targetGDD: 2000, upperTemp: 0  },
];

const CropManagement = ({ historyData, latestData, alerts, deviceLocation, onClose }) => {
  const [activeTab, setActiveTab] = useState('frost'); // frost, gdd
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [pastDaily, setPastDaily] = useState(null); // 欠測穴埋め用の過去実測 日別平均気温
  const weatherFetchedRef = useRef(null); // 同一地点の重複取得防止

  const [pollinationRecords, setPollinationRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('foxsense_pollination');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [newRecord, setNewRecord] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    targetGDD: 1000,
    baseTemp: 10,
    upperTemp: 0,
    note: '',
  });

  // 地点が変わったら気象データをフェッチ
  useEffect(() => {
    if (!deviceLocation?.latitude || !deviceLocation?.longitude) {
      setWeatherData(null);
      setPastDaily(null);
      return;
    }
    const key = `${deviceLocation.latitude},${deviceLocation.longitude}`;
    if (weatherFetchedRef.current === key) return; // 同じ地点は再取得しない
    weatherFetchedRef.current = key;
    setWeatherLoading(true);

    const { latitude, longitude } = deviceLocation;
    const maxRemainingDays = 120;          // 積算の残り目安（季節ベースライン取得範囲）
    const today = new Date();
    const past = new Date(today); past.setDate(past.getDate() - 180);  // 欠測穴埋め用の過去実測範囲

    Promise.allSettled([
      fetchWeatherForHarvest(latitude, longitude, maxRemainingDays),
      fetchPastDaily(latitude, longitude, past, today),
    ]).then(([w, p]) => {
      setWeatherData(w.status === 'fulfilled' ? w.value : null);
      setPastDaily(p.status === 'fulfilled' ? p.value : null);
    }).finally(() => setWeatherLoading(false));
  }, [deviceLocation?.latitude, deviceLocation?.longitude]);

  // 日別統計（(max+min)/2 に統一）を履歴から一度だけ算出
  const dailyStats = useMemo(() => computeDailyStats(historyData), [historyData]);

  // 霜予測（予報の夜間最低気温を優先。無ければセンサ直近トレンドにフォールバック）
  const frostPrediction = useMemo(() => {
    const frostCritical = alerts?.frostCritical ?? 0;
    const frostWarning = alerts?.frostWarning ?? 3;
    const currentTempNow = latestData?.temperature;

    // 予報あり: Open-Meteoの夜間最低気温ベース（センサ2時間外挿より確度が高い）
    if (weatherData?.forecast) {
      const f = predictFrost(weatherData.forecast, { warning: frostWarning, critical: frostCritical });
      if (f) {
        return {
          source: 'forecast',
          riskLevel: f.riskLevel,
          message: f.message,
          currentTemp: typeof currentTempNow === 'number' ? currentTempNow.toFixed(1) : '--',
          currentMin: f.minTonight?.toFixed(1),      // 今夜の予報最低
          predictedMinTemp: f.minAhead?.toFixed(1),  // 直近3日で最も低い予報最低
          trend: null,
          frostWarning,
          frostCritical,
        };
      }
    }

    // フォールバック: センサ直近トレンド外挿（地点未設定/予報取得不可時）
    if (!historyData || historyData.length < 6) return null;
    const recentData = historyData.slice(-6);
    const temps = recentData.map(d => d.temperature);
    const firstHalf = temps.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const secondHalf = temps.slice(3).reduce((a, b) => a + b, 0) / 3;
    const trend = secondHalf - firstHalf;
    const currentMin = Math.min(...temps);
    const currentTemp = temps[temps.length - 1];

    let riskLevel = 'low';
    let message = '霜の心配はありません';
    const predictedMinTemp = currentTemp + trend * 2;
    if (predictedMinTemp <= frostCritical) {
      riskLevel = 'critical'; message = '霜が発生する可能性が非常に高いです！';
    } else if (predictedMinTemp <= frostWarning) {
      riskLevel = 'high'; message = '霜に注意が必要です';
    } else if (predictedMinTemp <= frostWarning + 2 || currentMin <= frostWarning + 2) {
      riskLevel = 'medium'; message = '気温が低めです。夜間の冷え込みに注意';
    }

    return {
      source: 'sensor',
      riskLevel,
      message,
      currentTemp: currentTemp?.toFixed(1),
      currentMin: currentMin?.toFixed(1),
      predictedMinTemp: predictedMinTemp?.toFixed(1),
      trend: trend?.toFixed(1),
      frostWarning,
      frostCritical,
    };
  }, [historyData, alerts, weatherData, latestData]);

  // 積算温度計算
  const calculateGDD = (record) => {
    if (!historyData || historyData.length === 0) return null;

    const baseTemp = Number(record.baseTemp) || 10;
    const requiredGDD = Number(record.targetGDD) || 1000;
    const upperTemp = Number(record.upperTemp) || 0;

    // 目標積算温度に基づいてアラート段階を動的生成
    const harvestAlerts = [0.75, 0.85, 0.90, 0.95, 1.0, 1.05].map(r => Math.round(requiredGDD * r));

    // 積算: (max+min)/2 統一・上限カットオフ・欠測日は過去実測(pastDaily)で穴埋め
    const { totalGDD, daysElapsed, avgDailyGDD, observedDays, filledDays, missingDays } = accumulateGDD({
      dailyStats,
      fromDate: record.date,
      baseTemp,
      upperTemp,
      fillFn: pastDaily ? (key) => pastDaily[key] : null,
    });
    if (observedDays === 0 && filledDays === 0) return null;

    // 収穫予想（単一エンジン: 気象データありは予報×季節ベースライン、無しは平均外挿）
    const pred = predictHarvest({
      currentGDD: totalGDD, targetGDD: requiredGDD, baseTemp, upperTemp, avgDailyGDD, weatherData,
    });
    const estimatedHarvestDate = pred.date;
    const estimatedDaysRemaining = pred.days;
    const forecastBased = pred.method === 'forecast';

    const progress = Math.min(100, (totalGDD / requiredGDD) * 100);

    let harvestStage = null;
    let nextAlert = null;
    let alertMessage = '';

    for (let i = 0; i < harvestAlerts.length; i++) {
      if (totalGDD >= harvestAlerts[i]) {
        harvestStage = harvestAlerts[i];
      } else {
        nextAlert = harvestAlerts[i];
        break;
      }
    }

    if (harvestStage) {
      if (harvestStage >= harvestAlerts[harvestAlerts.length - 1]) {
        alertMessage = '収穫適期を迎えています！';
      } else if (harvestStage >= harvestAlerts[Math.floor(harvestAlerts.length * 0.7)]) {
        alertMessage = 'もうすぐ収穫適期です';
      } else if (harvestStage >= harvestAlerts[0]) {
        alertMessage = '収穫開始目安に達しました';
      }
    }

    let daysToNextAlert = null;
    if (nextAlert && avgDailyGDD > 0) {
      daysToNextAlert = Math.ceil((nextAlert - totalGDD) / avgDailyGDD);
    }

    return {
      totalGDD: totalGDD.toFixed(0),
      requiredGDD,
      baseTemp,
      upperTemp,
      dataQuality: { observedDays, filledDays, missingDays },
      progress: progress.toFixed(1),
      daysElapsed,
      avgDailyGDD: avgDailyGDD.toFixed(1),
      estimatedDaysRemaining,
      estimatedHarvestDate,
      forecastBased,
      isReady: totalGDD >= requiredGDD,
      harvestAlerts,
      harvestStage,
      nextAlert,
      daysToNextAlert,
      alertMessage,
    };
  };

  const savePollinationRecord = () => {
    const record = {
      ...newRecord,
      targetGDD: Number(newRecord.targetGDD),
      baseTemp: Number(newRecord.baseTemp),
      upperTemp: Number(newRecord.upperTemp) || 0,
      id: Date.now(),
      createdAt: new Date().toISOString(),
    };
    const updated = [...pollinationRecords, record];
    setPollinationRecords(updated);
    localStorage.setItem('foxsense_pollination', JSON.stringify(updated));
    setShowAddRecord(false);
    setNewRecord({ date: format(new Date(), 'yyyy-MM-dd'), targetGDD: 1000, baseTemp: 10, upperTemp: 0, note: '' });
  };

  const deletePollinationRecord = (id) => {
    const updated = pollinationRecords.filter(r => r.id !== id);
    setPollinationRecords(updated);
    localStorage.setItem('foxsense_pollination', JSON.stringify(updated));
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
      <div className="card w-full max-w-2xl p-4 sm:p-6 fade-in my-2 sm:my-4 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-leaf-600" />
            <h2 className="text-base sm:text-lg font-bold text-gray-800">栽培管理</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* タブ */}
        <div className="flex gap-1 sm:gap-2 mb-4 sm:mb-6">
          <button
            onClick={() => setActiveTab('frost')}
            className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all text-xs sm:text-sm ${
              activeTab === 'frost'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Snowflake className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>霜予測</span>
          </button>
          <button
            onClick={() => setActiveTab('gdd')}
            className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-all text-xs sm:text-sm ${
              activeTab === 'gdd'
                ? 'bg-leaf-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Flower2 className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">積算温度・収穫予想</span>
            <span className="sm:hidden">収穫予想</span>
          </button>
        </div>

        {/* 霜予測タブ */}
        {activeTab === 'frost' && frostPrediction && (
          <div className="space-y-4">
            <div className={`rounded-xl p-4 ${
              frostPrediction.riskLevel === 'critical' ? 'bg-red-100 border-2 border-red-300' :
              frostPrediction.riskLevel === 'high' ? 'bg-orange-100 border-2 border-orange-300' :
              frostPrediction.riskLevel === 'medium' ? 'bg-yellow-100 border-2 border-yellow-300' :
              'bg-leaf-50 border-2 border-leaf-200'
            }`}>
              <div className="flex items-start gap-3">
                {frostPrediction.riskLevel !== 'low' ? (
                  <AlertTriangle className={`w-6 h-6 flex-shrink-0 ${
                    frostPrediction.riskLevel === 'critical' ? 'text-red-600' :
                    frostPrediction.riskLevel === 'high' ? 'text-orange-600' :
                    'text-yellow-600'
                  }`} />
                ) : (
                  <Check className="w-6 h-6 text-leaf-600 flex-shrink-0" />
                )}
                <div>
                  <div className={`font-bold ${
                    frostPrediction.riskLevel === 'critical' ? 'text-red-800' :
                    frostPrediction.riskLevel === 'high' ? 'text-orange-800' :
                    frostPrediction.riskLevel === 'medium' ? 'text-yellow-800' :
                    'text-leaf-800'
                  }`}>
                    {frostPrediction.message}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {frostPrediction.source === 'forecast' ? '今後3日の予報最低気温' : '2時間後の予測最低気温'}: {frostPrediction.predictedMinTemp}°C
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="bg-gray-50 rounded-lg p-2 sm:p-4 text-center">
                <div className="text-xs sm:text-sm text-gray-500">現在の気温</div>
                <div className="text-lg sm:text-2xl font-bold text-gray-800">{frostPrediction.currentTemp}°C</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-4 text-center">
                <div className="text-xs sm:text-sm text-gray-500">{frostPrediction.source === 'forecast' ? '今夜最低(予報)' : '直近最低'}</div>
                <div className="text-lg sm:text-2xl font-bold text-blue-600">{frostPrediction.currentMin}°C</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-4 text-center">
                <div className="text-xs sm:text-sm text-gray-500">{frostPrediction.trend != null ? 'トレンド' : '判定方式'}</div>
                {frostPrediction.trend != null ? (
                  <div className={`text-lg sm:text-2xl font-bold ${
                    parseFloat(frostPrediction.trend) > 0 ? 'text-red-500' : 'text-blue-500'
                  }`}>
                    {parseFloat(frostPrediction.trend) > 0 ? '+' : ''}{frostPrediction.trend}°C/h
                  </div>
                ) : (
                  <div className="text-sm sm:text-base font-semibold text-leaf-600 pt-1.5">予報ベース</div>
                )}
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
              <h4 className="font-medium text-gray-700 mb-1.5 sm:mb-2 text-sm sm:text-base">アラート設定</h4>
              <div className="flex flex-wrap gap-3 text-xs sm:text-sm">
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-orange-400"></span>
                  <span className="text-gray-600">警告: {frostPrediction.frostWarning}°C以下</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <span className="text-gray-600">危険: {frostPrediction.frostCritical}°C以下</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
              <h4 className="font-medium text-blue-800 mb-1.5 sm:mb-2 text-sm sm:text-base">霜対策</h4>
              <ul className="text-xs sm:text-sm text-blue-700 space-y-0.5 sm:space-y-1">
                <li>• 被覆資材（不織布、ビニール）を準備</li>
                <li>• ハウス内の換気扇や暖房の確認</li>
                <li>• 灌水による地温維持</li>
                <li>• 霜が予想される場合は前夜から対策を</li>
              </ul>
            </div>
          </div>
        )}

        {/* 積算温度タブ */}
        {activeTab === 'gdd' && (
          <div className="space-y-4">
            {/* 現在の積算温度（最新の記録があれば表示） */}
            {pollinationRecords.length > 0 && latestData && (
              <div className="bg-gradient-to-r from-leaf-50 to-emerald-50 rounded-xl p-4 border border-leaf-200">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-leaf-600" />
                  <span className="font-medium text-leaf-800">現在の積算温度</span>
                </div>
                {pollinationRecords.slice(-1).map(record => {
                  const gdd = calculateGDD(record);
                  if (!gdd) return null;
                  return (
                    <div key={record.id} className="text-3xl font-bold text-leaf-700">
                      {gdd.totalGDD}°C日
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        / {gdd.requiredGDD}°C日
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 記録一覧 */}
            <div className="space-y-3">
              {pollinationRecords.map(record => {
                const gdd = calculateGDD(record);

                return (
                  <div key={record.id} className="bg-white border rounded-xl p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Flower2 className="w-8 h-8 text-pink-500" />
                        <div>
                          <div className="font-medium text-gray-800">
                            {record.note || '積算温度記録'}
                          </div>
                          <div className="text-sm text-gray-500">
                            開始日: {format(new Date(record.date), 'yyyy年M月d日', { locale: ja })}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            目標: {record.targetGDD}°C日 / 基準温度: {record.baseTemp}°C
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => deletePollinationRecord(record.id)}
                        className="p-1 rounded text-gray-400 hover:text-red-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {gdd && (
                      <div className="mt-4 space-y-3">
                        {gdd.alertMessage && (
                          <div className={`flex items-center gap-2 p-3 rounded-lg ${
                            gdd.harvestStage >= gdd.harvestAlerts[gdd.harvestAlerts.length - 1]
                              ? 'bg-leaf-100 text-leaf-800'
                              : gdd.harvestStage >= gdd.harvestAlerts[0]
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            <AlertTriangle className="w-5 h-5" />
                            <span className="font-medium">{gdd.alertMessage}</span>
                          </div>
                        )}

                        {/* 進捗バー */}
                        <div className="relative">
                          <div className="flex justify-between mb-1 text-xs text-gray-400">
                            <span>0</span>
                            <span>{gdd.requiredGDD}°C日</span>
                          </div>
                          <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`absolute h-full rounded-full transition-all ${
                                gdd.isReady
                                  ? 'bg-leaf-500'
                                  : gdd.harvestStage
                                  ? 'bg-gradient-to-r from-yellow-400 to-orange-500'
                                  : 'bg-gradient-to-r from-blue-400 to-yellow-400'
                              }`}
                              style={{ width: `${gdd.progress}%` }}
                            />
                          </div>
                          <div className="text-xs text-gray-500 mt-1 text-right">
                            {gdd.progress}%
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs sm:text-sm">
                          <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-xs text-gray-500">経過日数</div>
                            <div className="font-medium">{gdd.daysElapsed}日</div>
                          </div>
                          <div className="bg-leaf-50 rounded-lg p-2 text-center">
                            <div className="text-xs text-gray-500">積算温度</div>
                            <div className="font-bold text-leaf-700 text-base sm:text-lg">{gdd.totalGDD}°C日</div>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <div className="text-xs text-gray-500">日平均</div>
                            <div className="font-medium">{gdd.avgDailyGDD}°C/日</div>
                          </div>
                          <div className="bg-orange-50 rounded-lg p-2 text-center">
                            <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                              収穫予想
                              {gdd.forecastBased && (
                                <span className="text-[10px] bg-blue-100 text-blue-600 px-1 rounded">予報</span>
                              )}
                            </div>
                            <div className="font-medium text-orange-600">
                              {weatherLoading ? (
                                '計算中…'
                              ) : gdd.isReady ? (
                                '収穫適期！'
                              ) : gdd.estimatedHarvestDate ? (
                                format(gdd.estimatedHarvestDate, 'M/d頃', { locale: ja })
                              ) : gdd.nextAlert && gdd.daysToNextAlert ? (
                                `約${gdd.daysToNextAlert}日`
                              ) : (
                                'データ不足'
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 記録追加フォーム */}
            {showAddRecord ? (
              <div className="bg-gray-50 rounded-xl p-3 sm:p-4 space-y-3 sm:space-y-4">
                <h4 className="font-medium text-gray-800 text-sm sm:text-base">積算温度を記録</h4>

                <div>
                  <label className="block text-xs sm:text-sm text-gray-600 mb-1">作物プリセット</label>
                  <select
                    onChange={(e) => {
                      const preset = CROP_PRESETS.find(p => p.label === e.target.value);
                      if (preset) setNewRecord(r => ({ ...r, baseTemp: preset.baseTemp, targetGDD: preset.targetGDD, upperTemp: preset.upperTemp ?? 0, note: r.note || preset.label }));
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm bg-white"
                  >
                    <option value="">-- 選択して自動入力 --</option>
                    {CROP_PRESETS.map(p => (
                      <option key={p.label} value={p.label}>{p.label}（基準{p.baseTemp}℃ / 目標{p.targetGDD}℃日）</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1">開始日（受粉日など）</label>
                    <input
                      type="date"
                      value={newRecord.date}
                      onChange={(e) => setNewRecord({ ...newRecord, date: e.target.value })}
                      max={format(new Date(), 'yyyy-MM-dd')}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1">目標積算温度 (°C日)</label>
                    <input
                      type="number"
                      value={newRecord.targetGDD}
                      onChange={(e) => setNewRecord({ ...newRecord, targetGDD: e.target.value })}
                      min="1"
                      max="9999"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1">基準温度 (°C)</label>
                    <input
                      type="number"
                      value={newRecord.baseTemp}
                      onChange={(e) => setNewRecord({ ...newRecord, baseTemp: e.target.value })}
                      min="0"
                      max="30"
                      step="0.5"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1">メモ（任意）</label>
                    <input
                      type="text"
                      value={newRecord.note}
                      onChange={(e) => setNewRecord({ ...newRecord, note: e.target.value })}
                      placeholder="例: ハウスA スイカ 1列目"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-leaf-400 outline-none text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddRecord(false)}
                    className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={savePollinationRecord}
                    disabled={!newRecord.targetGDD || !newRecord.baseTemp}
                    className="flex-1 py-2 rounded-lg bg-leaf-500 text-white font-medium text-sm disabled:opacity-50"
                  >
                    記録
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddRecord(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 sm:py-3 rounded-xl border-2 border-dashed border-leaf-300 text-leaf-600 hover:bg-leaf-50 transition-colors text-sm"
              >
                <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>積算温度を記録する</span>
              </button>
            )}

            <div className="bg-yellow-50 rounded-lg p-3 sm:p-4">
              <h4 className="font-medium text-yellow-800 mb-1.5 sm:mb-2 text-sm sm:text-base">積算温度とは</h4>
              <p className="text-xs sm:text-sm text-yellow-700">
                積算温度（GDD: Growing Degree Days）は、基準温度を超えた分の気温を毎日積み重ねた値です。
                目標積算温度に達すると収穫適期となります。作物の品種書や農協の資料を参考に入力してください。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CropManagement;
