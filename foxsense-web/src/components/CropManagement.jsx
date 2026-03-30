import { useState, useMemo } from 'react';
import { format, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
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

const CROP_PRESETS = [
  { label: 'スイカ',     baseTemp: 10, targetGDD: 1050 },
  { label: 'メロン',     baseTemp: 10, targetGDD: 1150 },
  { label: 'トマト',     baseTemp: 10, targetGDD: 1150 },
  { label: 'ミニトマト', baseTemp: 10, targetGDD: 850  },
  { label: 'キュウリ',   baseTemp: 12, targetGDD: 250  },
  { label: 'ナス',       baseTemp: 10, targetGDD: 350  },
  { label: 'ピーマン',   baseTemp: 10, targetGDD: 300  },
  { label: 'カボチャ',   baseTemp: 12, targetGDD: 950  },
  { label: 'キャベツ',   baseTemp:  5, targetGDD: 850  },
  { label: 'ブロッコリー', baseTemp: 5, targetGDD: 950 },
  { label: 'ハクサイ',   baseTemp:  5, targetGDD: 950  },
  { label: 'ダイコン',   baseTemp:  5, targetGDD: 950  },
  { label: 'ニンジン',   baseTemp:  5, targetGDD: 1050 },
  { label: 'イネ',       baseTemp: 10, targetGDD: 2000 },
];

const CropManagement = ({ historyData, latestData, alerts, onClose }) => {
  const [activeTab, setActiveTab] = useState('frost'); // frost, gdd
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
    note: '',
  });

  // 霜予測（設定値を使用）
  const frostPrediction = useMemo(() => {
    if (!historyData || historyData.length < 6) return null;

    const recentData = historyData.slice(-6);
    const temps = recentData.map(d => d.temperature);

    const firstHalf = temps.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const secondHalf = temps.slice(3).reduce((a, b) => a + b, 0) / 3;
    const trend = secondHalf - firstHalf;

    const currentMin = Math.min(...temps);
    const currentTemp = temps[temps.length - 1];

    const frostCritical = alerts?.frostCritical ?? 0;
    const frostWarning = alerts?.frostWarning ?? 3;

    let riskLevel = 'low';
    let message = '霜の心配はありません';
    let predictedMinTemp = currentTemp + trend * 2;

    if (predictedMinTemp <= frostCritical) {
      riskLevel = 'critical';
      message = '霜が発生する可能性が非常に高いです！';
    } else if (predictedMinTemp <= frostWarning) {
      riskLevel = 'high';
      message = '霜に注意が必要です';
    } else if (predictedMinTemp <= frostWarning + 2 || currentMin <= frostWarning + 2) {
      riskLevel = 'medium';
      message = '気温が低めです。夜間の冷え込みに注意';
    }

    return {
      riskLevel,
      message,
      currentTemp: currentTemp?.toFixed(1),
      currentMin: currentMin?.toFixed(1),
      predictedMinTemp: predictedMinTemp?.toFixed(1),
      trend: trend?.toFixed(1),
      frostWarning,
      frostCritical,
    };
  }, [historyData, alerts]);

  // 積算温度計算
  const calculateGDD = (record) => {
    if (!historyData || historyData.length === 0) return null;

    const baseTemp = Number(record.baseTemp) || 10;
    const requiredGDD = Number(record.targetGDD) || 1000;
    const pollinationDate = new Date(record.date);

    // 目標積算温度に基づいてアラート段階を動的生成
    const harvestAlerts = [0.75, 0.85, 0.90, 0.95, 1.0, 1.05].map(r => Math.round(requiredGDD * r));

    const dataAfterPollination = historyData.filter(d => new Date(d.timestamp) >= pollinationDate);
    if (dataAfterPollination.length === 0) return null;

    let totalGDD = 0;
    const dailyData = {};

    dataAfterPollination.forEach(d => {
      const dateKey = format(new Date(d.timestamp), 'yyyy-MM-dd');
      if (!dailyData[dateKey]) dailyData[dateKey] = [];
      dailyData[dateKey].push(d.temperature);
    });

    Object.values(dailyData).forEach(temps => {
      const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
      totalGDD += Math.max(0, avgTemp - baseTemp);
    });

    const daysElapsed = Object.keys(dailyData).length;
    const avgDailyGDD = daysElapsed > 0 ? totalGDD / daysElapsed : 0;
    const remainingGDD = requiredGDD - totalGDD;
    const estimatedDaysRemaining = avgDailyGDD > 0 ? Math.ceil(remainingGDD / avgDailyGDD) : null;
    const estimatedHarvestDate = estimatedDaysRemaining && estimatedDaysRemaining > 0
      ? addDays(new Date(), estimatedDaysRemaining)
      : null;

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
      progress: progress.toFixed(1),
      daysElapsed,
      avgDailyGDD: avgDailyGDD.toFixed(1),
      estimatedDaysRemaining,
      estimatedHarvestDate,
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
      id: Date.now(),
      createdAt: new Date().toISOString(),
    };
    const updated = [...pollinationRecords, record];
    setPollinationRecords(updated);
    localStorage.setItem('foxsense_pollination', JSON.stringify(updated));
    setShowAddRecord(false);
    setNewRecord({ date: format(new Date(), 'yyyy-MM-dd'), targetGDD: 1000, baseTemp: 10, note: '' });
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
                    2時間後の予測最低気温: {frostPrediction.predictedMinTemp}°C
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
                <div className="text-xs sm:text-sm text-gray-500">直近最低</div>
                <div className="text-lg sm:text-2xl font-bold text-blue-600">{frostPrediction.currentMin}°C</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-4 text-center">
                <div className="text-xs sm:text-sm text-gray-500">トレンド</div>
                <div className={`text-lg sm:text-2xl font-bold ${
                  parseFloat(frostPrediction.trend) > 0 ? 'text-red-500' : 'text-blue-500'
                }`}>
                  {parseFloat(frostPrediction.trend) > 0 ? '+' : ''}{frostPrediction.trend}°C/h
                </div>
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
                            <div className="text-xs text-gray-500">収穫予想</div>
                            <div className="font-medium text-orange-600">
                              {gdd.isReady ? (
                                '収穫適期！'
                              ) : gdd.nextAlert && gdd.daysToNextAlert ? (
                                `約${gdd.daysToNextAlert}日`
                              ) : gdd.estimatedHarvestDate ? (
                                format(gdd.estimatedHarvestDate, 'M/d頃', { locale: ja })
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
                      if (preset) setNewRecord(r => ({ ...r, baseTemp: preset.baseTemp, targetGDD: preset.targetGDD, note: r.note || preset.label }));
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
