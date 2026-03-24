import { useSatelliteApi } from '../../hooks/useSatelliteApi'
import SatelliteLoader from './SatelliteLoader'

const RISK_STYLE = {
  高: { bar: 'bg-red-500',    badge: 'bg-red-100 text-red-700',    card: 'bg-red-50 border-red-200' },
  中: { bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700', card: 'bg-yellow-50 border-yellow-200' },
  低: { bar: 'bg-green-400',  badge: 'bg-green-100 text-green-700',  card: 'bg-green-50 border-green-200' },
}

function RiskBar({ score }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.7 ? 'bg-red-500' : score >= 0.4 ? 'bg-yellow-400' : 'bg-green-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  )
}

function DiseaseCard({ disease }) {
  const s = RISK_STYLE[disease.label] ?? RISK_STYLE['低']
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${s.card}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">{disease.name}</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.badge}`}>
          リスク {disease.label}
        </span>
      </div>
      <RiskBar score={disease.score} />
      <p className="text-xs text-gray-600 leading-relaxed">→ {disease.advice}</p>
    </div>
  )
}

export default function DiseaseRiskPanel({ selectedArea, startDate, endDate, activePolygon }) {
  const { data, loading, error, post } = useSatelliteApi()

  if (!selectedArea) return null

  const analyze = () => post('/disease/risk', {
    bbox: selectedArea.bbox,
    polygon: activePolygon,
    start_date: startDate,
    end_date: endDate,
    cloud_max: 60,
  })

  const overall = data?.overall

  return (
    <div className="space-y-3">
      <button
        onClick={analyze}
        disabled={loading}
        className="w-full bg-orange-600 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50"
      >
        {loading ? '気象データ取得・解析中...' : '病害リスクを予測する'}
      </button>
      {error && <p className="text-xs text-red-500 bg-red-50 rounded p-2">{error}</p>}
      {loading && <SatelliteLoader label="気象データ × 衛星NDVI で病害リスクを解析中..." />}

      {data && !loading && (
        <div className="space-y-3">
          {/* 総合リスク */}
          <div className={`rounded-xl border-2 p-4 ${RISK_STYLE[overall.label]?.card}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-700">総合病害リスク</p>
              <span className={`text-base font-bold px-3 py-1 rounded-full ${RISK_STYLE[overall.label]?.badge}`}>
                {overall.label}
              </span>
            </div>
            <RiskBar score={overall.score} />
          </div>

          {/* 生育ステージ・気象サマリー */}
          <div className="bg-white rounded-xl border p-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-400">生育ステージ</p>
              <p className="font-semibold text-gray-800 mt-0.5">{data.growth_stage}</p>
            </div>
            <div>
              <p className="text-gray-400">NDVI低下率</p>
              <p className={`font-semibold mt-0.5 ${data.ndvi_decline_rate > 0.1 ? 'text-red-600' : 'text-gray-800'}`}>
                {(data.ndvi_decline_rate * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-gray-400">平均気温（14日）</p>
              <p className="font-semibold text-gray-800 mt-0.5">{data.weather_summary?.temp_avg_14d}℃</p>
            </div>
            <div>
              <p className="text-gray-400">平均湿度（14日）</p>
              <p className="font-semibold text-gray-800 mt-0.5">{data.weather_summary?.humidity_avg_14d}%</p>
            </div>
            <div>
              <p className="text-gray-400">累積降水量（14日）</p>
              <p className="font-semibold text-gray-800 mt-0.5">{data.weather_summary?.precip_sum_14d}mm</p>
            </div>
            <div>
              <p className="text-gray-400">解析日</p>
              <p className="font-semibold text-gray-800 mt-0.5">{data.analysis_date}</p>
            </div>
          </div>

          {/* 個別病害 */}
          {Object.values(data.risks).map((d) => (
            <DiseaseCard key={d.name} disease={d} />
          ))}

          {/* 直近天気 */}
          {data.weather?.length > 0 && (
            <details className="bg-white rounded-xl border overflow-hidden">
              <summary className="text-xs text-gray-400 px-4 py-2 bg-gray-50 cursor-pointer select-none">
                直近7日間の気象データ
              </summary>
              <div className="divide-y text-xs">
                {data.weather.map((w, i) => (
                  <div key={i} className="flex justify-between px-4 py-2 text-gray-600">
                    <span className="w-24 shrink-0">{w.date}</span>
                    <span>🌡 {w.temp_max ?? '--'}℃</span>
                    <span>💧 {w.humidity ?? '--'}%</span>
                    <span>🌧 {w.precip ?? '--'}mm</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-xs text-gray-300 text-center">
            ※ 気象データ: Open-Meteo / 衛星: Sentinel-2 による統計モデル推定
          </p>
        </div>
      )}
    </div>
  )
}
